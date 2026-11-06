import { BLACK, CPU_LEVELS, GAME_MODES, GAME_SPEEDS, GAME_STATUSES, type Board, type Cell } from '@reversi/shared';
import { describe, expect, it } from 'vitest';
import { createSetupState, gameReducer } from './gameReducer.ts';
import { normalizeSettings } from './settings.ts';
import type { GameState, PendingCpuRequest } from './types.ts';

const humanHuman = normalizeSettings({ mode: GAME_MODES.HUMAN_HUMAN, speed: GAME_SPEEDS.NORMAL });
const board = (rows: string[]): Board => Object.freeze(rows.join('').split('').map((cell) => ({ '.': 0, B: 1, W: 2 })[cell] as Cell));
const start = () => gameReducer(createSetupState(), { type: 'START', settings: humanHuman, gameId: 'game-1' });

describe('gameReducer', () => {
  it('合法手を適用し、非合法手では盤面・手番・手数を変えない', () => {
    const initial = start();
    const illegal = gameReducer(initial, { type: 'HUMAN_MOVE', index: 0 });
    expect(illegal.board).toBe(initial.board);
    expect(illegal.turn).toBe(initial.turn);
    expect(illegal.moveCount).toBe(0);
    const moved = gameReducer(illegal, { type: 'HUMAN_MOVE', index: 19 });
    expect(moved.moveCount).toBe(1);
    expect(moved.turn).toBe(2);
  });

  it('パスでは手数を増やさず、次の着手で終局・勝敗を確定する', () => {
    const state: GameState = Object.freeze({ ...start(), board: board(['.WBBBBBB','BBBBBBBB','BBBBBBBB','BBBBBBBB','BBBBBBBB','BBBBBBBB','BBBBBBBB','BBBBBBW.']), turn: BLACK, moveCount: 60 });
    const passed = gameReducer(state, { type: 'HUMAN_MOVE', index: 0 });
    expect(passed.turn).toBe(BLACK);
    expect(passed.moveCount).toBe(61);
    expect(passed.messageKind).toBe('pass');
    const finished = gameReducer(passed, { type: 'HUMAN_MOVE', index: 63 });
    expect(finished.status).toBe(GAME_STATUSES.FINISHED);
    expect(finished.winner).toBe(BLACK);
    expect(finished.moveCount).toBe(62);
  });

  it('CPUの古い結果を無視し、非合法結果と例外では安全停止する', () => {
    const settings = normalizeSettings({ mode: GAME_MODES.HUMAN_CPU, humanColor: BLACK, cpuLevelWhite: CPU_LEVELS.NORMAL, speed: GAME_SPEEDS.NORMAL });
    const cpuTurn = gameReducer(gameReducer(createSetupState(), { type: 'START', settings, gameId: 'g' }), { type: 'HUMAN_MOVE', index: 19 });
    const request: PendingCpuRequest = { requestId: 'r', gameId: 'g', generationId: cpuTurn.generationId, board: cpuTurn.board, color: cpuTurn.turn, config: { engine: 'legacy', level: CPU_LEVELS.NORMAL }, stayPaused: false };
    const pending = gameReducer(cpuTurn, { type: 'CPU_REQUESTED', request });
    const restarted = gameReducer(pending, { type: 'RESTART', gameId: 'g2' });
    expect(gameReducer(restarted, { type: 'CPU_RESOLVED', request, move: { index: 18, row: 2, col: 2 } })).toBe(restarted);
    const illegal = gameReducer(pending, { type: 'CPU_RESOLVED', request, move: { index: 0, row: 0, col: 0 } });
    expect(illegal.status).toBe(GAME_STATUSES.ERROR);
    expect(illegal.moveCount).toBe(1);
    expect(gameReducer(pending, { type: 'CPU_FAILED', request, error: 'boom' }).status).toBe(GAME_STATUSES.ERROR);
  });

  it('CPU対CPUの停止・再開・一手要求を排他的に遷移する', () => {
    const settings = normalizeSettings({ mode: GAME_MODES.CPU_CPU, cpuLevelBlack: CPU_LEVELS.EASY, cpuLevelWhite: CPU_LEVELS.NORMAL, speed: GAME_SPEEDS.FAST });
    const playing = gameReducer(createSetupState(), { type: 'START', settings, gameId: 'g' });
    const paused = gameReducer(playing, { type: 'PAUSE' });
    expect(paused.status).toBe(GAME_STATUSES.PAUSED);
    expect(gameReducer(paused, { type: 'STEP' }).stepRequested).toBe(true);
    expect(gameReducer(paused, { type: 'RESUME' }).status).toBe(GAME_STATUSES.PLAYING);
  });
});
