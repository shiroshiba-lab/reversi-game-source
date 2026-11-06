import { CPU_LEVELS, createInitialBoard, getLegalMoves } from '@reversi/shared';
import { describe, expect, it, vi } from 'vitest';
import type { CpuSearchDiagnostics, CpuSearchRequest } from './CpuEngine.ts';
import { LegacyCpuWorkerAdapter, type WorkerLike } from './LegacyCpuWorkerAdapter.ts';
import type { LegacyCpuWorkerRequest, LegacyCpuWorkerResponse } from './legacyCpuProtocol.ts';

const diagnostics: CpuSearchDiagnostics = { level: CPU_LEVELS.NORMAL, completedDepth: 0, timedOut: false, cancelled: false, exactRequested: false, exactCompleted: false, nodes: 0, cacheHits: 0, cacheSize: 0, durationMs: 1 };
const request = (overrides: Partial<CpuSearchRequest> = {}): CpuSearchRequest => ({ requestId: 'request-1', gameId: 'game-1', generationId: 1, board: createInitialBoard(), color: 1, config: { engine: 'legacy', level: CPU_LEVELS.NORMAL }, ...overrides });

class FakeWorker {
  listeners = new Map<string, (event: Event | MessageEvent) => void>();
  message: LegacyCpuWorkerRequest | null = null;
  terminated = false;
  addEventListener(type: string, listener: (event: Event | MessageEvent) => void) { this.listeners.set(type, listener); }
  postMessage(message: LegacyCpuWorkerRequest) { this.message = message; }
  terminate() { this.terminated = true; }
  emitMessage(response: LegacyCpuWorkerResponse) { this.listeners.get('message')?.(new MessageEvent('message', { data: response })); }
  emitError(message = 'worker boom') { this.listeners.get('error')?.(new ErrorEvent('error', { message })); }
}

const createHarness = () => {
  const workers: FakeWorker[] = [];
  const adapter = new LegacyCpuWorkerAdapter(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as WorkerLike;
  });
  return { adapter, workers };
};
const responseFor = (worker: FakeWorker, moveIndex: number | null): LegacyCpuWorkerResponse => {
  const sent = worker.message as LegacyCpuWorkerRequest;
  const legal = moveIndex === null ? null : getLegalMoves(sent.board, sent.color).find(({ index }) => index === moveIndex);
  return { requestId: sent.requestId, gameId: sent.gameId, generationId: sent.generationId, result: { move: legal ? { index: legal.index, row: legal.row, col: legal.col } : null, diagnostics } };
};

describe('LegacyCpuWorkerAdapter', () => {
  it('IDが一致する合法手を返し、盤面はcopyして送る', async () => {
    const { adapter, workers } = createHarness();
    const input = request();
    const pending = adapter.search(input, new AbortController().signal);
    expect(workers[0]?.message?.board).not.toBe(input.board);
    workers[0]?.emitMessage(responseFor(workers[0] as FakeWorker, 19));
    await expect(pending).resolves.toMatchObject({ requestId: input.requestId, move: { index: 19 } });
  });

  it('古いID・対局・世代の応答と重複応答を無視する', async () => {
    const { adapter, workers } = createHarness();
    const pending = adapter.search(request(), new AbortController().signal);
    const valid = responseFor(workers[0] as FakeWorker, 19);
    workers[0]?.emitMessage({ ...valid, requestId: 'stale' });
    workers[0]?.emitMessage({ ...valid, gameId: 'other' });
    workers[0]?.emitMessage({ ...valid, generationId: 2 });
    workers[0]?.emitMessage(valid);
    workers[0]?.emitMessage(valid);
    await expect(pending).resolves.toMatchObject({ move: { index: 19 } });
  });

  it('AbortとdisposeでWorkerを終了し未完了Promiseを拒否する', async () => {
    const first = createHarness();
    const controller = new AbortController();
    const aborted = first.adapter.search(request(), controller.signal);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(first.workers[0]?.terminated).toBe(true);

    const second = createHarness();
    const disposed = second.adapter.search(request(), new AbortController().signal);
    second.adapter.dispose();
    await expect(disposed).rejects.toMatchObject({ name: 'AbortError' });
    expect(second.workers[0]?.terminated).toBe(true);
  });

  it('非合法着手と不正passを拒否してWorkerを再生成できる', async () => {
    const { adapter, workers } = createHarness();
    const illegal = adapter.search(request(), new AbortController().signal);
    const sent = workers[0]?.message as LegacyCpuWorkerRequest;
    workers[0]?.emitMessage({ requestId: sent.requestId, gameId: sent.gameId, generationId: sent.generationId, result: { move: { index: 0, row: 0, col: 0 }, diagnostics } });
    await expect(illegal).rejects.toThrow('非合法');
    expect(workers[0]?.terminated).toBe(true);

    const badPass = adapter.search(request({ requestId: 'request-2' }), new AbortController().signal);
    workers[1]?.emitMessage(responseFor(workers[1] as FakeWorker, null));
    await expect(badPass).rejects.toThrow('不正なパス');
  });

  it('Worker例外・初期化失敗・応答timeoutを安全に拒否する', async () => {
    const errorHarness = createHarness();
    const workerError = errorHarness.adapter.search(request(), new AbortController().signal);
    errorHarness.workers[0]?.emitError();
    await expect(workerError).rejects.toThrow('worker boom');

    const failedInit = new LegacyCpuWorkerAdapter(() => { throw new Error('init boom'); });
    await expect(failedInit.search(request(), new AbortController().signal)).rejects.toThrow('init boom');

    vi.useFakeTimers();
    const timeoutHarness = createHarness();
    const timeout = timeoutHarness.adapter.search(request({ deadlineMs: Date.now() + 10 }), new AbortController().signal);
    const timeoutExpectation = expect(timeout).rejects.toThrow('制限時間内');
    await vi.advanceTimersByTimeAsync(11);
    await timeoutExpectation;
    expect(timeoutHarness.workers[0]?.terminated).toBe(true);
    vi.useRealTimers();
  });

  it('Workerのerror応答と要求自体の不正を拒否する', async () => {
    const { adapter, workers } = createHarness();
    const failed = adapter.search(request(), new AbortController().signal);
    const sent = workers[0]?.message as LegacyCpuWorkerRequest;
    workers[0]?.emitMessage({ requestId: sent.requestId, gameId: sent.gameId, generationId: sent.generationId, error: 'search boom' });
    await expect(failed).rejects.toThrow('search boom');
    await expect(adapter.search(request({ board: [0] }), new AbortController().signal)).rejects.toThrow();
  });
});
