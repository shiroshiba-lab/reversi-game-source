import { useEffect, useRef, useState } from 'react';
import { BLACK, GAME_MODES, GAME_SPEEDS, GAME_STATUSES, WHITE, type Color } from '@reversi/shared';
import type { GameController } from '../game/useGameController.ts';
import { GameBoard } from './GameBoard.tsx';
import { GameResultSummary } from './GameResultSummary.tsx';
import { cpuConfigForColor, cpuConfigLabel } from '../game/cpu/cpuConfig.ts';

const modeLabels = { [GAME_MODES.HUMAN_HUMAN]: '人 対 人', [GAME_MODES.HUMAN_CPU]: '人 対 CPU', [GAME_MODES.CPU_CPU]: 'CPU 対 CPU' } as const;
const colorName = (color: Color) => color === BLACK ? '黒' : '白';

function actorName(controller: GameController, color: Color) {
  const { settings } = controller.snapshot;
  if (settings.mode === GAME_MODES.HUMAN_HUMAN) return '人';
  if (settings.mode === GAME_MODES.HUMAN_CPU && settings.humanColor === color) return 'あなた';
  return cpuConfigLabel(cpuConfigForColor(settings, color));
}

type DialogProps = Readonly<{ open: boolean; title: string; description: string; onCancel(): void; onConfirm(): void }>;
function ConfirmDialog({ open, title, description, onCancel, onConfirm }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) { dialog.showModal(); requestAnimationFrame(() => cancelRef.current?.focus()); }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={dialogRef} id="confirm-dialog" className="modal modal-small" aria-labelledby="confirm-title" aria-describedby="confirm-description" onCancel={(event) => { event.preventDefault(); onCancel(); }}><div className="modal-content"><p className="eyebrow">CONFIRM</p><h2 id="confirm-title">{title}</h2><p id="confirm-description">{description}</p><div className="modal-actions"><button ref={cancelRef} id="confirm-cancel" className="button button-quiet" type="button" onClick={onCancel}>キャンセル</button><button id="confirm-ok" className="button button-danger" type="button" onClick={onConfirm}>続行する</button></div></div></dialog>;
}

function ResultDialog({ controller }: Readonly<{ controller: GameController }>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  const { snapshot } = controller;
  const open = snapshot.status === GAME_STATUSES.FINISHED;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) { dialog.showModal(); requestAnimationFrame(() => restartRef.current?.focus()); }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={dialogRef} id="result-dialog" className="modal result-modal" aria-labelledby="result-title" aria-describedby="result-score"><div className="modal-content">{snapshot.winner && <GameResultSummary board={snapshot.board} counts={snapshot.counts} winner={snapshot.winner} />}<div className="modal-actions stacked-mobile"><button ref={restartRef} id="result-restart" className="button button-primary" type="button" onClick={controller.restart}>もう一度</button><button id="result-setup" className="button button-secondary" type="button" onClick={controller.goToSetup}>設定に戻る</button></div></div></dialog>;
}

export function GameScreen({ controller }: Readonly<{ controller: GameController }>) {
  const { snapshot } = controller;
  const [confirmKind, setConfirmKind] = useState<'restart' | 'setup' | null>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  const setupRef = useRef<HTMLButtonElement>(null);
  const closeConfirm = () => {
    const kind = confirmKind;
    setConfirmKind(null);
    requestAnimationFrame(() => (kind === 'restart' ? restartRef.current : setupRef.current)?.focus());
  };
  const confirm = () => { const kind = confirmKind; setConfirmKind(null); if (kind === 'restart') controller.restart(); else if (kind === 'setup') controller.goToSetup(); };
  const requestDiscard = (kind: 'restart' | 'setup') => {
    if (snapshot.status === GAME_STATUSES.FINISHED || snapshot.status === GAME_STATUSES.ERROR) { if (kind === 'restart') controller.restart(); else controller.goToSetup(); return; }
    setConfirmKind(kind);
  };
  const turnText = snapshot.status === GAME_STATUSES.PAUSED ? '一時停止中' : snapshot.status === GAME_STATUSES.FINISHED ? '対局終了' : `${colorName(snapshot.turn)}の手番`;
  const sideActor = snapshot.status === GAME_STATUSES.ERROR ? '安全のため進行を停止しました' : snapshot.status === GAME_STATUSES.PAUSED ? '観戦を一時停止しています' : snapshot.status === GAME_STATUSES.FINISHED ? '最終結果をご確認ください' : `${actorName(controller, snapshot.turn)}が操作します`;

  return <section id="game-view" className="game-layout" aria-labelledby="game-title"><div className="game-main"><div className="game-heading"><div><p id="game-mode-label" className="eyebrow">{modeLabels[snapshot.settings.mode]}</p><h1 id="game-title">{snapshot.status === GAME_STATUSES.FINISHED ? '対局終了' : '対局中'}</h1></div><div id="turn-pill" className="turn-pill"><i className={`mini-stone ${snapshot.turn === BLACK ? 'black' : 'white'}`} /><span>{turnText}</span></div></div><div className="score-strip" aria-label="現在の石数"><div id="black-score-card" className={`score-card${snapshot.turn === BLACK && snapshot.status === GAME_STATUSES.PLAYING ? ' is-active' : ''}`}><i className="score-stone black" aria-hidden="true" /><span><small id="black-owner">黒 · {actorName(controller, BLACK)}</small><strong id="black-score">{snapshot.counts.black}</strong></span></div><div className="move-counter"><span>着手数</span><strong id="move-count">{snapshot.moveCount}</strong></div><div id="white-score-card" className={`score-card${snapshot.turn === WHITE && snapshot.status === GAME_STATUSES.PLAYING ? ' is-active' : ''}`}><i className="score-stone white" aria-hidden="true" /><span><small id="white-owner">白 · {actorName(controller, WHITE)}</small><strong id="white-score">{snapshot.counts.white}</strong></span></div></div><GameBoard snapshot={snapshot} onMove={controller.move} /><div id="status-message" className="status-message" data-kind={snapshot.messageKind} role="status" aria-live="polite"><span className="status-icon" aria-hidden="true">●</span><span id="status-text">{snapshot.message}</span></div></div>
    <aside className="game-sidebar" aria-label="対局情報と操作"><section className="info-card"><p className="card-label">いまの状況</p><h2 id="side-turn">{snapshot.status === GAME_STATUSES.FINISHED ? '対局終了' : `${colorName(snapshot.turn)}の手番`}</h2><p id="side-actor">{sideActor}</p>{snapshot.cpuThinking && <div id="thinking-indicator" className="thinking"><span /><span /><span /> {snapshot.cpuPhase === 'initializing' ? '高性能AI読み込み中' : 'CPU思考中'}</div>}</section>{snapshot.settings.mode === GAME_MODES.CPU_CPU && <section id="spectator-controls" className="control-card"><p className="card-label">観戦コントロール</p><div className="control-row"><button id="pause-resume" className="button button-secondary" type="button" disabled={snapshot.status !== GAME_STATUSES.PLAYING && snapshot.status !== GAME_STATUSES.PAUSED} onClick={snapshot.status === GAME_STATUSES.PAUSED ? controller.resume : controller.pause}>{snapshot.status === GAME_STATUSES.PAUSED ? '再開' : '一時停止'}</button><button id="step-once" className="button button-secondary" type="button" disabled={snapshot.status !== GAME_STATUSES.PAUSED || snapshot.cpuThinking} onClick={controller.step}>一手進める</button></div><label htmlFor="game-speed">観戦速度</label><select id="game-speed" value={snapshot.settings.speed} onChange={(event) => controller.updateSpeed(Number(event.target.value))}><option value={GAME_SPEEDS.SLOW}>ゆっくり（約2秒）</option><option value={GAME_SPEEDS.NORMAL}>標準（約1秒）</option><option value={GAME_SPEEDS.FAST}>速い（約0.5秒）</option></select></section>}<section className="control-card"><p className="card-label">対局メニュー</p><button ref={restartRef} id="restart-game" className="button button-secondary button-full" type="button" onClick={() => requestDiscard('restart')}>{snapshot.status === GAME_STATUSES.ERROR ? '同じ設定で再試行' : 'もう一度'}</button><button ref={setupRef} id="back-to-setup" className="button button-quiet button-full" type="button" onClick={() => requestDiscard('setup')}>設定に戻る</button></section><p className="keyboard-tip"><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> で移動、<kbd>Enter</kbd> で着手</p></aside>
    <ConfirmDialog open={confirmKind !== null} title={confirmKind === 'restart' ? '対局をやり直しますか？' : '設定に戻りますか？'} description="現在の対局内容は保存されず、失われます。" onCancel={closeConfirm} onConfirm={confirm} /><ResultDialog controller={controller} /></section>;
}
