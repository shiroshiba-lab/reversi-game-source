import { CPU_LEVELS, getLegalMoves, type Board, type Color, type CpuLevel } from '@reversi/shared';
import { describe, expect, it } from 'vitest';
import fixture from '../../../../test/fixtures/v1.1.0-regression.json';
import { analyzeLegacyCpuMove, evaluateLegacyBoard } from './legacySearch.ts';

const CELL = Object.freeze({ '.': 0, B: 1, W: 2 } as const);
const parseBoard = (rows: ReadonlyArray<string>): Board => Object.freeze(rows.flatMap((row) => [...row].map((symbol) => CELL[symbol as keyof typeof CELL])));
const levels = Object.values(CPU_LEVELS);

describe('v1.1.0 CPUのTypeScript移植', () => {
  for (const position of fixture.cpuPositions) {
    for (const level of levels) {
      it(`${position.id}/${level}は固定Fixtureと同じ手を返す`, () => {
        const board = parseBoard(position.board);
        const before = [...board];
        const result = analyzeLegacyCpuMove(board, position.turn as Color, level, {
          random: () => 0,
          maxDepth: level === CPU_LEVELS.EXPERT ? 4 : 3,
          timeLimitMs: 10_000,
          endgameThreshold: 8,
        });
        expect(result.move?.index ?? null).toBe(position.expectedFixedMoves[level]);
        expect(result.move === null || getLegalMoves(board, position.turn as Color).some((move) => move.index === result.move?.index)).toBe(true);
        expect(board).toEqual(before);
      });
    }
  }

  it('固定乱数を再利用でき、入力盤面を変更しない', () => {
    const board = parseBoard(fixture.cpuPositions[0]?.board ?? []);
    const first = analyzeLegacyCpuMove(board, 1, CPU_LEVELS.EASY, { random: () => 0.999 });
    const second = analyzeLegacyCpuMove(board, 1, CPU_LEVELS.EASY, { random: () => 0.999 });
    expect(second.move).toEqual(first.move);
    expect(Object.isFrozen(board)).toBe(true);
  });

  it('時間切れと取消でも合法な直前結果を返す', () => {
    const board = parseBoard(fixture.cpuPositions[0]?.board ?? []);
    let clock = 0;
    const timedOut = analyzeLegacyCpuMove(board, 1, CPU_LEVELS.EXPERT, { maxDepth: 8, timeLimitMs: 2, now: () => ++clock });
    const cancelled = analyzeLegacyCpuMove(board, 1, CPU_LEVELS.ADVANCED, { shouldCancel: () => true });
    expect(timedOut.diagnostics.timedOut).toBe(true);
    expect(cancelled.diagnostics.cancelled).toBe(true);
    expect(getLegalMoves(board, 1).map(({ index }) => index)).toContain(timedOut.move?.index);
    expect(getLegalMoves(board, 1).map(({ index }) => index)).toContain(cancelled.move?.index);
  });

  it('評価関数は色を反転すると符号も反転する', () => {
    const board = parseBoard(fixture.cpuPositions[3]?.board ?? []);
    expect(evaluateLegacyBoard(board, 1)).toBe(-evaluateLegacyBoard(board, 2));
  });

  it('不正な盤面・色・難易度を拒否する', () => {
    expect(() => analyzeLegacyCpuMove([0] as Board, 1, CPU_LEVELS.NORMAL)).toThrow();
    expect(() => analyzeLegacyCpuMove(parseBoard(fixture.cpuPositions[0]?.board ?? []), 3 as Color, CPU_LEVELS.NORMAL)).toThrow();
    expect(() => analyzeLegacyCpuMove(parseBoard(fixture.cpuPositions[0]?.board ?? []), 1, 'unknown' as CpuLevel)).toThrow('未対応');
  });
});
