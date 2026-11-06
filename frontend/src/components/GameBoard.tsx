import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { BLACK, EMPTY, GAME_STATUSES, WHITE, coordinateOf } from '@reversi/shared';
import type { GameSnapshot } from '../game/types.ts';

type Props = Readonly<{ snapshot: GameSnapshot; onMove(index: number): void }>;
export function GameBoard({ snapshot, onMove }: Props) {
  const legal = useMemo(() => new Set(snapshot.legalMoves.map((move) => move.index)), [snapshot.legalMoves]);
  const flipped = useMemo(() => new Set(snapshot.flippedIndices), [snapshot.flippedIndices]);
  const canMove = snapshot.status === GAME_STATUSES.PLAYING && snapshot.isHumanTurn && !snapshot.cpuThinking;
  const firstLegal = snapshot.legalMoves[0]?.index ?? 0;
  const [focusedIndex, setFocusedIndex] = useState(firstLegal);
  const cells = useRef<Array<HTMLButtonElement | null>>([]);
  const effectiveFocusedIndex = canMove && !legal.has(focusedIndex) ? firstLegal : focusedIndex;
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') { if (canMove && legal.has(index)) onMove(index); return; }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const row = Math.floor(index / 8); const col = index % 8;
    const nextRow = event.key === 'ArrowUp' ? (row + 7) % 8 : event.key === 'ArrowDown' ? (row + 1) % 8 : row;
    const nextCol = event.key === 'ArrowLeft' ? (col + 7) % 8 : event.key === 'ArrowRight' ? (col + 1) % 8 : col;
    const next = nextRow * 8 + nextCol; setFocusedIndex(next); cells.current[next]?.focus();
  };
  return <div className="board-frame"><div aria-hidden="true" /><div className="column-labels" aria-hidden="true">{'ABCDEFGH'.split('').map((label) => <span key={label}>{label}</span>)}</div><div className="row-labels" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <span key={index}>{index + 1}</span>)}</div><div id="board" className="board" role="grid" aria-label="リバーシ盤面">{Array.from({ length: 8 }, (_, row) => <div className="board-row" role="row" key={row}>{Array.from({ length: 8 }, (__, col) => { const index = row * 8 + col; const value = snapshot.board[index] ?? EMPTY; const isLegal = canMove && legal.has(index); const label = value === BLACK || value === WHITE ? `${coordinateOf(index)}、${value === BLACK ? '黒' : '白'}の石${snapshot.lastMove === index ? '、直前の着手' : ''}` : `${coordinateOf(index)}、空き、${isLegal ? '着手可能' : '着手不可'}`; return <button key={index} ref={(element) => { cells.current[index] = element; }} type="button" role="gridcell" className={`cell${isLegal ? ' is-legal' : ''}${snapshot.lastMove === index ? ' is-last' : ''}`} data-index={index} aria-rowindex={row + 1} aria-colindex={col + 1} aria-disabled={!isLegal} aria-label={label} tabIndex={index === effectiveFocusedIndex ? 0 : -1} onFocus={() => setFocusedIndex(index)} onClick={() => { if (isLegal) onMove(index); }} onKeyDown={(event) => keyDown(event, index)}>{(value === BLACK || value === WHITE) && <i key={value} className={`stone ${value === BLACK ? 'black' : 'white'}${flipped.has(index) ? ' is-flipped' : ''}`} aria-hidden="true" />}{isLegal && <span className="legal-marker" aria-hidden="true" />}{snapshot.lastMove === index && <span className="last-marker" aria-hidden="true">直前</span>}</button>; })}</div>)}</div></div>;
}
