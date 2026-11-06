import { BLACK, WHITE, countStones, type Board, type StoneCounts, type Winner } from '@reversi/shared';
import { useId } from 'react';

const colorName = (color: typeof BLACK | typeof WHITE) => color === BLACK ? '黒' : '白';

type FinalBoardProps = Readonly<{ board: Board }>;

export function FinalBoard({ board }: FinalBoardProps) {
  const headingId = useId();
  const descriptionId = useId();
  const { empty } = countStones(board);

  return <section className="final-board-section" aria-labelledby={headingId}>
    <h3 id={headingId}>最終盤面</h3>
    <p id={descriptionId} className="visually-hidden">8×8の終局盤面です。空きマスは{empty}マスです。</p>
    <div id="final-board" className="final-board" role="img" aria-labelledby={`${headingId} ${descriptionId}`}>
      {board.map((value, index) => <div
        key={index}
        className="final-board-cell"
        data-index={index}
        data-cell={value === BLACK ? 'black' : value === WHITE ? 'white' : 'empty'}
        aria-hidden="true"
      >
        {(value === BLACK || value === WHITE) && <i className={`stone ${value === BLACK ? 'black' : 'white'}`} />}
      </div>)}
    </div>
  </section>;
}

type GameResultSummaryProps = Readonly<{
  board: Board;
  counts: StoneCounts;
  winner: Winner;
}>;

export function GameResultSummary({ board, counts, winner }: GameResultSummaryProps) {
  const title = winner === 'draw' ? '引き分け' : `${colorName(winner)}の勝ち`;

  return <>
    <div id="result-emblem" className="result-emblem" aria-hidden="true">
      {winner === 'draw'
        ? <><i className="score-stone black" /><i className="score-stone white" /></>
        : <i className={`score-stone ${winner === BLACK ? 'black' : 'white'}`} />}
    </div>
    <p className="eyebrow">GAME SET</p>
    <h2 id="result-title">{title}</h2>
    <p id="result-score" className="result-score">黒 {counts.black} — {counts.white} 白</p>
    <FinalBoard board={board} />
  </>;
}
