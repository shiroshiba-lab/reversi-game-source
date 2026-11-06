import {
  BLACK,
  BOARD_CELLS,
  BOARD_SIZE,
  EMPTY,
  WHITE,
  type Board,
  type Cell,
  type Color,
  type LegalMove,
  type MoveInput,
  type Position,
  type StoneCounts,
  type TurnResolution,
  type Winner,
} from './constants.js';
import { IllegalMoveError, InvalidReversiInputError } from './errors.js';

const DIRECTIONS = Object.freeze([
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],            [0, 1],
  [1, -1],  [1, 0],   [1, 1],
] as const);

function isCell(value: unknown): value is Cell {
  return value === EMPTY || value === BLACK || value === WHITE;
}

export function assertBoard(board: unknown): asserts board is Board {
  if (!Array.isArray(board) || board.length !== BOARD_CELLS) {
    throw new InvalidReversiInputError('盤面は64要素の配列である必要があります。');
  }
  if (!board.every(isCell)) {
    throw new InvalidReversiInputError('盤面には0、1、2だけを指定できます。');
  }
}

export function assertColor(color: unknown): asserts color is Color {
  if (color !== BLACK && color !== WHITE) {
    throw new InvalidReversiInputError('手番には黒（1）または白（2）を指定してください。');
  }
}

function assertCoordinate(value: unknown, name: 'row' | 'col'): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= BOARD_SIZE) {
    throw new InvalidReversiInputError(`${name}は0から7までの整数である必要があります。`);
  }
}

function assertIndex(index: unknown): asserts index is number {
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= BOARD_CELLS) {
    throw new InvalidReversiInputError('indexは0から63までの整数である必要があります。');
  }
}

export function isInside(row: number, col: number): boolean {
  return Number.isInteger(row)
    && Number.isInteger(col)
    && row >= 0
    && row < BOARD_SIZE
    && col >= 0
    && col < BOARD_SIZE;
}

export function toIndex(row: number, col: number): number {
  assertCoordinate(row, 'row');
  assertCoordinate(col, 'col');
  return row * BOARD_SIZE + col;
}

export function fromIndex(index: number): Position {
  assertIndex(index);
  return Object.freeze({
    index,
    row: Math.floor(index / BOARD_SIZE),
    col: index % BOARD_SIZE,
  });
}

function normalizeMove(move: MoveInput): Position {
  if (typeof move !== 'object' || move === null) {
    throw new InvalidReversiInputError('着手位置を指定してください。');
  }

  const hasIndex = 'index' in move && move.index !== undefined;
  const hasRow = 'row' in move && move.row !== undefined;
  const hasCol = 'col' in move && move.col !== undefined;

  if (hasIndex) assertIndex(move.index);
  if (hasRow) assertCoordinate(move.row, 'row');
  if (hasCol) assertCoordinate(move.col, 'col');
  if (hasRow !== hasCol || (!hasIndex && !hasRow)) {
    throw new InvalidReversiInputError('着手位置はindex、またはrowとcolの組で指定してください。');
  }

  const position = hasIndex
    ? fromIndex(move.index)
    : Object.freeze({
        index: toIndex(move.row as number, move.col as number),
        row: move.row as number,
        col: move.col as number,
      });

  if (hasIndex && hasRow && (position.row !== move.row || position.col !== move.col)) {
    throw new InvalidReversiInputError('indexとrow／colが同じマスを示していません。');
  }
  return position;
}

export function opponentOf(color: Color): Color {
  assertColor(color);
  return color === BLACK ? WHITE : BLACK;
}

export function createInitialBoard(): Board {
  const board: Cell[] = Array<Cell>(BOARD_CELLS).fill(EMPTY);
  board[toIndex(3, 3)] = WHITE;
  board[toIndex(3, 4)] = BLACK;
  board[toIndex(4, 3)] = BLACK;
  board[toIndex(4, 4)] = WHITE;
  return Object.freeze(board);
}

export function getFlipsForMove(
  board: Board,
  color: Color,
  row: number,
  col: number,
): ReadonlyArray<number> {
  assertBoard(board);
  assertColor(color);
  assertCoordinate(row, 'row');
  assertCoordinate(col, 'col');

  const moveIndex = toIndex(row, col);
  if (board[moveIndex] !== EMPTY) return Object.freeze([]);

  const opponent = opponentOf(color);
  const flips: number[] = [];

  for (const [rowStep, colStep] of DIRECTIONS) {
    let nextRow = row + rowStep;
    let nextCol = col + colStep;
    const line: number[] = [];

    while (isInside(nextRow, nextCol) && board[nextRow * BOARD_SIZE + nextCol] === opponent) {
      line.push(nextRow * BOARD_SIZE + nextCol);
      nextRow += rowStep;
      nextCol += colStep;
    }

    if (
      line.length > 0
      && isInside(nextRow, nextCol)
      && board[nextRow * BOARD_SIZE + nextCol] === color
    ) {
      flips.push(...line);
    }
  }

  return Object.freeze(flips);
}

export function getLegalMoves(board: Board, color: Color): ReadonlyArray<LegalMove> {
  assertBoard(board);
  assertColor(color);
  const moves: LegalMove[] = [];

  for (let index = 0; index < BOARD_CELLS; index += 1) {
    if (board[index] !== EMPTY) continue;
    const { row, col } = fromIndex(index);
    const flips = getFlipsForMove(board, color, row, col);
    if (flips.length > 0) {
      moves.push(Object.freeze({ index, row, col, flips }));
    }
  }

  return Object.freeze(moves);
}

export function applyMove(board: Board, color: Color, move: MoveInput): Board {
  assertBoard(board);
  assertColor(color);
  const position = normalizeMove(move);
  const flips = getFlipsForMove(board, color, position.row, position.col);
  if (flips.length === 0) throw new IllegalMoveError();

  const nextBoard = [...board];
  nextBoard[position.index] = color;
  for (const index of flips) nextBoard[index] = color;
  return Object.freeze(nextBoard);
}

export function countStones(board: Board): StoneCounts {
  assertBoard(board);
  let black = 0;
  let white = 0;
  let empty = 0;

  for (const cell of board) {
    if (cell === BLACK) black += 1;
    else if (cell === WHITE) white += 1;
    else empty += 1;
  }
  return Object.freeze({ black, white, empty });
}

export function determineWinner(board: Board): Winner {
  const { black, white } = countStones(board);
  if (black === white) return 'draw';
  return black > white ? BLACK : WHITE;
}

export function resolveTurnAndGameEnd(board: Board, previousColor: Color): TurnResolution {
  assertBoard(board);
  assertColor(previousColor);
  const counts = countStones(board);

  if (counts.empty === 0) {
    return Object.freeze({
      nextTurn: null,
      passes: Object.freeze([]),
      finished: true,
      winner: determineWinner(board),
    });
  }

  const candidate = opponentOf(previousColor);
  if (getLegalMoves(board, candidate).length > 0) {
    return Object.freeze({
      nextTurn: candidate,
      passes: Object.freeze([]),
      finished: false,
      winner: null,
    });
  }
  if (getLegalMoves(board, previousColor).length > 0) {
    return Object.freeze({
      nextTurn: previousColor,
      passes: Object.freeze([candidate]),
      finished: false,
      winner: null,
    });
  }
  return Object.freeze({
    nextTurn: null,
    passes: Object.freeze([candidate, previousColor]),
    finished: true,
    winner: determineWinner(board),
  });
}

export function coordinateOf(index: number): string {
  const { row, col } = fromIndex(index);
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}
