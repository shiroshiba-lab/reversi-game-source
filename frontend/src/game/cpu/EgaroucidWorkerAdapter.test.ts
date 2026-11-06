import { createInitialBoard, getLegalMoves, type Board } from '@reversi/shared';
import { describe, expect, it, vi } from 'vitest';
import type { CpuSearchRequest } from './CpuEngine.ts';
import { EgaroucidWorkerAdapter, type EgaroucidWorkerLike } from './EgaroucidWorkerAdapter.ts';
import type { EgaroucidWorkerRequest, EgaroucidWorkerResponse } from './egaroucidProtocol.ts';
import { EGAROUCID_LEVELS, type EgaroucidLevel } from './cpuConfig.ts';

class FakeWorker {
  listeners = new Map<string, (event: Event | MessageEvent) => void>();
  messages: EgaroucidWorkerRequest[] = [];
  terminated = false;
  addEventListener(type: string, listener: (event: Event | MessageEvent) => void) { this.listeners.set(type, listener); }
  postMessage(message: EgaroucidWorkerRequest) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(response: EgaroucidWorkerResponse) { this.listeners.get('message')?.(new MessageEvent('message', { data: response })); }
  emitError(message = 'worker boom') { this.listeners.get('error')?.(new ErrorEvent('error', { message })); }
  get searchMessage() { return this.messages.slice().reverse().find((message) => message.type === 'search'); }
}

const request = (level: EgaroucidLevel = 4, overrides: Partial<CpuSearchRequest> = {}): CpuSearchRequest => ({
  requestId: `request-${level}`,
  gameId: 'game-1',
  generationId: 1,
  board: createInitialBoard(),
  color: 1,
  config: { engine: 'egaroucid', level, useBook: true },
  timeoutMs: 1_000,
  ...overrides,
});

const boardFromRows = (rows: string[]): Board => Object.freeze(rows.join('').split('').map((cell) => cell === '.' ? 0 : cell === 'B' ? 1 : 2)) as Board;

const responseFor = (message: Extract<EgaroucidWorkerRequest, { type: 'search' }>, moveIndex = 19): EgaroucidWorkerResponse => {
  const legal = getLegalMoves(message.board, message.color).find(({ index }) => index === moveIndex);
  return {
    type: 'result',
    requestId: message.requestId,
    gameId: message.gameId,
    generationId: message.generationId,
    result: {
      move: legal ? { index: legal.index, row: legal.row, col: legal.col } : null,
      diagnostics: {
        engine: 'egaroucid', level: message.level, completedDepth: 1, timedOut: false, cancelled: false,
        exactRequested: false, exactCompleted: false, nodes: 1, cacheHits: 0, cacheSize: 0, durationMs: 1,
        useBook: message.useBook, linearMemoryBytes: 67_108_864,
      },
    },
  };
};

function harness() {
  const workers: FakeWorker[] = [];
  const adapter = new EgaroucidWorkerAdapter({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as EgaroucidWorkerLike;
    },
    aiJsUrl: 'http://localhost/ai.js',
    aiWasmUrl: 'http://localhost/ai.wasm',
    initTimeoutMs: 100,
  });
  return { adapter, workers };
}

async function readyAndSearch(adapter: EgaroucidWorkerAdapter, input: CpuSearchRequest, getWorker: () => FakeWorker, signal = new AbortController().signal) {
  const pending = adapter.search(input, signal);
  const worker = getWorker();
  worker.emit({ type: 'ready', metrics: { compileAndRuntimeMs: 1, initMs: 1, totalReadyMs: 2, linearMemoryBytes: 67_108_864 } });
  await vi.waitFor(() => expect(worker.searchMessage).toBeDefined());
  return { pending };
}

describe('EgaroucidWorkerAdapter', () => {
  it('初回は読み込み中から思考中へ状態を通知する', async () => {
    const { adapter, workers } = harness();
    const phases: string[] = [];
    const pending = adapter.search(request(), new AbortController().signal, (phase) => phases.push(phase));
    expect(phases).toEqual(['initializing']);
    workers[0]?.emit({ type: 'ready', metrics: { compileAndRuntimeMs: 1, initMs: 1, totalReadyMs: 2, linearMemoryBytes: 67_108_864 } });
    await vi.waitFor(() => expect(workers[0]?.searchMessage).toBeDefined());
    expect(phases).toEqual(['initializing', 'thinking']);
    workers[0]?.emit(responseFor(workers[0]?.searchMessage as Extract<EgaroucidWorkerRequest, { type: 'search' }>));
    await expect(pending).resolves.toMatchObject({ move: { index: 19 } });
  });

  it('Level 0〜15を全てWorkerへ送り、合法手だけを返して入力を変更しない', async () => {
    const { adapter, workers } = harness();
    const original = [...createInitialBoard()];
    for (const level of EGAROUCID_LEVELS) {
      const input = request(level, { requestId: `level-${level}` });
      const pending = level === 0
        ? (await readyAndSearch(adapter, input, () => workers[0] as FakeWorker)).pending
        : adapter.search(input, new AbortController().signal);
      const worker = workers[0] as FakeWorker;
      await vi.waitFor(() => expect(worker.searchMessage?.requestId).toBe(`level-${level}`));
      worker.emit(responseFor(worker.searchMessage as Extract<EgaroucidWorkerRequest, { type: 'search' }>));
      await expect(pending).resolves.toMatchObject({ move: { index: 19 } });
      expect(input.board).toEqual(original);
    }
  });

  it('合法手なしはWASMを起動せずpassを返す', async () => {
    const { adapter, workers } = harness();
    const fullBoard = Object.freeze(Array.from({ length: 64 }, () => 1)) as Board;
    await expect(adapter.search(request(4, { board: fullBoard }), new AbortController().signal)).resolves.toMatchObject({ move: null });
    const passBoard = boardFromRows(['BBBBBBBB','BBBBBBBB','BBBBBBBB','BBBBBBBB','BBBBBBBB','BBBBBBBB','BBBBBBBB','BBBBBBW.']);
    await expect(adapter.search(request(4, { board: passBoard, color: 2 }), new AbortController().signal)).resolves.toMatchObject({ move: null });
    expect(workers).toHaveLength(0);
  });

  it('stale応答を無視し、非合法手と不正passでWorkerを終了する', async () => {
    const first = harness();
    const { pending } = await readyAndSearch(first.adapter, request(), () => first.workers[0] as FakeWorker);
    const message = first.workers[0]?.searchMessage as Extract<EgaroucidWorkerRequest, { type: 'search' }>;
    first.workers[0]?.emit({ ...responseFor(message), requestId: 'stale' });
    first.workers[0]?.emit(responseFor(message));
    await expect(pending).resolves.toMatchObject({ move: { index: 19 } });

    const illegalPending = first.adapter.search(request(5, { requestId: 'illegal' }), new AbortController().signal);
    await vi.waitFor(() => expect(first.workers[0]?.searchMessage?.requestId).toBe('illegal'));
    const illegalMessage = first.workers[0]?.searchMessage as Extract<EgaroucidWorkerRequest, { type: 'search' }>;
    const invalid = responseFor(illegalMessage);
    if (!invalid.result) throw new Error('test response missing result');
    first.workers[0]?.emit({ ...invalid, result: { ...invalid.result, move: { index: 0, row: 0, col: 0 } } });
    await expect(illegalPending).rejects.toThrow('非合法');
    expect(first.workers[0]?.terminated).toBe(true);

    const secondPending = first.adapter.search(request(6, { requestId: 'bad-pass' }), new AbortController().signal);
    const secondWorker = first.workers[1] as FakeWorker;
    secondWorker.emit({ type: 'ready', metrics: { compileAndRuntimeMs: 1, initMs: 1, totalReadyMs: 2, linearMemoryBytes: 67_108_864 } });
    await vi.waitFor(() => expect(secondWorker.searchMessage).toBeDefined());
    const badPass = responseFor(secondWorker.searchMessage as Extract<EgaroucidWorkerRequest, { type: 'search' }>);
    if (!badPass.result) throw new Error('test response missing result');
    secondWorker.emit({ ...badPass, result: { ...badPass.result, move: null } });
    await expect(secondPending).rejects.toThrow('不正なパス');
  });

  it('初期化失敗・探索error・Abort後にWorkerを再生成できる', async () => {
    const { adapter, workers } = harness();
    const initFailure = adapter.search(request(), new AbortController().signal);
    workers[0]?.emit({ type: 'failed', error: 'WASM 404' });
    await expect(initFailure).rejects.toThrow('WASM 404');
    expect(workers[0]?.terminated).toBe(true);

    const recovered = adapter.search(request(5, { requestId: 'recovered' }), new AbortController().signal);
    const second = workers[1] as FakeWorker;
    second.emit({ type: 'ready', metrics: { compileAndRuntimeMs: 1, initMs: 1, totalReadyMs: 2, linearMemoryBytes: 67_108_864 } });
    await vi.waitFor(() => expect(second.searchMessage).toBeDefined());
    second.emit(responseFor(second.searchMessage as Extract<EgaroucidWorkerRequest, { type: 'search' }>));
    await expect(recovered).resolves.toMatchObject({ move: { index: 19 } });

    const controller = new AbortController();
    const aborted = adapter.search(request(6, { requestId: 'aborted' }), controller.signal);
    await vi.waitFor(() => expect(second.searchMessage?.requestId).toBe('aborted'));
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(second.terminated).toBe(true);
  });

  it('探索timeoutとmemory相当errorで盤面結果を返さずWorkerを終了する', async () => {
    vi.useFakeTimers();
    const timeoutHarness = harness();
    const timedOut = timeoutHarness.adapter.search(request(4, { timeoutMs: 10 }), new AbortController().signal);
    timeoutHarness.workers[0]?.emit({ type: 'ready', metrics: { compileAndRuntimeMs: 1, initMs: 1, totalReadyMs: 2, linearMemoryBytes: 67_108_864 } });
    await vi.advanceTimersByTimeAsync(1);
    const timeoutExpectation = expect(timedOut).rejects.toThrow('制限時間');
    await vi.advanceTimersByTimeAsync(11);
    await timeoutExpectation;
    expect(timeoutHarness.workers[0]?.terminated).toBe(true);
    vi.useRealTimers();

    const memoryHarness = harness();
    const { pending: failed } = await readyAndSearch(memoryHarness.adapter, request(), () => memoryHarness.workers[0] as FakeWorker);
    const message = memoryHarness.workers[0]?.searchMessage as Extract<EgaroucidWorkerRequest, { type: 'search' }>;
    memoryHarness.workers[0]?.emit({ type: 'error', requestId: message.requestId, gameId: message.gameId, generationId: message.generationId, error: 'RangeError: allocation failure' });
    await expect(failed).rejects.toThrow('allocation failure');
    expect(memoryHarness.workers[0]?.terminated).toBe(true);
  });
});
