import type { Board, Color, CpuLevel, Position } from '@reversi/shared';
import type { CpuConfig, CpuEngineAvailability, CpuEngineId, EgaroucidLevel } from './cpuConfig.ts';

export type CpuSearchPhase = 'initializing' | 'thinking';

export type CpuSearchRequest = Readonly<{
  requestId: string;
  gameId: string;
  generationId: number;
  board: Board;
  color: Color;
  config: CpuConfig;
  deadlineMs?: number;
  timeoutMs?: number;
}>;

export type CpuSearchDiagnostics = Readonly<{
  level: CpuLevel | EgaroucidLevel;
  completedDepth: number;
  timedOut: boolean;
  cancelled: boolean;
  exactRequested: boolean;
  exactCompleted: boolean;
  score?: number | null;
  nodes: number;
  cacheHits: number;
  cacheSize: number;
  durationMs: number;
  engine?: CpuEngineId;
  useBook?: boolean;
  bookHit?: boolean;
  linearMemoryBytes?: number;
}>;

export type CpuSearchResult = Readonly<{
  requestId: string;
  gameId: string;
  generationId: number;
  move: Position | null;
  diagnostics?: CpuSearchDiagnostics;
}>;

export interface CpuEngine {
  search(request: CpuSearchRequest, signal: AbortSignal, onPhase?: (phase: CpuSearchPhase) => void): Promise<CpuSearchResult>;
  getAvailability?(engine: CpuEngineId): CpuEngineAvailability;
  dispose(): void;
}
