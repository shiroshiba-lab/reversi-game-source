export {
  BLACK,
  BOARD_CELLS,
  BOARD_SIZE,
  CPU_LEVELS,
  EMPTY,
  GAME_MODES,
  GAME_SPEEDS,
  GAME_STATUSES,
  SCHEMA_VERSION,
  WHITE,
  type Board,
  type Cell,
  type Color,
  type CpuLevel,
  type GameMode,
  type GameSpeed,
  type GameStatus,
  type LegalMove,
  type MoveInput,
  type Position,
  type StoneCounts,
  type TurnResolution,
  type Winner,
} from './constants.js';
export {
  IllegalMoveError,
  InvalidGameStateError,
  InvalidReversiInputError,
} from './errors.js';
export {
  applyMove,
  assertBoard,
  assertColor,
  coordinateOf,
  countStones,
  createInitialBoard,
  determineWinner,
  fromIndex,
  getFlipsForMove,
  getLegalMoves,
  isInside,
  opponentOf,
  resolveTurnAndGameEnd,
  toIndex,
} from './rules.js';
export {
  decodeGameStateV1,
  parseGameStateV1,
  serializeGameStateV1,
  type LegacyRuntimeFieldsV1,
  type LegacySerializedGameStateV1,
  type SerializableGameStateV1,
} from './serialization.js';

export const migrationFoundation = Object.freeze({
  task: 'Task 06',
  message: 'React + TypeScript + Vite の開発基盤を構築しました。',
});
