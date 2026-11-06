import { BLACK, applyMove, createInitialBoard, getLegalMoves, type Board, type Cell } from '@reversi/shared';
import { describe, expect, it } from 'vitest';
import fixture from '../../../test/fixtures/v1.1.0-regression.json';
import { getFlippedIndices } from './boardTransition.ts';

const parseBoard = (rows: ReadonlyArray<string>): Board => Object.freeze(rows.flatMap((row) => (
  [...row].map((cell) => ({ '.': 0, B: 1, W: 2 })[cell] as Cell)
)));

describe('反転石の画面遷移', () => {
  it('新しく置いた石を除き、色が変わった石だけを返す', () => {
    const before = createInitialBoard();
    const move = getLegalMoves(before, BLACK).find(({ index }) => index === 19);
    if (move === undefined) throw new Error('D3の合法手がありません。');
    const after = applyMove(before, BLACK, move);
    expect(getFlippedIndices(before, after, move.index)).toEqual([27]);
  });

  it('複数方向で反転した石をすべて返す', () => {
    const scenario = fixture.ruleScenarios.find(({ id }) => id === 'eight-directions');
    if (scenario === undefined || scenario.afterBoard === undefined || scenario.move === undefined) throw new Error('eight-directions fixtureがありません。');
    expect(getFlippedIndices(parseBoard(scenario.board), parseBoard(scenario.afterBoard), scenario.move)).toEqual(scenario.flips);
  });

  it('初期描画・同一盤面・再対局ではアニメーション対象を返さない', () => {
    const board = createInitialBoard();
    expect(getFlippedIndices(null, board, null)).toEqual([]);
    expect(getFlippedIndices(board, board, 19)).toEqual([]);
    expect(getFlippedIndices(board, board, null)).toEqual([]);
  });
});
