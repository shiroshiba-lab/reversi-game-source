/// <reference lib="webworker" />
import { analyzeLegacyCpuMove } from '../legacySearch.ts';
import type { LegacyCpuWorkerRequest, LegacyCpuWorkerResponse } from '../legacyCpuProtocol.ts';

const worker = self as DedicatedWorkerGlobalScope;

worker.addEventListener('message', (event: MessageEvent<LegacyCpuWorkerRequest>) => {
  const { requestId, gameId, generationId, board, color, level } = event.data;
  try {
    const result = analyzeLegacyCpuMove(Object.freeze([...board]), color, level);
    const response: LegacyCpuWorkerResponse = { requestId, gameId, generationId, result };
    worker.postMessage(response);
  } catch (error) {
    const response: LegacyCpuWorkerResponse = {
      requestId,
      gameId,
      generationId,
      error: error instanceof Error ? error.message : 'CPU探索に失敗しました。',
    };
    worker.postMessage(response);
  }
});
