import {
  BLACK,
  BOARD_CELLS,
  BOARD_SIZE,
  CPU_LEVELS,
  EMPTY,
  assertBoard,
  assertColor,
  type Board,
  type Cell,
  type Color,
  type CpuLevel,
  type LegalMove,
} from '@reversi/shared';
import type { CpuSearchDiagnostics } from './CpuEngine.ts';

const WIN_SCORE = 1_000_000;
export const LEGACY_SEARCH_LIMITS = Object.freeze({
  [CPU_LEVELS.ADVANCED]: Object.freeze({ maxDepth: 5, timeLimitMs: 550 }),
  [CPU_LEVELS.EXPERT]: Object.freeze({ maxDepth: 8, timeLimitMs: 1_600 }),
});
export const LEGACY_EXPERT_ENDGAME_THRESHOLD = 10;
const MAX_CACHE_ENTRIES = 80_000;

const POSITION_WEIGHTS = Object.freeze([
  140, -35, 18, 8, 8, 18, -35, 140,
  -35, -55, -8, -4, -4, -8, -55, -35,
  18, -8, 12, 3, 3, 12, -8, 18,
  8, -4, 3, 2, 2, 3, -4, 8,
  8, -4, 3, 2, 2, 3, -4, 8,
  18, -8, 12, 3, 3, 12, -8, 18,
  -35, -55, -8, -4, -4, -8, -55, -35,
  140, -35, 18, 8, 8, 18, -35, 140,
]);
const toIndex = (row: number, col: number) => row * BOARD_SIZE + col;
const CORNERS = Object.freeze([toIndex(0, 0), toIndex(0, 7), toIndex(7, 0), toIndex(7, 7)]);
const CORNER_ADJACENCIES = Object.freeze([
  { corner: toIndex(0, 0), neighbors: [toIndex(0, 1), toIndex(1, 0), toIndex(1, 1)] },
  { corner: toIndex(0, 7), neighbors: [toIndex(0, 6), toIndex(1, 7), toIndex(1, 6)] },
  { corner: toIndex(7, 0), neighbors: [toIndex(7, 1), toIndex(6, 0), toIndex(6, 1)] },
  { corner: toIndex(7, 7), neighbors: [toIndex(7, 6), toIndex(6, 7), toIndex(6, 6)] },
]);
const DIRECTIONS = Object.freeze([
  [-1, -1], [-1, 0], [-1, 1], [0, -1],
  [0, 1], [1, -1], [1, 0], [1, 1],
] as const);

// 探索内部ではv1と同じ軽量な盤面処理を使う。公開境界の入力検証と
// Worker結果の合法性検証はSharedルールで行い、探索ノードごとのfreezeを避ける。
const opponentOf = (color: Color): Color => color === BLACK ? 2 : BLACK;
const getFlipsForMove = (board: Board, color: Color, row: number, col: number): number[] => {
  const index = toIndex(row, col);
  if (board[index] !== EMPTY) return [];
  const opponent = opponentOf(color);
  const flips: number[] = [];
  for (const [rowStep, colStep] of DIRECTIONS) {
    let nextRow = row + rowStep;
    let nextCol = col + colStep;
    const line: number[] = [];
    while (nextRow >= 0 && nextRow < BOARD_SIZE && nextCol >= 0 && nextCol < BOARD_SIZE && board[toIndex(nextRow, nextCol)] === opponent) {
      line.push(toIndex(nextRow, nextCol));
      nextRow += rowStep;
      nextCol += colStep;
    }
    if (line.length > 0 && nextRow >= 0 && nextRow < BOARD_SIZE && nextCol >= 0 && nextCol < BOARD_SIZE && board[toIndex(nextRow, nextCol)] === color) flips.push(...line);
  }
  return flips;
};
const getLegalMoves = (board: Board, color: Color): LegalMove[] => {
  const moves: LegalMove[] = [];
  for (let index = 0; index < BOARD_CELLS; index += 1) {
    if (board[index] !== EMPTY) continue;
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    const flips = getFlipsForMove(board, color, row, col);
    if (flips.length > 0) moves.push({ index, row, col, flips });
  }
  return moves;
};
const applyMove = (board: Board, color: Color, move: LegalMove): Board => {
  const flips = getFlipsForMove(board, color, move.row, move.col);
  const nextBoard = board.slice() as Cell[];
  nextBoard[move.index] = color;
  for (const index of flips) nextBoard[index] = color;
  return nextBoard;
};
const countStones = (board: Board) => {
  let black = 0;
  let white = 0;
  let empty = 0;
  for (const cell of board) {
    if (cell === BLACK) black += 1;
    else if (cell === EMPTY) empty += 1;
    else white += 1;
  }
  return { black, white, empty };
};

type CacheFlag = 'exact' | 'lower' | 'upper';
export type LegacyCacheEntry = Readonly<{ depth: number; score: number; flag: CacheFlag; bestMoveIndex: number | null }>;
export type LegacyTranspositionTable = Map<string, LegacyCacheEntry>;

export type LegacySearchOptions = Readonly<{
  random?: () => number;
  now?: () => number;
  timeLimitMs?: number;
  maxDepth?: number;
  endgameThreshold?: number;
  shouldCancel?: () => boolean;
  transpositionTable?: LegacyTranspositionTable;
  maxCacheEntries?: number;
}>;

export type LegacySearchResult = Readonly<{ move: LegalMove | null; diagnostics: CpuSearchDiagnostics }>;

export class SearchTimeoutError extends Error {
  constructor() { super('CPU探索が制限時間に達しました。'); this.name = 'SearchTimeoutError'; }
}
export class SearchCancelledError extends Error {
  constructor() { super('CPU探索を中止しました。'); this.name = 'SearchCancelledError'; }
}

type SearchContext = {
  now: () => number;
  startedAt: number;
  deadline: number;
  shouldCancel: () => boolean;
  table: LegacyTranspositionTable;
  maxCacheEntries: number;
  nodes: number;
  cacheHits: number;
  check(): void;
};

const isCpuLevel = (level: string): level is CpuLevel => Object.values(CPU_LEVELS).some((value) => value === level);
const chooseRandom = (moves: ReadonlyArray<LegalMove>, random: () => number) => {
  const value = Math.min(Math.max(random(), 0), 0.999999999);
  return moves[Math.floor(value * moves.length)] as LegalMove;
};
const stoneDifference = (board: Board, color: Color) => {
  const counts = countStones(board);
  return color === BLACK ? counts.black - counts.white : counts.white - counts.black;
};
const positionalDifference = (board: Board, color: Color) => board.reduce<number>((score, cell, index) => {
  if (cell === color) return score + (POSITION_WEIGHTS[index] ?? 0);
  if (cell === opponentOf(color)) return score - (POSITION_WEIGHTS[index] ?? 0);
  return score;
}, 0);
const cornerDifference = (board: Board, color: Color) => CORNERS.reduce((score, index) => {
  if (board[index] === color) return score + 1;
  if (board[index] === opponentOf(color)) return score - 1;
  return score;
}, 0);
const dangerDifference = (board: Board, color: Color) => {
  let score = 0;
  for (const { corner, neighbors } of CORNER_ADJACENCIES) {
    if (board[corner] !== EMPTY) continue;
    for (const index of neighbors) {
      if (board[index] === color) score -= 1;
      else if (board[index] === opponentOf(color)) score += 1;
    }
  }
  return score;
};
const isInside = (row: number, col: number) => row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
const frontierCount = (board: Board, color: Color) => {
  let count = 0;
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== color) continue;
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    if (DIRECTIONS.some(([rowStep, colStep]) => {
      const nextRow = row + rowStep;
      const nextCol = col + colStep;
      return isInside(nextRow, nextCol) && board[toIndex(nextRow, nextCol)] === EMPTY;
    })) count += 1;
  }
  return count;
};
const potentialMobility = (board: Board, color: Color) => {
  const opponent = opponentOf(color);
  let count = 0;
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) continue;
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    if (DIRECTIONS.some(([rowStep, colStep]) => {
      const nextRow = row + rowStep;
      const nextCol = col + colStep;
      return isInside(nextRow, nextCol) && board[toIndex(nextRow, nextCol)] === opponent;
    })) count += 1;
  }
  return count;
};
const stableEdgeCount = (board: Board, color: Color) => {
  const stable = new Set<number>();
  const rays = [
    { corner: [0, 0], steps: [[0, 1], [1, 0]] },
    { corner: [0, 7], steps: [[0, -1], [1, 0]] },
    { corner: [7, 0], steps: [[0, 1], [-1, 0]] },
    { corner: [7, 7], steps: [[0, -1], [-1, 0]] },
  ] as const;
  for (const { corner: [row, col], steps } of rays) {
    if (board[toIndex(row, col)] !== color) continue;
    stable.add(toIndex(row, col));
    for (const [rowStep, colStep] of steps) {
      let nextRow = row + rowStep;
      let nextCol = col + colStep;
      while (isInside(nextRow, nextCol) && board[toIndex(nextRow, nextCol)] === color) {
        stable.add(toIndex(nextRow, nextCol));
        nextRow += rowStep;
        nextCol += colStep;
      }
    }
  }
  return stable.size;
};
const terminalScore = (board: Board, color: Color) => {
  const difference = stoneDifference(board, color);
  if (difference > 0) return WIN_SCORE + difference * 100;
  if (difference < 0) return -WIN_SCORE + difference * 100;
  return 0;
};

export function evaluateLegacyBoard(board: Board, color: Color): number {
  const opponent = opponentOf(color);
  const counts = countStones(board);
  const mobility = getLegalMoves(board, color).length - getLegalMoves(board, opponent).length;
  const potential = potentialMobility(board, color) - potentialMobility(board, opponent);
  const frontier = frontierCount(board, opponent) - frontierCount(board, color);
  const stable = stableEdgeCount(board, color) - stableEdgeCount(board, opponent);
  const stones = stoneDifference(board, color);
  const position = positionalDifference(board, color);
  const corners = cornerDifference(board, color);
  const danger = dangerDifference(board, color);
  if (counts.empty > 44) return position * 2 + mobility * 22 + potential * 7 + frontier * 9 + corners * 450 + danger * 75 + stable * 45 - stones * 2;
  if (counts.empty > 16) return position * 2 + mobility * 18 + potential * 5 + frontier * 7 + corners * 500 + danger * 65 + stable * 60 + stones * 2;
  return position + mobility * 10 + potential * 2 + frontier * 3 + corners * 600 + danger * 35 + stable * 85 + stones * 18;
}

export function evaluateLegacyMove(board: Board, color: Color, move: LegalMove): number {
  const nextBoard = applyMove(board, color, move);
  let positionScore = 0;
  if (CORNERS.includes(move.index)) positionScore += 1000;
  if (CORNER_ADJACENCIES.some(({ neighbors }) => neighbors.includes(move.index))) positionScore -= 120;
  if (move.row === 0 || move.row === 7 || move.col === 0 || move.col === 7) positionScore += 35;
  return positionScore - getLegalMoves(nextBoard, opponentOf(color)).length * 18 + stoneDifference(nextBoard, color) * 2 + move.flips.length;
}

const createContext = (options: Required<Pick<LegacySearchOptions, 'now' | 'timeLimitMs' | 'shouldCancel' | 'maxCacheEntries'>> & { transpositionTable: LegacyTranspositionTable }): SearchContext => {
  const startedAt = options.now();
  return {
    now: options.now,
    startedAt,
    deadline: startedAt + Math.max(0, options.timeLimitMs),
    shouldCancel: options.shouldCancel,
    table: options.transpositionTable,
    maxCacheEntries: options.maxCacheEntries,
    nodes: 0,
    cacheHits: 0,
    check() {
      this.nodes += 1;
      if (this.shouldCancel()) throw new SearchCancelledError();
      if (this.now() >= this.deadline) throw new SearchTimeoutError();
    },
  };
};
const boardKey = (board: Board, color: Color) => `${color}:${board.join('')}`;
const orderedMoves = (board: Board, color: Color, moves: ReadonlyArray<LegalMove>, preferredIndex: number | null | undefined, endgame: boolean) => moves.map((move) => {
  const nextBoard = applyMove(board, color, move);
  let score = (POSITION_WEIGHTS[move.index] ?? 0) * 12 - getLegalMoves(nextBoard, opponentOf(color)).length * 24;
  if (move.index === preferredIndex) score += 100_000;
  if (CORNERS.includes(move.index)) score += 50_000;
  if (endgame) score += move.flips.length * 4;
  return { move, score };
}).sort((left, right) => right.score - left.score || left.move.index - right.move.index).map(({ move }) => move);
const readCache = (context: SearchContext, key: string, depth: number, alpha: number, beta: number) => {
  const entry = context.table.get(key);
  if (!entry || entry.depth < depth) return { entry, hit: false, score: null as number | null };
  context.cacheHits += 1;
  if (entry.flag === 'exact' || (entry.flag === 'lower' && entry.score >= beta) || (entry.flag === 'upper' && entry.score <= alpha)) return { entry, hit: true, score: entry.score };
  return { entry, hit: false, score: null as number | null };
};
const storeCache = (context: SearchContext, key: string, value: LegacyCacheEntry) => {
  if (context.table.size >= context.maxCacheEntries && !context.table.has(key)) return;
  const existing = context.table.get(key);
  if (!existing || value.depth >= existing.depth) context.table.set(key, value);
};
const negamax = (board: Board, color: Color, depth: number, initialAlpha: number, beta: number, context: SearchContext): number => {
  context.check();
  const moves = getLegalMoves(board, color);
  if (moves.length === 0) {
    const opponent = opponentOf(color);
    if (getLegalMoves(board, opponent).length === 0) return terminalScore(board, color);
    return -negamax(board, opponent, depth, -beta, -initialAlpha, context);
  }
  if (depth === 0) return evaluateLegacyBoard(board, color);
  const key = boardKey(board, color);
  const cached = readCache(context, key, depth, initialAlpha, beta);
  if (cached.hit) return cached.score as number;
  const alphaAtStart = initialAlpha;
  let alpha = initialAlpha;
  let bestScore = -Infinity;
  let bestMoveIndex: number | null = null;
  for (const move of orderedMoves(board, color, moves, cached.entry?.bestMoveIndex, countStones(board).empty <= LEGACY_EXPERT_ENDGAME_THRESHOLD)) {
    const score = -negamax(applyMove(board, color, move), opponentOf(color), depth - 1, -beta, -alpha, context);
    if (score > bestScore) { bestScore = score; bestMoveIndex = move.index; }
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }
  const flag: CacheFlag = bestScore <= alphaAtStart ? 'upper' : bestScore >= beta ? 'lower' : 'exact';
  storeCache(context, key, { depth, score: bestScore, flag, bestMoveIndex });
  return bestScore;
};
const searchRoot = (board: Board, color: Color, depth: number, context: SearchContext, preferredIndex: number) => {
  context.check();
  const candidates = orderedMoves(board, color, getLegalMoves(board, color), preferredIndex, countStones(board).empty <= LEGACY_EXPERT_ENDGAME_THRESHOLD);
  let alpha = -Infinity;
  let bestMove = candidates[0] as LegalMove;
  let bestScore = -Infinity;
  for (const move of candidates) {
    const score = -negamax(applyMove(board, color, move), opponentOf(color), depth - 1, -Infinity, -alpha, context);
    if (score > bestScore) { bestScore = score; bestMove = move; }
    alpha = Math.max(alpha, score);
  }
  return { move: bestMove, score: bestScore };
};
const immediateResult = (move: LegalMove | null, level: CpuLevel, startedAt: number, now: () => number): LegacySearchResult => ({
  move,
  diagnostics: { level, completedDepth: 0, timedOut: false, cancelled: false, exactRequested: false, exactCompleted: false, nodes: 0, cacheHits: 0, cacheSize: 0, durationMs: Math.max(0, now() - startedAt) },
});

export function analyzeLegacyCpuMove(board: Board, color: Color, level: CpuLevel, options: LegacySearchOptions = {}): LegacySearchResult {
  assertBoard(board);
  assertColor(color);
  if (!isCpuLevel(level)) throw new TypeError('未対応のCPU難易度です。');
  const now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  const startedAt = now();
  const legalMoves = getLegalMoves(board, color);
  if (legalMoves.length === 0) return immediateResult(null, level, startedAt, now);
  if (level === CPU_LEVELS.EASY) return immediateResult(chooseRandom(legalMoves, options.random ?? Math.random), level, startedAt, now);
  if (level === CPU_LEVELS.NORMAL) {
    const scored = legalMoves.map((move) => ({ move, score: evaluateLegacyMove(board, color, move) }));
    const highest = Math.max(...scored.map(({ score }) => score));
    return immediateResult((scored.find(({ score }) => score === highest) as { move: LegalMove }).move, level, startedAt, now);
  }
  const defaults = LEGACY_SEARCH_LIMITS[level];
  const counts = countStones(board);
  const exactThreshold = options.endgameThreshold ?? LEGACY_EXPERT_ENDGAME_THRESHOLD;
  const exactRequested = level === CPU_LEVELS.EXPERT && counts.empty <= exactThreshold;
  const configuredDepth = options.maxDepth ?? defaults.maxDepth;
  const targetDepth = exactRequested ? Math.max(configuredDepth, counts.empty) : configuredDepth;
  const table = options.transpositionTable ?? new Map<string, LegacyCacheEntry>();
  const context = createContext({ now, timeLimitMs: options.timeLimitMs ?? defaults.timeLimitMs, shouldCancel: options.shouldCancel ?? (() => false), transpositionTable: table, maxCacheEntries: options.maxCacheEntries ?? MAX_CACHE_ENTRIES });
  let bestMove = legalMoves[0] as LegalMove;
  let bestScore = -Infinity;
  let completedDepth = 0;
  let timedOut = false;
  let cancelled = false;
  try {
    for (let depth = 1; depth <= targetDepth; depth += 1) {
      const result = searchRoot(board, color, depth, context, bestMove.index);
      bestMove = result.move;
      bestScore = result.score;
      completedDepth = depth;
      if (Math.abs(bestScore) >= WIN_SCORE && !exactRequested) break;
    }
  } catch (error) {
    if (error instanceof SearchTimeoutError) timedOut = true;
    else if (error instanceof SearchCancelledError) cancelled = true;
    else throw error;
  }
  return {
    move: bestMove,
    diagnostics: { level, completedDepth, timedOut, cancelled, exactRequested, exactCompleted: exactRequested && completedDepth >= counts.empty, score: Number.isFinite(bestScore) ? bestScore : null, nodes: context.nodes, cacheHits: context.cacheHits, cacheSize: table.size, durationMs: Math.max(0, now() - context.startedAt) },
  };
}
