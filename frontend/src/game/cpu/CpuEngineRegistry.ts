import type { CpuEngine, CpuSearchPhase, CpuSearchRequest, CpuSearchResult } from './CpuEngine.ts';
import { CPU_ENGINES, type CpuEngineAvailability, type CpuEngineId } from './cpuConfig.ts';

export class CpuEngineRegistry implements CpuEngine {
  constructor(
    private readonly engines: Readonly<Partial<Record<CpuEngineId, CpuEngine>>>,
    private readonly unavailableReasons: Readonly<Partial<Record<CpuEngineId, string>>> = {},
  ) {}

  getAvailability(engine: CpuEngineId): CpuEngineAvailability {
    if (this.engines[engine]) return Object.freeze({ available: true });
    return Object.freeze({
      available: false,
      reason: this.unavailableReasons[engine] ?? (engine === CPU_ENGINES.EGAROUCID
        ? 'このブラウザでは高性能AIに必要なWeb Worker／WebAssemblyを利用できません。'
        : 'このブラウザではCPU用Web Workerを利用できません。'),
    });
  }

  search(request: CpuSearchRequest, signal: AbortSignal, onPhase?: (phase: CpuSearchPhase) => void): Promise<CpuSearchResult> {
    const engine = this.engines[request.config.engine];
    if (!engine) return Promise.reject(new Error(this.getAvailability(request.config.engine).reason ?? '選択したCPUエンジンを利用できません。'));
    return engine.search(request, signal, onPhase);
  }

  dispose(): void {
    new Set(Object.values(this.engines)).forEach((engine) => engine?.dispose());
  }
}
