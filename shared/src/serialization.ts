import {
  BLACK,
  BOARD_CELLS,
  CPU_LEVELS,
  GAME_MODES,
  GAME_SPEEDS,
  GAME_STATUSES,
  SCHEMA_VERSION,
  WHITE,
  type Board,
  type Color,
  type CpuLevel,
  type GameMode,
  type GameSpeed,
  type GameStatus,
  type Winner,
} from './constants.js';
import { InvalidGameStateError } from './errors.js';
import {
  assertBoard,
  countStones,
  createInitialBoard,
  determineWinner,
  getLegalMoves,
} from './rules.js';

export type SerializableGameStateV1 = Readonly<{
  schemaVersion: typeof SCHEMA_VERSION;
  gameId: string | null;
  board: Board;
  mode: GameMode | null;
  turn: Color;
  humanColor: Color | null;
  cpuLevelBlack: CpuLevel | null;
  cpuLevelWhite: CpuLevel | null;
  speed: GameSpeed;
  status: GameStatus;
  moveCount: number;
  lastMove: number | null;
  winner: Winner | null;
}>;

/** v1.1.0のserialize()に含まれるが、永続状態の正本にしない実行時／表示情報。 */
export type LegacyRuntimeFieldsV1 = Readonly<{
  generationId: number;
  cpuThinking: boolean;
  lastCpuSearch: unknown;
  message: string;
  messageKind: string;
}>;

export type LegacySerializedGameStateV1 = SerializableGameStateV1 & LegacyRuntimeFieldsV1;

const MODES = new Set<string>(Object.values(GAME_MODES));
const LEVELS = new Set<string>(Object.values(CPU_LEVELS));
const STATUSES = new Set<string>(Object.values(GAME_STATUSES));
const SPEEDS = new Set<number>(Object.values(GAME_SPEEDS));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new InvalidGameStateError(message);
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${field}は空でない文字列またはnullである必要があります。`);
  }
  return value;
}

function readColor(value: unknown, field: string): Color {
  if (value !== BLACK && value !== WHITE) {
    fail(`${field}は黒（1）または白（2）である必要があります。`);
  }
  return value;
}

function readNullableColor(value: unknown, field: string): Color | null {
  return value === null ? null : readColor(value, field);
}

function readEnum<T extends string>(value: unknown, values: Set<string>, field: string): T {
  if (typeof value !== 'string' || !values.has(value)) {
    fail(`${field}に未対応の値が指定されています。`);
  }
  return value as T;
}

function readNullableLevel(value: unknown, field: string): CpuLevel | null {
  return value === null ? null : readEnum<CpuLevel>(value, LEVELS, field);
}

function readInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    fail(`${field}は${min}から${max}までの整数である必要があります。`);
  }
  return value as number;
}

function readWinner(value: unknown): Winner | null {
  if (value === null || value === 'draw' || value === BLACK || value === WHITE) return value;
  return fail('winnerは黒（1）、白（2）、draw、nullのいずれかである必要があります。');
}

function boardsEqual(left: Board, right: Board): boolean {
  return left.every((cell, index) => cell === right[index]);
}

function validateModeSettings(state: SerializableGameStateV1): void {
  if (state.status === GAME_STATUSES.SETUP) {
    if (
      state.gameId !== null
      || state.mode !== null
      || state.humanColor !== null
      || state.cpuLevelBlack !== null
      || state.cpuLevelWhite !== null
      || state.turn !== BLACK
      || state.moveCount !== 0
      || state.lastMove !== null
      || state.winner !== null
      || !boardsEqual(state.board, createInitialBoard())
    ) {
      fail('setup状態はv1.1.0の初期対局状態と一致する必要があります。');
    }
    return;
  }

  if (state.gameId === null || state.mode === null) {
    fail('対局中の状態にはgameIdとmodeが必要です。');
  }
  if (state.mode === GAME_MODES.HUMAN_HUMAN) {
    if (state.humanColor !== null || state.cpuLevelBlack !== null || state.cpuLevelWhite !== null) {
      fail('人対人では担当色とCPU難易度を指定できません。');
    }
  } else if (state.mode === GAME_MODES.HUMAN_CPU) {
    if (state.humanColor === null) fail('人対CPUではhumanColorが必要です。');
    const blackIsCpu = state.humanColor === WHITE;
    if (
      (blackIsCpu && (state.cpuLevelBlack === null || state.cpuLevelWhite !== null))
      || (!blackIsCpu && (state.cpuLevelBlack !== null || state.cpuLevelWhite === null))
    ) {
      fail('人対CPUの難易度はCPU担当色だけに指定してください。');
    }
  } else if (
    state.humanColor !== null
    || state.cpuLevelBlack === null
    || state.cpuLevelWhite === null
  ) {
    fail('CPU対CPUでは両色のCPU難易度が必要です。');
  }
  if (state.status === GAME_STATUSES.PAUSED && state.mode !== GAME_MODES.CPU_CPU) {
    fail('paused状態はCPU対CPUでのみ使用できます。');
  }
}

function validateBoardState(state: SerializableGameStateV1): void {
  const counts = countStones(state.board);
  if (counts.black + counts.white !== state.moveCount + 4) {
    fail('moveCountは初期4石から実際に石を置いた回数と一致する必要があります。');
  }
  if ((state.moveCount === 0) !== (state.lastMove === null)) {
    fail('lastMoveは着手前だけnullで、着手後は直前のindexである必要があります。');
  }
  if (state.lastMove !== null && state.board[state.lastMove] === 0) {
    fail('lastMoveは石が置かれているマスを示す必要があります。');
  }

  if (state.status === GAME_STATUSES.FINISHED) {
    if (state.winner === null || state.winner !== determineWinner(state.board)) {
      fail('finished状態のwinnerは盤面から求めた勝敗と一致する必要があります。');
    }
    if (getLegalMoves(state.board, BLACK).length > 0 || getLegalMoves(state.board, WHITE).length > 0) {
      fail('finished状態では黒白双方に合法手がない必要があります。');
    }
  } else if (state.winner !== null) {
    fail('winnerはfinished状態でのみ指定できます。');
  }

  if (
    (state.status === GAME_STATUSES.PLAYING || state.status === GAME_STATUSES.PAUSED)
    && getLegalMoves(state.board, state.turn).length === 0
  ) {
    fail('進行中のturnには1つ以上の合法手が必要です。');
  }
}

export function decodeGameStateV1(input: unknown): SerializableGameStateV1 {
  if (!isRecord(input)) fail('対局状態はオブジェクトである必要があります。');
  if (input.schemaVersion !== SCHEMA_VERSION) {
    fail('未対応のschemaVersionです。schemaVersion 1だけを読み込めます。');
  }

  try {
    assertBoard(input.board);
  } catch (error) {
    throw new InvalidGameStateError('boardが不正です。', { cause: error });
  }
  const board = Object.freeze([...input.board]);
  const mode = input.mode === null ? null : readEnum<GameMode>(input.mode, MODES, 'mode');
  const speed = SPEEDS.has(input.speed as number)
    ? input.speed as GameSpeed
    : fail('speedに未対応の値が指定されています。');
  const state: SerializableGameStateV1 = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    gameId: readNullableString(input.gameId, 'gameId'),
    board,
    mode,
    turn: readColor(input.turn, 'turn'),
    humanColor: readNullableColor(input.humanColor, 'humanColor'),
    cpuLevelBlack: readNullableLevel(input.cpuLevelBlack, 'cpuLevelBlack'),
    cpuLevelWhite: readNullableLevel(input.cpuLevelWhite, 'cpuLevelWhite'),
    speed,
    status: readEnum<GameStatus>(input.status, STATUSES, 'status'),
    moveCount: readInteger(input.moveCount, 'moveCount', 0, 60),
    lastMove: input.lastMove === null
      ? null
      : readInteger(input.lastMove, 'lastMove', 0, BOARD_CELLS - 1),
    winner: readWinner(input.winner),
  });

  validateModeSettings(state);
  validateBoardState(state);
  return state;
}

export function parseGameStateV1(serialized: string): SerializableGameStateV1 {
  if (typeof serialized !== 'string') {
    fail('シリアライズ済み対局状態は文字列である必要があります。');
  }
  let input: unknown;
  try {
    input = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new InvalidGameStateError('対局状態のJSONを解析できません。', { cause: error });
  }
  return decodeGameStateV1(input);
}

export function serializeGameStateV1(state: unknown): string {
  return JSON.stringify(decodeGameStateV1(state));
}
