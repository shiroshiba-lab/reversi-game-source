import { useEffect, useRef, useState } from 'react';
import { GAME_STATUSES } from '@reversi/shared';
import type { CpuEngine } from './game/cpu/CpuEngine.ts';
import { useGameController } from './game/useGameController.ts';
import { SetupScreen } from './components/SetupScreen.tsx';
import { GameScreen } from './components/GameScreen.tsx';

type GuideDialogProps = Readonly<{ open: boolean; onClose(): void }>;

function GuideDialog({ open, onClose }: GuideDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} id="guide-dialog" className="modal" aria-labelledby="guide-title" onClose={onClose}>
      <div className="modal-content">
        <button className="modal-close" type="button" aria-label="遊び方を閉じる" onClick={onClose}>×</button>
        <p className="eyebrow">HOW TO PLAY</p><h2 id="guide-title">遊び方</h2>
        <ol className="guide-list">
          <li><span>01</span><div><strong>相手の石をはさむ</strong><p>自分の石で相手の石を縦・横・斜めにはさめる場所へ置きます。</p></div></li>
          <li><span>02</span><div><strong>はさんだ石を返す</strong><p>はさんだ方向にある相手の石は、すべて自分の色に変わります。</p></div></li>
          <li><span>03</span><div><strong>石の多い方が勝ち</strong><p>両者とも置けなくなるか盤が埋まると終了。石が多い方の勝ちです。</p></div></li>
        </ol>
        <div className="guide-note"><strong>覚えておこう</strong><p>置ける場所がないときは自動でパスします。CPU対CPUでは一時停止や一手ずつの観戦もできます。</p></div>
        <button className="button button-primary button-full" type="button" onClick={onClose}>わかりました</button>
      </div>
    </dialog>
  );
}

export type AppProps = Readonly<{ cpuEngine?: CpuEngine | null }>;

export function App({ cpuEngine = null }: AppProps) {
  const controller = useGameController(cpuEngine);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideTrigger = useRef<HTMLButtonElement>(null);
  const closeGuide = () => {
    setGuideOpen(false);
    requestAnimationFrame(() => guideTrigger.current?.focus());
  };

  return (
    <>
      <a className="skip-link" href="#main-content">メインコンテンツへ移動</a>
      <div className="site-shell">
        <header className="site-header">
          <a className="brand" href="./"><span className="brand-mark" aria-hidden="true"><i /><i /></span><span><strong>リバーシ盤</strong><small>ひと息つける、盤上の時間。</small></span></a>
          <button ref={guideTrigger} id="open-guide" className="button button-quiet" type="button" aria-haspopup="dialog" onClick={() => setGuideOpen(true)}><span aria-hidden="true">?</span> 遊び方</button>
        </header>
        <main id="main-content" tabIndex={-1}>
          {controller.snapshot.status === GAME_STATUSES.SETUP
            ? <SetupScreen settings={controller.snapshot.settings} cpuAvailability={controller.cpuAvailability} onStart={controller.start} />
            : <GameScreen controller={controller} />}
        </main>
        <footer><span>REVERSI BOARD</span><span>ブラウザだけで、安全に遊べます</span></footer>
      </div>
      <GuideDialog open={guideOpen} onClose={closeGuide} />
    </>
  );
}
