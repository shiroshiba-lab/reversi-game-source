import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { LegacyCpuWorkerAdapter } from './game/cpu/LegacyCpuWorkerAdapter.ts';
import { EgaroucidWorkerAdapter } from './game/cpu/EgaroucidWorkerAdapter.ts';
import { CpuEngineRegistry } from './game/cpu/CpuEngineRegistry.ts';
import { CPU_ENGINES } from './game/cpu/cpuConfig.ts';
import './styles.css';

const rootElement = document.querySelector('#root');

if (rootElement === null) {
  throw new Error('Reactのマウント先 #root が見つかりません。');
}

const workerAvailable = typeof Worker === 'function';
const wasmAvailable = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
const cpuEngine = new CpuEngineRegistry({
  ...(workerAvailable ? { [CPU_ENGINES.LEGACY]: new LegacyCpuWorkerAdapter() } : {}),
  ...(workerAvailable && wasmAvailable ? { [CPU_ENGINES.EGAROUCID]: new EgaroucidWorkerAdapter() } : {}),
}, {
  [CPU_ENGINES.LEGACY]: 'このブラウザではCPU用Web Workerを利用できません。人 対 人は引き続き遊べます。',
  [CPU_ENGINES.EGAROUCID]: !workerAvailable
    ? 'このブラウザでは高性能AIに必要なWeb Workerを利用できません。オリジナルCPUも利用できません。'
    : 'このブラウザでは高性能AIに必要なWebAssemblyを利用できません。オリジナルCPUを選択してください。',
});

createRoot(rootElement).render(
  <StrictMode>
    <App cpuEngine={cpuEngine} />
  </StrictMode>,
);
