import type {
  Board,
  Color,
  CpuLevel,
  GameMode,
  GameSpeed,
  GameStatus,
  LegalMove,
  StoneCounts,
  Winner,
} from '@reversi/shared';
import type { CpuConfig, CpuEngineId, EgaroucidLevel } from './cpu/cpuConfig.ts';
import type { CpuSearchPhase } from './cpu/CpuEngine.ts';

export type GameSettings = Readonly<{
  mode: GameMode;
  humanColor: Color | null;
  cpuEngineBlack: CpuEngineId | null;
  cpuEngineWhite: CpuEngineId | null;
  cpuLevelBlack: CpuLevel | null;
  cpuLevelWhite: CpuLevel | null;
  egaroucidLevelBlack: EgaroucidLevel | null;
  egaroucidLevelWhite: EgaroucidLevel | null;
  egaroucidUseBookBlack: boolean | null;
  egaroucidUseBookWhite: boolean | null;
  speed: GameSpeed;
}>;

export type PendingCpuRequest = Readonly<{
  requestId: string;
  gameId: string;
  generationId: number;
  board: Board;
  color: Color;
  config: CpuConfig;
  stayPaused: boolean;
}>;

export type GameState = Readonly<{
  schemaVersion: 1;
  gameId: string | null;
  board: Board;
  settings: GameSettings;
  turn: Color;
  status: GameStatus;
  moveCount: number;
  lastMove: number | null;
  flippedIndices: ReadonlyArray<number>;
  winner: Winner | null;
  generationId: number;
  pendingCpuRequest: PendingCpuRequest | null;
  cpuPhase: CpuSearchPhase | null;
  cpuElapsedMs: number;
  stepRequested: boolean;
  message: string;
  messageKind: 'info' | 'move' | 'pass' | 'paused' | 'finished' | 'warning' | 'error';
}>;

export type GameSnapshot = GameState & Readonly<{
  counts: StoneCounts;
  legalMoves: ReadonlyArray<LegalMove>;
  cpuThinking: boolean;
  isHumanTurn: boolean;
  isCpuTurn: boolean;
}>;
