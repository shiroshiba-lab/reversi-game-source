import { describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/v1.1.0-regression.json';
import {
  BLACK,
  IllegalMoveError,
  InvalidReversiInputError,
  applyMove,
  countStones,
  createInitialBoard,
  determineWinner,
  getFlipsForMove,
  getLegalMoves,
  resolveTurnAndGameEnd,
  type Board,
  type Cell,
  type Color,
} from '@reversi/shared';

const CELL = Object.freeze({ '.': 0, B: 1, W: 2 } as const);

function parseBoard(rows: ReadonlyArray<string>): Board {
  expect(rows).toHaveLength(8);
  return rows.flatMap((row) => {
    expect(row).toHaveLength(8);
    return [...row].map((symbol) => {
      if (!(symbol in CELL)) throw new Error(`unknown fixture cell: ${symbol}`);
      return CELL[symbol as keyof typeof CELL];
    });
  });
}

function scenario(id: string) {
  const entry = fixture.ruleScenarios.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`missing scenario: ${id}`);
  return entry;
}

describe('Task 05のv1.1.0固定ルールFixture', () => {
  it('initialの盤面・黒先手・合法手・石数が一致する', () => {
    const entry = scenario('initial');
    const board = parseBoard(entry.board);
    expect(createInitialBoard()).toEqual(board);
    expect(entry.turn).toBe(BLACK);
    expect(getLegalMoves(board, entry.turn as Color).map(({ index }) => index)).toEqual(entry.legalMoves);
    expect(countStones(board)).toEqual(entry.counts);
  });

  for (const id of ['eight-directions', 'two-directions', 'corner-and-edge']) {
    it(`${id}の合法手・反転位置・着手後盤面が一致する`, () => {
      const entry = scenario(id);
      const board = parseBoard(entry.board);
      const move = entry.move;
      const turn = entry.turn as Color;
      if (entry.legalMoves !== undefined) {
        expect(getLegalMoves(board, turn).map(({ index }) => index)).toEqual(entry.legalMoves);
      }
      expect(getFlipsForMove(board, turn, Math.floor(move / 8), move % 8)).toEqual(entry.flips);
      expect(applyMove(board, turn, { index: move })).toEqual(parseBoard(entry.afterBoard));
    });
  }

  for (const id of ['pass-after-move', 'ended-with-empty', 'full-white-win', 'full-draw']) {
    it(`${id}の石数・パス・終局・勝敗が一致する`, () => {
      const entry = scenario(id);
      const board = entry.afterBoard === undefined
        ? parseBoard(entry.board)
        : applyMove(parseBoard(entry.board), entry.turn as Color, { index: entry.move });
      expect(countStones(board)).toEqual(entry.counts);
      const previousTurn = (entry.turn ?? entry.previousTurn) as Color;
      expect(resolveTurnAndGameEnd(board, previousTurn)).toEqual(entry.resolution);
      if (entry.resolution.finished) expect(determineWinner(board)).toBe(entry.resolution.winner);
    });
  }
});

describe('境界、不正入力、非破壊性', () => {
  it.each([
    Array<Cell>(63).fill(0),
    Array<Cell>(65).fill(0),
    [...Array<Cell>(63).fill(0), 3],
  ])('不正な盤面を拒否する', (board) => {
    expect(() => getLegalMoves(board as Board, BLACK)).toThrow(InvalidReversiInputError);
  });

  it.each([0, 3, null, undefined, Number.NaN])('不正な手番を拒否する', (color) => {
    expect(() => getLegalMoves(createInitialBoard(), color as Color)).toThrow(InvalidReversiInputError);
  });

  it.each([
    { index: -1 },
    { index: 64 },
    { index: 19.5 },
    { index: Number.NaN },
    { row: -1, col: 0 },
    { row: 8, col: 0 },
    { row: 2.5, col: 3 },
    { row: Number.NaN, col: 3 },
    { index: 19, row: 3, col: 3 },
  ])('不正または矛盾する着手位置を拒否する: %o', (move) => {
    expect(() => applyMove(createInitialBoard(), BLACK, move)).toThrow(InvalidReversiInputError);
  });

  it('既存石と反転できない空きマスをIllegalMoveErrorで拒否し、入力盤面を変更しない', () => {
    const board = [...createInitialBoard()];
    const before = [...board];
    expect(() => applyMove(board, BLACK, { index: 27 })).toThrow(IllegalMoveError);
    expect(() => applyMove(board, BLACK, { index: 0 })).toThrow(IllegalMoveError);
    expect(board).toEqual(before);
  });

  it('着手は新しい盤面を返し、入力盤面と返却値を外部変更から保護する', () => {
    const board = createInitialBoard();
    const next = applyMove(board, BLACK, { index: 19, row: 2, col: 3 });
    expect(next).not.toBe(board);
    expect(board).toEqual(createInitialBoard());
    expect(Object.isFrozen(board)).toBe(true);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(getLegalMoves(board, BLACK))).toBe(true);
  });

  it('辺をまたいだ反転を行わない', () => {
    const board = Array<Cell>(64).fill(0);
    board[7] = BLACK;
    board[8] = 2;
    expect(getFlipsForMove(board, BLACK, 0, 6)).toEqual([]);
  });
});
