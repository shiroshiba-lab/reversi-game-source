import {
  BLACK,
  GAME_MODES,
  GAME_STATUSES,
  SCHEMA_VERSION,
  applyMove,
  coordinateOf,
  countStones,
  createInitialBoard,
  getLegalMoves,
  resolveTurnAndGameEnd,
  type Color,
  type Position,
} from '@reversi/shared';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.ts';
import { getFlippedIndices } from './boardTransition.ts';
import type { GameSettings, GameState, PendingCpuRequest } from './types.ts';
import { cpuConfigForColor } from './cpu/cpuConfig.ts';
import type { CpuSearchPhase } from './cpu/CpuEngine.ts';

const colorName = (color: Color) => color === BLACK ? '黒' : '白';

export type GameAction =
  | Readonly<{ type: 'START'; settings: GameSettings; gameId: string }>
  | Readonly<{ type: 'HUMAN_MOVE'; index: number }>
  | Readonly<{ type: 'CPU_REQUESTED'; request: PendingCpuRequest }>
  | Readonly<{ type: 'CPU_PHASE'; request: PendingCpuRequest; phase: CpuSearchPhase }>
  | Readonly<{ type: 'CPU_TIME_RECORDED'; gameId: string; generationId: number; durationMs: number }>
  | Readonly<{ type: 'CPU_RESOLVED'; request: PendingCpuRequest; move: Position | null }>
  | Readonly<{ type: 'CPU_FAILED'; request: PendingCpuRequest; error: string }>
  | Readonly<{ type: 'PAUSE' }>
  | Readonly<{ type: 'RESUME' }>
  | Readonly<{ type: 'STEP' }>
  | Readonly<{ type: 'UPDATE_SPEED'; settings: GameSettings }>
  | Readonly<{ type: 'RESTART'; gameId: string }>
  | Readonly<{ type: 'SETUP' }>;

export function createSetupState(generationId = 0, settings = DEFAULT_SETTINGS): GameState {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    gameId: null,
    board: createInitialBoard(),
    settings,
    turn: BLACK,
    status: GAME_STATUSES.SETUP,
    moveCount: 0,
    lastMove: null,
    flippedIndices: Object.freeze([]),
    winner: null,
    generationId,
    pendingCpuRequest: null,
    cpuPhase: null,
    cpuElapsedMs: 0,
    stepRequested: false,
    message: '対局設定を選んでください。',
    messageKind: 'info',
  });
}

function createPlayingState(settings: GameSettings, gameId: string, generationId: number): GameState {
  return Object.freeze({
    ...createSetupState(generationId, normalizeSettings(settings)),
    gameId,
    status: GAME_STATUSES.PLAYING,
    message: '対局を開始しました。黒の手番です。',
  });
}

export function isHumanTurn(state: GameState): boolean {
  return state.settings.mode === GAME_MODES.HUMAN_HUMAN
    || (state.settings.mode === GAME_MODES.HUMAN_CPU && state.turn === state.settings.humanColor);
}

export function isCpuTurn(state: GameState): boolean {
  return state.settings.mode === GAME_MODES.CPU_CPU
    || (state.settings.mode === GAME_MODES.HUMAN_CPU && state.turn !== state.settings.humanColor);
}

function fail(state: GameState, message: string): GameState {
  return Object.freeze({
    ...state,
    status: GAME_STATUSES.ERROR,
    generationId: state.generationId + 1,
    pendingCpuRequest: null,
    cpuPhase: null,
    stepRequested: false,
    message: `進行を安全に停止しました。もう一度お試しください。（${message}）`,
    messageKind: 'error',
  });
}

function performMove(state: GameState, index: number, stayPaused: boolean): GameState {
  const move = getLegalMoves(state.board, state.turn).find((candidate) => candidate.index === index);
  if (!move) {
    return isHumanTurn(state)
      ? Object.freeze({ ...state, message: 'そこには置けません。', messageKind: 'warning' })
      : fail(state, 'CPUが非合法な着手を返しました。');
  }

  const board = applyMove(state.board, state.turn, move);
  const flippedIndices = getFlippedIndices(state.board, board, index);
  const resolution = resolveTurnAndGameEnd(board, state.turn);
  if (resolution.finished) {
    const counts = countStones(board);
    const result = counts.black === counts.white
      ? `${counts.black}対${counts.white}で引き分けです。`
      : `${counts.black > counts.white ? '黒' : '白'}の勝ちです（黒${counts.black}・白${counts.white}）。`;
    return Object.freeze({
      ...state,
      board,
      lastMove: index,
      flippedIndices,
      moveCount: state.moveCount + 1,
      status: GAME_STATUSES.FINISHED,
      winner: resolution.winner,
      pendingCpuRequest: null,
      cpuPhase: null,
      stepRequested: false,
      message: `対局終了。${result}`,
      messageKind: 'finished',
    });
  }

  const message = resolution.passes.length > 0
    ? `${colorName(resolution.passes[0] as Color)}は置けないためパス。${colorName(resolution.nextTurn)}の手番です。`
    : `${colorName(state.turn)}が${coordinateOf(index)}に置きました。${colorName(resolution.nextTurn)}の手番です。`;
  return Object.freeze({
    ...state,
    board,
    turn: resolution.nextTurn,
    lastMove: index,
    flippedIndices,
    moveCount: state.moveCount + 1,
    status: stayPaused ? GAME_STATUSES.PAUSED : GAME_STATUSES.PLAYING,
    pendingCpuRequest: null,
    cpuPhase: null,
    stepRequested: false,
    message,
    messageKind: resolution.passes.length > 0 ? 'pass' : 'move',
  });
}

function sameRequest(state: GameState, request: PendingCpuRequest): boolean {
  const pending = state.pendingCpuRequest;
  return pending !== null
    && pending.requestId === request.requestId
    && pending.gameId === request.gameId
    && pending.generationId === request.generationId
    && state.gameId === request.gameId
    && state.generationId === request.generationId
    && state.turn === request.color;
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START':
      return createPlayingState(action.settings, action.gameId, state.generationId + 1);
    case 'RESTART':
      return state.gameId === null
        ? state
        : createPlayingState(state.settings, action.gameId, state.generationId + 1);
    case 'SETUP':
      return createSetupState(state.generationId + 1, state.settings);
    case 'HUMAN_MOVE':
      if (state.status !== GAME_STATUSES.PLAYING || !isHumanTurn(state) || state.pendingCpuRequest) return state;
      return performMove(state, action.index, false);
    case 'CPU_REQUESTED':
      if (
        state.pendingCpuRequest
        || !isCpuTurn(state)
        || action.request.gameId !== state.gameId
        || action.request.generationId !== state.generationId
        || action.request.color !== state.turn
        || (state.status !== GAME_STATUSES.PLAYING && state.status !== GAME_STATUSES.PAUSED)
        || (state.status === GAME_STATUSES.PAUSED && !state.stepRequested)
      ) return state;
      return Object.freeze({ ...state, pendingCpuRequest: action.request, cpuPhase: null });
    case 'CPU_PHASE':
      return sameRequest(state, action.request) ? Object.freeze({ ...state, cpuPhase: action.phase }) : state;
    case 'CPU_TIME_RECORDED':
      return state.gameId === action.gameId
        ? Object.freeze({ ...state, cpuElapsedMs: state.cpuElapsedMs + Math.max(0, action.durationMs) })
        : state;
    case 'CPU_RESOLVED':
      if (!sameRequest(state, action.request)) return state;
      if (action.move === null) return fail(state, 'CPUの手番に合法手がありません。');
      return performMove(state, action.move.index, action.request.stayPaused);
    case 'CPU_FAILED':
      return sameRequest(state, action.request) ? fail(state, action.error) : state;
    case 'PAUSE':
      if (state.settings.mode !== GAME_MODES.CPU_CPU || state.status !== GAME_STATUSES.PLAYING) return state;
      return Object.freeze({
        ...state,
        status: GAME_STATUSES.PAUSED,
        generationId: state.generationId + 1,
        pendingCpuRequest: null,
        cpuPhase: null,
        stepRequested: false,
        message: '一時停止しました。「一手進める」で1手だけ観戦できます。',
        messageKind: 'paused',
      });
    case 'RESUME':
      if (state.settings.mode !== GAME_MODES.CPU_CPU || state.status !== GAME_STATUSES.PAUSED) return state;
      return Object.freeze({ ...state, status: GAME_STATUSES.PLAYING, stepRequested: false, message: '観戦を再開しました。', messageKind: 'info' });
    case 'STEP':
      if (state.settings.mode !== GAME_MODES.CPU_CPU || state.status !== GAME_STATUSES.PAUSED || state.pendingCpuRequest) return state;
      return Object.freeze({ ...state, stepRequested: true });
    case 'UPDATE_SPEED':
      return Object.freeze({ ...state, settings: normalizeSettings(action.settings), generationId: state.generationId + 1, pendingCpuRequest: null, cpuPhase: null });
    default:
      return state;
  }
}

export function cpuConfigFor(state: GameState) {
  return cpuConfigForColor(state.settings, state.turn);
}
