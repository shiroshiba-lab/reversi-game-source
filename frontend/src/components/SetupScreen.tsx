import { useState, type FormEvent } from 'react';
import { BLACK, CPU_LEVELS, GAME_MODES, GAME_SPEEDS, WHITE, type Color, type CpuLevel, type GameMode, type GameSpeed } from '@reversi/shared';
import { normalizeSettings } from '../game/settings.ts';
import type { GameSettings } from '../game/types.ts';
import {
  CPU_ENGINES,
  DEFAULT_EGAROUCID_LEVEL,
  EGAROUCID_LEVELS,
  isHighLoadEgaroucidLevel,
  type CpuEngineAvailabilityMap,
  type CpuEngineId,
  type EgaroucidLevel,
} from '../game/cpu/cpuConfig.ts';
import { CORRESPONDING_SOURCE_RELEASE_URL, PRODUCT_VERSION } from '../release.ts';

type Props = Readonly<{
  settings: GameSettings;
  cpuAvailability: CpuEngineAvailabilityMap;
  onStart(settings: GameSettings): void;
}>;

type CpuDraft = Readonly<{
  engine: CpuEngineId;
  legacyLevel: CpuLevel;
  egaroucidLevel: EgaroucidLevel;
}>;

const levelOptions = [
  [CPU_LEVELS.EASY, '初級：合法手からランダムに選ぶ'],
  [CPU_LEVELS.NORMAL, '標準：角や相手の打てる場所を考えて選ぶ'],
  [CPU_LEVELS.ADVANCED, '上級：数手先まで読んで選ぶ'],
  [CPU_LEVELS.EXPERT, '最強：より深く読み、有利な手を探す'],
] as const;

function draftFor(settings: GameSettings, color: Color): CpuDraft {
  const black = color === BLACK;
  return Object.freeze({
    engine: (black ? settings.cpuEngineBlack : settings.cpuEngineWhite) ?? CPU_ENGINES.LEGACY,
    legacyLevel: (black ? settings.cpuLevelBlack : settings.cpuLevelWhite) ?? CPU_LEVELS.NORMAL,
    egaroucidLevel: (black ? settings.egaroucidLevelBlack : settings.egaroucidLevelWhite) ?? DEFAULT_EGAROUCID_LEVEL,
  });
}

type CpuSelectorProps = Readonly<{
  idPrefix: string;
  label: string;
  value: CpuDraft;
  availability: CpuEngineAvailabilityMap;
  onChange(value: CpuDraft): void;
}>;

function CpuSelector({ idPrefix, label, value, availability, onChange }: CpuSelectorProps) {
  const unavailable = !availability[value.engine].available;
  const levelName = idPrefix === 'cpu' ? 'cpuLevel' : `cpuLevel${idPrefix === 'black-cpu' ? 'Black' : 'White'}`;
  const legacyLevelId = idPrefix === 'cpu' ? 'cpu-level' : `${idPrefix}-legacy-level`;
  return <div className="cpu-selector" data-engine={value.engine}>
    <p className="cpu-selector-title">{label}</p>
    <label htmlFor={`${idPrefix}-engine`}>CPUエンジン</label>
    <select id={`${idPrefix}-engine`} name={`${idPrefix}Engine`} value={value.engine} onChange={(event) => onChange({ ...value, engine: event.target.value as CpuEngineId })}>
      <option value={CPU_ENGINES.LEGACY}>オリジナルCPU（4段階）</option>
      <option value={CPU_ENGINES.EGAROUCID} disabled={!availability.egaroucid.available}>高性能AI（Level 0〜15）</option>
    </select>
    {value.engine === CPU_ENGINES.LEGACY ? <>
      <label htmlFor={legacyLevelId}>CPUの強さ</label>
      <select id={legacyLevelId} name={levelName} value={value.legacyLevel} onChange={(event) => onChange({ ...value, legacyLevel: event.target.value as CpuLevel })}>
        {levelOptions.map(([level, optionLabel]) => <option value={level} key={level}>{optionLabel}</option>)}
      </select>
    </> : <>
      <label htmlFor={`${idPrefix}-egaroucid-level`}>高性能AIのLevel</label>
      <select id={`${idPrefix}-egaroucid-level`} name={`${idPrefix}EgaroucidLevel`} value={value.egaroucidLevel} onChange={(event) => onChange({ ...value, egaroucidLevel: Number(event.target.value) as EgaroucidLevel })}>
        {EGAROUCID_LEVELS.map((level) => <option value={level} key={level}>Level {level}</option>)}
      </select>
      {isHighLoadEgaroucidLevel(value.egaroucidLevel) && <p className="high-load-note" role="status">Level 12〜15は局面や端末により応答に時間がかかり、15秒でも完了しない場合があります。探索は1手15秒で安全停止します。</p>}
    </>}
    {unavailable && <p className="cpu-unavailable" role="status">{availability[value.engine].reason}</p>}
  </div>;
}

export function SetupScreen({ settings, cpuAvailability, onStart }: Props) {
  const [mode, setMode] = useState<GameMode>(settings.mode);
  const [humanColor, setHumanColor] = useState<Color>(settings.humanColor ?? BLACK);
  const initialHumanCpuColor = settings.humanColor === WHITE ? BLACK : WHITE;
  const [humanCpu, setHumanCpu] = useState<CpuDraft>(draftFor(settings, initialHumanCpuColor));
  const [blackCpu, setBlackCpu] = useState<CpuDraft>(draftFor(settings, BLACK));
  const [whiteCpu, setWhiteCpu] = useState<CpuDraft>(draftFor(settings, WHITE));
  const [speed, setSpeed] = useState<GameSpeed>(settings.speed);
  const selectedCpus = mode === GAME_MODES.CPU_CPU ? [blackCpu, whiteCpu] : mode === GAME_MODES.HUMAN_CPU ? [humanCpu] : [];
  const cpuModeUnavailable = selectedCpus.some((cpu) => !cpuAvailability[cpu.engine].available);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (cpuModeUnavailable) return;
    const black = mode === GAME_MODES.CPU_CPU ? blackCpu : humanCpu;
    const white = mode === GAME_MODES.CPU_CPU ? whiteCpu : humanCpu;
    onStart(normalizeSettings({
      mode,
      humanColor,
      cpuEngineBlack: black.engine,
      cpuEngineWhite: white.engine,
      cpuLevelBlack: black.legacyLevel,
      cpuLevelWhite: white.legacyLevel,
      egaroucidLevelBlack: black.egaroucidLevel,
      egaroucidLevelWhite: white.egaroucidLevel,
      egaroucidUseBookBlack: true,
      egaroucidUseBookWhite: true,
      speed,
    }));
  };

  return (
    <section id="setup-view" className="setup-layout" aria-labelledby="setup-title">
      <div className="intro-panel"><p className="eyebrow">REVERSI · 8 × 8</p><h1 id="setup-title">考えるほど、<br /><em>盤面は変わる。</em></h1><p className="lead">置ける場所がひと目で分かるから、はじめてでも安心。友達と、CPUと、あるいはCPU同士の一局を楽しめます。</p><div className="intro-board" aria-hidden="true"><span className="demo-stone demo-stone-black" /><span className="demo-stone demo-stone-white" /><span className="demo-ring" /></div></div>
      <form id="setup-form" className="setup-card" onSubmit={submit}>
        <div className="section-heading"><span>新しい対局</span><small>設定はこの端末に保存されます</small></div>
        <fieldset><legend>対戦モード</legend><div className="mode-grid">
          {([[GAME_MODES.HUMAN_HUMAN, '人人', '人 対 人', '1台を交互に操作'], [GAME_MODES.HUMAN_CPU, '人◈', '人 対 CPU', 'CPUに挑戦'], [GAME_MODES.CPU_CPU, '◈◈', 'CPU 対 CPU', '対局を観戦']] as const).map(([value, icon, label, detail]) => <label className="choice-card" key={value}><input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} /><span className="choice-icon" aria-hidden="true">{icon}</span><strong>{label}</strong><small>{detail}</small></label>)}
        </div></fieldset>
        {mode === GAME_MODES.HUMAN_CPU && <div id="human-cpu-settings" className="settings-group"><fieldset><legend>あなたの石</legend><div className="segmented-control"><label><input type="radio" name="humanColor" value={BLACK} checked={humanColor === BLACK} onChange={() => setHumanColor(BLACK)} /><span><i className="mini-stone black" />黒（先手）</span></label><label><input type="radio" name="humanColor" value={WHITE} checked={humanColor === WHITE} onChange={() => setHumanColor(WHITE)} /><span><i className="mini-stone white" />白（後手）</span></label></div></fieldset><CpuSelector idPrefix="cpu" label="対戦するCPU" value={humanCpu} availability={cpuAvailability} onChange={setHumanCpu} /></div>}
        {mode === GAME_MODES.CPU_CPU && <div id="cpu-cpu-settings" className="settings-group"><div className="two-fields engine-fields"><CpuSelector idPrefix="black-cpu" label="黒CPU" value={blackCpu} availability={cpuAvailability} onChange={setBlackCpu} /><CpuSelector idPrefix="white-cpu" label="白CPU" value={whiteCpu} availability={cpuAvailability} onChange={setWhiteCpu} /></div><label className="field-label" htmlFor="watch-speed">観戦速度</label><select id="watch-speed" name="speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value) as GameSpeed)}><option value={GAME_SPEEDS.SLOW}>ゆっくり（約2秒）</option><option value={GAME_SPEEDS.NORMAL}>標準（約1秒）</option><option value={GAME_SPEEDS.FAST}>速い（約0.5秒）</option></select></div>}
        <button className="button button-primary button-large start-button" type="submit" disabled={cpuModeUnavailable}>対局をはじめる <span aria-hidden="true">→</span></button>
        <section className="about-license" aria-labelledby="about-license-title">
          <h2 id="about-license-title">このアプリについて・ライセンス</h2>
          <p>本アプリの「高性能AI」（Level 0〜15）には、<a href="https://www.egaroucid.nyanyan.dev/ja/web/" target="_blank" rel="noreferrer">Egaroucid for Web</a>を、WASMのメモリ設定調整や専用Web Workerへの組み込みなどの改変を加えて利用しています。</p>
          <details>
            <summary>ライセンス文書と改変の詳細</summary>
            <p>Egaroucid for WebはTakuto Yamana氏とコントリビューターによる外部ソフトウェアで、GPL-3.0-or-laterの条件で利用しています。本アプリの動作を作者が保証するものではありません。</p>
            <p>主な変更は、再現可能な乱数seedと探索診断、Book切替引数、通常探索時の診断出力抑制、Emscriptenでの初期64 MiB／最大128 MiBのWASM build、専用Workerでの初期化・探索・中止・timeout・応答検証です。</p>
            <ul>
              <li><a href={CORRESPONDING_SOURCE_RELEASE_URL} target="_blank" rel="noreferrer">対応ソース（{PRODUCT_VERSION}）</a></li>
              <li><a href="egaroucid/NOTICE.txt" target="_blank" rel="noreferrer">NOTICE（著作権・改変内容・無保証）</a></li>
              <li><a href="egaroucid/GPL-3.0.txt" target="_blank" rel="noreferrer">GNU GPL v3ライセンス本文</a></li>
              <li><a href="egaroucid/Emscripten-LICENSE.txt" target="_blank" rel="noreferrer">Emscripten第三者ライセンス</a></li>
              <li><a href="egaroucid/emsdk-LICENSE.txt" target="_blank" rel="noreferrer">emsdk第三者ライセンス</a></li>
            </ul>
            <p>本アプリ {PRODUCT_VERSION} の対応ソース、ビルド手順、SHA-256 manifestは、上記のGitHub Releaseから無償で取得できます。この公開リポジトリはEgaroucid公式リポジトリではありません。</p>
          </details>
        </section>
        <p className="storage-note">設定だけをブラウザに保存します。対局内容や個人情報を外部へ送信しません。</p>
      </form>
    </section>
  );
}
