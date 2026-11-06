import { cleanup, render, screen } from '@testing-library/react';
import { BLACK, EMPTY, WHITE, countStones, type Board, type Winner } from '@reversi/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { GameResultSummary } from './GameResultSummary.tsx';

afterEach(cleanup);

function boardWith(black: number, white: number): Board {
  return Object.freeze([
    ...Array.from({ length: black }, () => BLACK),
    ...Array.from({ length: white }, () => WHITE),
    ...Array.from({ length: 64 - black - white }, () => EMPTY),
  ]);
}

describe('終局結果の読み取り専用盤面', () => {
  it.each([
    { name: '黒勝ち', winner: BLACK, black: 35, white: 27, empty: 2, title: '黒の勝ち' },
    { name: '白勝ち', winner: WHITE, black: 20, white: 42, empty: 2, title: '白の勝ち' },
    { name: '引き分け', winner: 'draw', black: 32, white: 32, empty: 0, title: '引き分け' },
  ] as const)('$nameで64マスと石数を終局盤面のまま表示する', ({ winner, black, white, empty, title }) => {
    const board = boardWith(black, white);
    const counts = countStones(board);
    const { container } = render(<GameResultSummary board={board} counts={counts} winner={winner as Winner} />);

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(`黒 ${black} — ${white} 白`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '最終盤面' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: `最終盤面 8×8の終局盤面です。空きマスは${empty}マスです。` })).toBeInTheDocument();
    expect(container.querySelectorAll('.final-board-cell')).toHaveLength(64);
    expect(container.querySelectorAll('.final-board-cell[data-cell="black"]')).toHaveLength(black);
    expect(container.querySelectorAll('.final-board-cell[data-cell="white"]')).toHaveLength(white);
    expect(container.querySelectorAll('.final-board-cell[data-cell="empty"]')).toHaveLength(empty);
    expect(container.querySelectorAll('.final-board button, .final-board [tabindex]')).toHaveLength(0);
  });
});
