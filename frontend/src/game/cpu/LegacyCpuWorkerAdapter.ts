import { CPU_LEVELS, assertBoard, assertColor, getLegalMoves, type Position } from '@reversi/shared';
import type { CpuEngine, CpuSearchPhase, CpuSearchRequest, CpuSearchResult } from './CpuEngine.ts';
import type { LegacyCpuWorkerRequest, LegacyCpuWorkerResponse } from './legacyCpuProtocol.ts';
import { LEGACY_SEARCH_LIMITS } from './legacySearch.ts';
import { CPU_ENGINES, isLegacyCpuLevel } from './cpuConfig.ts';

type CpuWorkerEventMap = Pick<globalThis.WorkerEventMap, 'message' | 'messageerror' | 'error'>;
export type WorkerLike = Pick<Worker, 'postMessage' | 'terminate'> & {
  addEventListener<K extends keyof CpuWorkerEventMap>(type: K, listener: (event: CpuWorkerEventMap[K]) => void): void;
};
export type WorkerFactory = () => WorkerLike;

type ActiveSearch = {
  request: CpuSearchRequest;
  resolve: (result: CpuSearchResult) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  abort: () => void;
  timeout: ReturnType<typeof setTimeout>;
};

const abortError = (message = 'CPU探索を中止しました。') => new DOMException(message, 'AbortError');
const responseBudget = (level: LegacyCpuWorkerRequest['level']) => level === CPU_LEVELS.ADVANCED
  ? LEGACY_SEARCH_LIMITS.advanced.timeLimitMs + 1_000
  : level === CPU_LEVELS.EXPERT ? LEGACY_SEARCH_LIMITS.expert.timeLimitMs + 1_000 : 2_000;
export class LegacyCpuWorkerAdapter implements CpuEngine {
  private worker: WorkerLike | null = null;
  private active: ActiveSearch | null = null;
  private disposed = false;

  constructor(private readonly createWorker: WorkerFactory = () => new Worker(new URL('./workers/legacyCpu.worker.ts', import.meta.url), { type: 'module', name: 'reversi-legacy-cpu' })) {}

  search(request: CpuSearchRequest, signal: AbortSignal, onPhase?: (phase: CpuSearchPhase) => void): Promise<CpuSearchResult> {
    if (this.disposed) return Promise.reject(new Error('CPUエンジンは破棄済みです。'));
    try { this.validateRequest(request); } catch (error) { return Promise.reject(error); }
    if (signal.aborted) return Promise.reject(abortError());
    if (this.active) this.stopWorker(abortError('新しいCPU探索を開始するため、前の探索を中止しました。'));
    try { this.ensureWorker(); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error('CPU Workerを初期化できませんでした。')); }
    onPhase?.('thinking');

    return new Promise((resolve, reject) => {
      const level = request.config.level as LegacyCpuWorkerRequest['level'];
      const deadlineDelay = request.deadlineMs === undefined ? responseBudget(level) : Math.max(0, request.deadlineMs - Date.now());
      const abort = () => this.stopWorker(abortError());
      const timeout = setTimeout(() => this.stopWorker(new Error('CPU Workerから制限時間内に応答がありませんでした。')), deadlineDelay);
      this.active = { request, resolve, reject, signal, abort, timeout };
      signal.addEventListener('abort', abort, { once: true });
      const message: LegacyCpuWorkerRequest = {
        requestId: request.requestId,
        gameId: request.gameId,
        generationId: request.generationId,
        board: Object.freeze([...request.board]),
        color: request.color,
        level,
      };
      try { this.worker?.postMessage(message); } catch (error) { this.stopWorker(error instanceof Error ? error : new Error('CPU Workerへ要求を送信できませんでした。')); }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.stopWorker(abortError('CPUエンジンを破棄しました。'));
  }

  private validateRequest(request: CpuSearchRequest) {
    if (!request.requestId || !request.gameId || !Number.isSafeInteger(request.generationId) || request.generationId < 0) throw new TypeError('CPU要求の識別情報が不正です。');
    assertBoard(request.board);
    assertColor(request.color);
    if (request.config.engine !== CPU_ENGINES.LEGACY || !isLegacyCpuLevel(request.config.level)) throw new TypeError('未対応の既存CPU設定です。');
    if (request.deadlineMs !== undefined && !Number.isFinite(request.deadlineMs)) throw new TypeError('CPU要求の期限が不正です。');
  }

  private ensureWorker() {
    if (this.worker) return;
    const worker = this.createWorker();
    worker.addEventListener('message', (event) => this.handleMessage(event as MessageEvent<LegacyCpuWorkerResponse>));
    worker.addEventListener('error', (event) => this.stopWorker(new Error((event as ErrorEvent).message || 'CPU Workerでエラーが発生しました。')));
    worker.addEventListener('messageerror', () => this.stopWorker(new Error('CPU Workerの応答を読み取れませんでした。')));
    this.worker = worker;
  }

  private handleMessage(event: MessageEvent<LegacyCpuWorkerResponse>) {
    const active = this.active;
    const response = event.data;
    if (!active || response.requestId !== active.request.requestId || response.gameId !== active.request.gameId || response.generationId !== active.request.generationId) return;
    if (response.error) { this.stopWorker(new Error(response.error)); return; }
    try {
      if (!response.result) throw new Error('CPU Workerの応答形式が不正です。');
      const legalMoves = getLegalMoves(active.request.board, active.request.color);
      let move: Position | null = null;
      if (response.result.move === null) {
        if (legalMoves.length !== 0) throw new Error('CPUが不正なパスを返しました。');
      } else {
        const legal = legalMoves.find((candidate) => candidate.index === response.result?.move?.index);
        if (!legal || legal.row !== response.result.move.row || legal.col !== response.result.move.col) throw new Error('CPUが非合法な着手を返しました。');
        move = Object.freeze({ index: legal.index, row: legal.row, col: legal.col });
      }
      this.finishActive({ requestId: response.requestId, gameId: response.gameId, generationId: response.generationId, move, diagnostics: response.result.diagnostics });
    } catch (error) {
      this.stopWorker(error instanceof Error ? error : new Error('CPU Workerの応答を検証できませんでした。'));
    }
  }

  private finishActive(result: CpuSearchResult) {
    const active = this.active;
    if (!active) return;
    clearTimeout(active.timeout);
    active.signal.removeEventListener('abort', active.abort);
    this.active = null;
    active.resolve(result);
  }

  private stopWorker(error: Error) {
    const active = this.active;
    if (active) {
      clearTimeout(active.timeout);
      active.signal.removeEventListener('abort', active.abort);
      this.active = null;
      active.reject(error);
    }
    this.worker?.terminate();
    this.worker = null;
  }
}
