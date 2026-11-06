import { EMPTY, type Board } from '@reversi/shared';

export function getFlippedIndices(
  previousBoard: Board | null,
  currentBoard: Board,
  lastMove: number | null,
): ReadonlyArray<number> {
  if (previousBoard === null || lastMove === null) return Object.freeze([]);

  return Object.freeze(currentBoard.flatMap((cell, index) => (
    index !== lastMove
    && previousBoard[index] !== EMPTY
    && cell !== EMPTY
    && previousBoard[index] !== cell
      ? [index]
      : []
  )));
}
