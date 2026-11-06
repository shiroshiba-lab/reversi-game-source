import { assertBoard, assertColor, fromIndex, getLegalMoves, type Position } from '@reversi/shared';
import type { CpuEngine, CpuSearchPhase, CpuSearchRequest, CpuSearchResult } from './CpuEngine.ts';
import type { EgaroucidWorkerRequest, EgaroucidWorkerResponse } from './egaroucidProtocol.ts';
import { CPU_ENGINES, EGAROUCID_HIGH_LOAD_SEARCH_TIMEOUT_MS, EGAROUCID_INIT_TIMEOUT_MS, isEgaroucidLevel } from './cpuConfig.ts';

type WorkerEvents = Pick<globalThis.WorkerEventMap, 'message' | 'messageerror' | 'error'>;
export type EgaroucidWorkerLike = Pick<Worker, 'postMessage' | 'terminate'> & {
  addEventListener<K extends keyof WorkerEvents>(type: K, listener: (event: WorkerEvents[K]) => void): void;
};
export type EgaroucidWorkerFactory = () => EgaroucidWorkerLike;

type ActiveSearch = {
  request: CpuSearchRequest;
  resolve(result: CpuSearchResult): void;
  reject(error: Error): void;
  signal: AbortSignal;
  abort(): void;
  timeout: ReturnType<typeof setTimeout>;
};

export type EgaroucidAdapterOptions = Readonly<{
  createWorker?: EgaroucidWorkerFactory;
  aiJsUrl?: string;
  aiWasmUrl?: string;
  initTimeoutMs?: number;
  seed?: number;
}>;

export const EGAROUCID_ARTIFACT_TOKEN = 'v7.8.4-64m-max128m-dae7647b-833c1d14';
const abortError = (message = 'Egaroucid探索を中止しました。') => new DOMException(message, 'AbortError');

export class EgaroucidWorkerAdapter implements CpuEngine {
  private worker: EgaroucidWorkerLike | null = null;
  private ready: Promise<void> | null = null;
  private active: ActiveSearch | null = null;
  private disposed = false;
  private readonly createWorker: EgaroucidWorkerFactory;
  private readonly aiJsUrl: string;
  private readonly aiWasmUrl: string;
  private readonly initTimeoutMs: number;
  private readonly seed: number;

  constructor(options: EgaroucidAdapterOptions = {}) {
    const base = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI;
    const workerUrl = new URL(`egaroucid/egaroucid.worker.js?artifact=${EGAROUCID_ARTIFACT_TOKEN}`, base);
    this.createWorker = options.createWorker ?? (() => new Worker(workerUrl, { type: 'classic', name: 'reversi-egaroucid' }));
    this.aiJsUrl = options.aiJsUrl ?? new URL(`egaroucid/ai.js?artifact=${EGAROUCID_ARTIFACT_TOKEN}`, base).href;
    this.aiWasmUrl = options.aiWasmUrl ?? new URL(`egaroucid/ai.wasm?artifact=${EGAROUCID_ARTIFACT_TOKEN}`, base).href;
    this.initTimeoutMs = options.initTimeoutMs ?? EGAROUCID_INIT_TIMEOUT_MS;
    this.seed = options.seed ?? 11;
  }

  async search(request: CpuSearchRequest, signal: AbortSignal, onPhase?: (phase: CpuSearchPhase) => void): Promise<CpuSearchResult> {
    if (this.disposed) throw new Error('Egaroucidエンジンは破棄済みです。');
    this.validateRequest(request);
    if (signal.aborted) throw abortError();
    const legalMoves = getLegalMoves(request.board, request.color);
    if (legalMoves.length === 0) {
      return Object.freeze({ requestId: request.requestId, gameId: request.gameId, generationId: request.generationId, move: null });
    }
    if (this.active) this.stopWorker(abortError('新しい探索のため前のEgaroucid探索を中止しました。'));
    onPhase?.('initializing');
    await this.ensureWorker(signal);
    if (signal.aborted) {
      this.stopWorker(abortError());
      throw abortError();
    }
    onPhase?.('thinking');
    return new Promise((resolve, reject) => {
      const timeoutMs = Math.max(0, request.timeoutMs ?? EGAROUCID_HIGH_LOAD_SEARCH_TIMEOUT_MS);
      const abort = () => this.stopWorker(abortError());
      const timeout = setTimeout(() => this.stopWorker(new Error('Egaroucidの探索が制限時間を超えました。盤面は変更していません。')), timeoutMs);
      this.active = { request, resolve, reject, signal, abort, timeout };
      signal.addEventListener('abort', abort, { once: true });
      const config = request.config;
      if (config.engine !== CPU_ENGINES.EGAROUCID) {
        this.stopWorker(new TypeError('Egaroucid以外の探索要求です。'));
        return;
      }
      const message: EgaroucidWorkerRequest = {
        type: 'search',
        requestId: request.requestId,
        gameId: request.gameId,
        generationId: request.generationId,
        board: Object.freeze([...request.board]),
        color: request.color,
        level: config.level,
        useBook: config.useBook,
        seed: this.seed,
      };
      try {
        this.worker?.postMessage(message);
      } catch (error) {
        this.stopWorker(error instanceof Error ? error : new Error('Egaroucid Workerへ要求を送信できませんでした。'));
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.stopWorker(abortError('Egaroucidエンジンを破棄しました。'));
  }

  private validateRequest(request: CpuSearchRequest): void {
    if (!request.requestId || !request.gameId || !Number.isSafeInteger(request.generationId) || request.generationId < 0) throw new TypeError('Egaroucid要求の識別情報が不正です。');
    assertBoard(request.board);
    assertColor(request.color);
    if (request.config.engine !== CPU_ENGINES.EGAROUCID || !isEgaroucidLevel(request.config.level)) throw new TypeError('Egaroucid Levelは0〜15です。');
    if (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs < 0)) throw new TypeError('Egaroucid探索時間が不正です。');
  }

  private ensureWorker(signal: AbortSignal): Promise<void> {
    if (this.ready) return this.ready;
    let worker: EgaroucidWorkerLike;
    try {
      worker = this.createWorker();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('Egaroucid Workerを作成できませんでした。'));
    }
    this.worker = worker;
    const ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        action();
      };
      const timeout = setTimeout(() => settle(() => {
        const error = new Error('Egaroucidの初期化が12秒以内に完了しませんでした。');
        this.stopWorker(error);
        reject(error);
      }), this.initTimeoutMs);
      const onAbort = () => settle(() => {
        const error = abortError();
        this.stopWorker(error);
        reject(error);
      });
      signal.addEventListener('abort', onAbort, { once: true });
      worker.addEventListener('message', (event) => {
        const response = (event as MessageEvent<EgaroucidWorkerResponse>).data;
        if (response.type === 'ready') settle(resolve);
        else if (response.type === 'failed') settle(() => {
          const error = new Error(response.error ?? 'Egaroucidを初期化できませんでした。');
          this.stopWorker(error);
          reject(error);
        });
        else this.handleMessage(response);
      });
      worker.addEventListener('error', (event) => {
        const error = new Error((event as ErrorEvent).message || 'Egaroucid Workerでエラーが発生しました。');
        if (!settled) settle(() => { this.stopWorker(error); reject(error); });
        else this.stopWorker(error);
      });
      worker.addEventListener('messageerror', () => {
        const error = new Error('Egaroucid Workerの応答を読み取れませんでした。');
        if (!settled) settle(() => { this.stopWorker(error); reject(error); });
        else this.stopWorker(error);
      });
      try {
        worker.postMessage({ type: 'init', aiJsUrl: this.aiJsUrl, aiWasmUrl: this.aiWasmUrl, seed: this.seed } satisfies EgaroucidWorkerRequest);
      } catch (error) {
        settle(() => {
          const failure = error instanceof Error ? error : new Error('Egaroucid Workerを初期化できませんでした。');
          this.stopWorker(failure);
          reject(failure);
        });
      }
    });
    this.ready = ready;
    ready.catch(() => {
      if (this.ready === ready) this.ready = null;
    });
    return ready;
  }

  private handleMessage(response: EgaroucidWorkerResponse): void {
    const active = this.active;
    if (!active || response.requestId !== active.request.requestId || response.gameId !== active.request.gameId || response.generationId !== active.request.generationId) return;
    if (response.type === 'error') {
      this.stopWorker(new Error(response.error ?? 'Egaroucid探索に失敗しました。'));
      return;
    }
    try {
      if (response.type !== 'result' || !response.result) throw new Error('Egaroucid Workerの応答形式が不正です。');
      const legalMoves = getLegalMoves(active.request.board, active.request.color);
      let move: Position | null = null;
      if (response.result.move === null) {
        if (legalMoves.length !== 0) throw new Error('Egaroucidが不正なパスを返しました。');
      } else {
        const legal = legalMoves.find((candidate) => candidate.index === response.result?.move?.index);
        if (!legal || legal.row !== response.result.move.row || legal.col !== response.result.move.col) throw new Error('Egaroucidが非合法な着手を返しました。');
        move = fromIndex(legal.index);
      }
      this.finishActive({
        requestId: active.request.requestId,
        gameId: active.request.gameId,
        generationId: active.request.generationId,
        move,
        diagnostics: response.result.diagnostics,
      });
    } catch (error) {
      this.stopWorker(error instanceof Error ? error : new Error('Egaroucidの応答を検証できませんでした。'));
    }
  }

  private finishActive(result: CpuSearchResult): void {
    const active = this.active;
    if (!active) return;
    clearTimeout(active.timeout);
    active.signal.removeEventListener('abort', active.abort);
    this.active = null;
    active.resolve(result);
  }

  private stopWorker(error: Error): void {
    const active = this.active;
    if (active) {
      clearTimeout(active.timeout);
      active.signal.removeEventListener('abort', active.abort);
      this.active = null;
      active.reject(error);
    }
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}
