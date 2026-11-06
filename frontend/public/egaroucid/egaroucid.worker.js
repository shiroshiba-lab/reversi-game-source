/*
 * Egaroucid classic Worker entry point.
 *
 * This file intentionally lives under public/ so Vite serves and copies it
 * without adding ES module syntax. Emscripten's ai.js is a classic script and
 * must continue to be loaded with importScripts() inside a classic Worker.
 */
'use strict';

const worker = self;
let initialization = null;
let initialized = false;
let engine = null;

const post = (message) => worker.postMessage(message);
const errorText = (error) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);

function initialize(config) {
  if (initialization) return initialization;
  const startedAt = performance.now();
  initialization = (async () => {
    const response = await fetch(config.aiWasmUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`WASMの読込に失敗しました（HTTP ${response.status}）。`);
    const wasmBinary = await response.arrayBuffer();
    await new Promise((resolve, reject) => {
      const module = {
        wasmBinary,
        locateFile: (path) => path.endsWith('.wasm') ? config.aiWasmUrl : new URL(path, config.aiJsUrl).href,
        print: () => {},
        printErr: () => {},
        onAbort: (reason) => reject(new Error(`WASM aborted: ${String(reason)}`)),
        onRuntimeInitialized: () => {
          try {
            const compileAndRuntimeMs = performance.now() - startedAt;
            const initStartedAt = performance.now();
            const percentagePointer = module._malloc(4);
            if (!percentagePointer) throw new RangeError('Egaroucidの初期化用memoryを確保できませんでした。');
            module._init_ai(percentagePointer);
            module._free(percentagePointer);
            module._set_seed(config.seed >>> 0);
            engine = module;
            initialized = true;
            post({
              type: 'ready',
              metrics: {
                compileAndRuntimeMs,
                initMs: performance.now() - initStartedAt,
                totalReadyMs: performance.now() - startedAt,
                linearMemoryBytes: module.HEAPU8.buffer.byteLength,
              },
            });
            resolve();
          } catch (error) {
            reject(error);
          }
        },
      };
      worker.Module = module;
      try {
        importScripts(config.aiJsUrl);
      } catch (error) {
        reject(error);
      }
    });
  })();
  initialization.catch((error) => post({ type: 'failed', error: errorText(error) }));
  return initialization;
}

function search(request) {
  if (!initialized || !engine) throw new Error('Egaroucidは初期化されていません。');
  if (request.fault === 'spin') {
    const until = performance.now() + 60_000;
    while (performance.now() < until) { /* watchdog test */ }
  }
  if (request.fault === 'trap') throw new WebAssembly.RuntimeError('simulated trap');
  if (request.fault === 'memory') throw new RangeError('simulated allocation failure');

  const startedAt = performance.now();
  const pointer = engine._malloc(64 * Int32Array.BYTES_PER_ELEMENT);
  if (!pointer) throw new RangeError('Egaroucidの探索用memoryを確保できませんでした。');
  try {
    const converted = Int32Array.from(request.board, (cell) => cell === 0 ? -1 : cell - 1);
    engine.HEAP32.set(converted, pointer >> 2);
    engine._set_seed(request.seed >>> 0);
    const encoded = engine._ai_js(pointer, request.level, request.color - 1, request.useBook ? 1 : 0);
    const index = Math.floor(encoded / 1000);
    const low = engine._get_last_nodes_low() >>> 0;
    const high = engine._get_last_nodes_high() >>> 0;
    const result = {
      move: { index, row: Math.floor(index / 8), col: index % 8 },
      diagnostics: {
        engine: 'egaroucid',
        level: request.level,
        completedDepth: engine._get_last_depth(),
        timedOut: false,
        cancelled: false,
        exactRequested: false,
        exactCompleted: engine._get_last_is_end_search() !== 0,
        score: engine._get_last_score(),
        nodes: high * 4294967296 + low,
        cacheHits: 0,
        cacheSize: 0,
        durationMs: performance.now() - startedAt,
        useBook: request.useBook,
        bookHit: engine._get_last_book_hit() !== 0,
        linearMemoryBytes: engine.HEAPU8.buffer.byteLength,
      },
    };
    if (request.fault === 'illegal') result.move = { index: 63, row: 7, col: 7 };
    if (request.fault === 'bad-pass') result.move = null;
    const response = {
      type: 'result',
      requestId: request.requestId,
      gameId: request.gameId,
      generationId: request.generationId,
      result,
    };
    if (request.fault === 'stale') post({ ...response, requestId: `${request.requestId}-stale` });
    post(response);
    if (request.fault === 'duplicate') post(response);
  } finally {
    engine._free(pointer);
  }
}

worker.addEventListener('message', async (event) => {
  const message = event.data;
  try {
    if (message.type === 'init') await initialize(message);
    if (message.type === 'search') search(message);
  } catch (error) {
    post({
      type: message.type === 'init' ? 'failed' : 'error',
      ...(message.type === 'search' ? {
        requestId: message.requestId,
        gameId: message.gameId,
        generationId: message.generationId,
      } : {}),
      error: errorText(error),
    });
  }
});
