import { useEffect, useMemo, useReducer, useRef } from 'react';
import { BLACK, GAME_MODES, GAME_STATUSES, WHITE, countStones, getLegalMoves } from '@reversi/shared';
import type { CpuEngine, CpuSearchRequest } from './cpu/CpuEngine.ts';
import {
  cpuConfigFor,
  createSetupState,
  gameReducer,
  isCpuTurn,
  isHumanTurn,
} from './gameReducer.ts';
import { loadSettings, normalizeSettings, saveSettings } from './settings.ts';
import type { GameSettings, GameSnapshot, PendingCpuRequest } from './types.ts';
import {
  CPU_ENGINES,
  EGAROUCID_HIGH_LOAD_GAME_BUDGET_MS,
  EGAROUCID_NORMAL_GAME_BUDGET_MS,
  cpuConfigForColor,
  egaroucidSearchTimeoutMs,
  isHighLoadEgaroucidLevel,
  type CpuEngineAvailabilityMap,
} from './cpu/cpuConfig.ts';

const createId = (prefix: string) => globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random()}`;

export type GameController = Readonly<{
  snapshot: GameSnapshot;
  cpuAvailability: CpuEngineAvailabilityMap;
  start(settings: GameSettings): void;
  move(index: number): void;
  restart(): void;
  goToSetup(): void;
  pause(): void;
  resume(): void;
  step(): void;
  updateSpeed(speed: number): void;
}>;

export function useGameController(cpuEngine: CpuEngine | null = null): GameController {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => createSetupState(0, loadSettings()));
  const engineLifecycle = useRef(0);
  const activeEngine = useRef<CpuEngine | null>(cpuEngine);

  const shouldScheduleCpu = cpuEngine !== null
    && isCpuTurn(state)
    && state.pendingCpuRequest === null
    && (state.status === GAME_STATUSES.PLAYING
      || (state.status === GAME_STATUSES.PAUSED && state.stepRequested));
  const cpuConfig = cpuConfigFor(state);
  const cpuAvailability = useMemo<CpuEngineAvailabilityMap>(() => Object.freeze({
    [CPU_ENGINES.LEGACY]: cpuEngine?.getAvailability?.(CPU_ENGINES.LEGACY) ?? Object.freeze({
      available: cpuEngine !== null,
      reason: 'このブラウザではCPU用Web Workerを利用できません。',
    }),
    [CPU_ENGINES.EGAROUCID]: cpuEngine?.getAvailability?.(CPU_ENGINES.EGAROUCID) ?? Object.freeze({
      available: false,
      reason: '高性能AIはこの実行環境へ接続されていません。',
    }),
  }), [cpuEngine]);

  useEffect(() => {
    if (!shouldScheduleCpu || state.gameId === null) return undefined;
    const stayPaused = state.status === GAME_STATUSES.PAUSED;
    const delay = stayPaused ? 0 : state.settings.mode === GAME_MODES.CPU_CPU ? state.settings.speed : 420;
    const handle = window.setTimeout(() => {
      const request: PendingCpuRequest = Object.freeze({
        requestId: createId('request'),
        gameId: state.gameId as string,
        generationId: state.generationId,
        board: state.board,
        color: state.turn,
        config: cpuConfig,
        stayPaused,
      });
      dispatch({ type: 'CPU_REQUESTED', request });
    }, delay);
    return () => window.clearTimeout(handle);
  }, [cpuConfig, shouldScheduleCpu, state.board, state.gameId, state.generationId, state.settings.mode, state.settings.speed, state.status, state.stepRequested, state.turn]);

  useEffect(() => {
    const pending = state.pendingCpuRequest;
    if (!cpuEngine || !pending) return undefined;
    const abortController = new AbortController();
    const cpuConfigs = state.settings.mode === GAME_MODES.CPU_CPU
      ? [cpuConfigForColor(state.settings, BLACK), cpuConfigForColor(state.settings, WHITE)]
      : [pending.config];
    const highLoadMatch = cpuConfigs.some((config) => config.engine === CPU_ENGINES.EGAROUCID && isHighLoadEgaroucidLevel(config.level));
    const gameBudgetMs = highLoadMatch ? EGAROUCID_HIGH_LOAD_GAME_BUDGET_MS : EGAROUCID_NORMAL_GAME_BUDGET_MS;
    const remainingGameBudgetMs = Math.max(0, gameBudgetMs - state.cpuElapsedMs);
    if (pending.config.engine === CPU_ENGINES.EGAROUCID && remainingGameBudgetMs === 0) {
      dispatch({ type: 'CPU_FAILED', request: pending, error: '高性能AIの一局あたり探索時間上限に達しました。' });
      return undefined;
    }
    const request: CpuSearchRequest = {
      requestId: pending.requestId,
      gameId: pending.gameId,
      generationId: pending.generationId,
      board: pending.board,
      color: pending.color,
      config: pending.config,
      ...(pending.config.engine === CPU_ENGINES.EGAROUCID ? {
        timeoutMs: Math.min(egaroucidSearchTimeoutMs(pending.config.level), remainingGameBudgetMs),
      } : {}),
    };
    let gameBudgetExpired = false;
    const gameBudgetTimeout = pending.config.engine === CPU_ENGINES.EGAROUCID
      ? window.setTimeout(() => {
        gameBudgetExpired = true;
        abortController.abort();
      }, remainingGameBudgetMs)
      : null;
    const startedAt = performance.now();
    void cpuEngine.search(request, abortController.signal, (phase) => dispatch({ type: 'CPU_PHASE', request: pending, phase })).then(
      (result) => {
        if (result.requestId !== request.requestId || result.gameId !== request.gameId || result.generationId !== request.generationId) {
          dispatch({ type: 'CPU_FAILED', request: pending, error: 'CPU応答の識別情報が要求と一致しません。' });
          return;
        }
        dispatch({ type: 'CPU_RESOLVED', request: pending, move: result.move });
      },
      (error: unknown) => {
        if (gameBudgetExpired) {
          dispatch({ type: 'CPU_FAILED', request: pending, error: '高性能AIの一局あたり探索時間上限に達しました。' });
          return;
        }
        if (abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
        dispatch({ type: 'CPU_FAILED', request: pending, error: error instanceof Error ? error.message : 'CPU処理に失敗しました。' });
      },
    ).finally(() => {
      if (gameBudgetTimeout !== null) window.clearTimeout(gameBudgetTimeout);
      if (pending.config.engine === CPU_ENGINES.EGAROUCID) dispatch({
        type: 'CPU_TIME_RECORDED',
        gameId: pending.gameId,
        generationId: pending.generationId,
        durationMs: Math.max(0, performance.now() - startedAt),
      });
    });
    return () => abortController.abort();
  }, [cpuEngine, state.cpuElapsedMs, state.pendingCpuRequest, state.settings]);

  useEffect(() => {
    const lifecycle = engineLifecycle.current + 1;
    engineLifecycle.current = lifecycle;
    activeEngine.current = cpuEngine;
    return () => {
      queueMicrotask(() => {
        if (engineLifecycle.current === lifecycle || activeEngine.current !== cpuEngine) cpuEngine?.dispose();
      });
    };
  }, [cpuEngine]);

  const snapshot = useMemo<GameSnapshot>(() => Object.freeze({
    ...state,
    counts: countStones(state.board),
    legalMoves: state.status === GAME_STATUSES.PLAYING || state.status === GAME_STATUSES.PAUSED
      ? getLegalMoves(state.board, state.turn)
      : Object.freeze([]),
    cpuThinking: state.pendingCpuRequest !== null || shouldScheduleCpu,
    isHumanTurn: isHumanTurn(state),
    isCpuTurn: isCpuTurn(state),
  }), [shouldScheduleCpu, state]);

  return Object.freeze({
    snapshot,
    cpuAvailability,
    start(settings: GameSettings) {
      const normalized = normalizeSettings(settings);
      const requiredConfigs = normalized.mode === GAME_MODES.CPU_CPU
        ? [cpuConfigForColor(normalized, BLACK), cpuConfigForColor(normalized, WHITE)]
        : normalized.mode === GAME_MODES.HUMAN_CPU
          ? [cpuConfigForColor(normalized, normalized.humanColor === BLACK ? WHITE : BLACK)]
          : [];
      if (requiredConfigs.some((config) => !cpuAvailability[config.engine].available)) return;
      saveSettings(normalized);
      dispatch({ type: 'START', settings: normalized, gameId: createId('game') });
    },
    move(index: number) { dispatch({ type: 'HUMAN_MOVE', index }); },
    restart() { dispatch({ type: 'RESTART', gameId: createId('game') }); },
    goToSetup() { dispatch({ type: 'SETUP' }); },
    pause() { dispatch({ type: 'PAUSE' }); },
    resume() { dispatch({ type: 'RESUME' }); },
    step() { dispatch({ type: 'STEP' }); },
    updateSpeed(speed: number) {
      const settings = normalizeSettings({ ...state.settings, speed });
      saveSettings(settings);
      dispatch({ type: 'UPDATE_SPEED', settings });
    },
  });
}
