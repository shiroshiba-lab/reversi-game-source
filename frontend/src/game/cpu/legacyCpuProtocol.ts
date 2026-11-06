import type { Board, Color, CpuLevel } from '@reversi/shared';
import type { CpuSearchDiagnostics } from './CpuEngine.ts';

export type LegacyCpuWorkerRequest = Readonly<{
  requestId: string;
  gameId: string;
  generationId: number;
  board: Board;
  color: Color;
  level: CpuLevel;
}>;

export type LegacyCpuWorkerResponse = Readonly<{
  requestId: string;
  gameId: string;
  generationId: number;
  result?: Readonly<{ move: Readonly<{ index: number; row: number; col: number }> | null; diagnostics: CpuSearchDiagnostics }>;
  error?: string;
}>;
