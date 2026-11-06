import type { Board, Color } from '@reversi/shared';
import type { CpuSearchDiagnostics } from './CpuEngine.ts';
import type { EgaroucidLevel } from './cpuConfig.ts';

export type EgaroucidWorkerInitRequest = Readonly<{
  type: 'init';
  aiJsUrl: string;
  aiWasmUrl: string;
  seed: number;
}>;

export type EgaroucidWorkerSearchRequest = Readonly<{
  type: 'search';
  requestId: string;
  gameId: string;
  generationId: number;
  board: Board;
  color: Color;
  level: EgaroucidLevel;
  useBook: boolean;
  seed: number;
  fault?: 'spin' | 'trap' | 'memory' | 'illegal' | 'bad-pass' | 'stale' | 'duplicate';
}>;

export type EgaroucidWorkerRequest = EgaroucidWorkerInitRequest | EgaroucidWorkerSearchRequest;

export type EgaroucidWorkerResponse = Readonly<{
  type: 'ready' | 'failed' | 'result' | 'error';
  requestId?: string;
  gameId?: string;
  generationId?: number;
  metrics?: Readonly<{
    compileAndRuntimeMs: number;
    initMs: number;
    totalReadyMs: number;
    linearMemoryBytes: number;
  }>;
  result?: Readonly<{
    move: Readonly<{ index: number; row: number; col: number }> | null;
    diagnostics: CpuSearchDiagnostics;
  }>;
  error?: string;
}>;
