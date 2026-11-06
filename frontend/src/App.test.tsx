import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getLegalMoves, type Position } from '@reversi/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import type { CpuEngine, CpuSearchRequest, CpuSearchResult } from './game/cpu/CpuEngine.ts';
import { SETTINGS_KEY } from './game/settings.ts';

class FirstLegalCpu implements CpuEngine {
  disposed = false;
  calls = 0;
  async search(request: CpuSearchRequest): Promise<CpuSearchResult> {
    this.calls += 1;
    return { ...request, move: getLegalMoves(request.board, request.color)[0] ?? null };
  }
  dispose() { this.disposed = true; }
}

class DeferredCpu implements CpuEngine {
  request: CpuSearchRequest | null = null;
  resolve: ((value: CpuSearchResult) => void) | null = null;
  search(request: CpuSearchRequest): Promise<CpuSearchResult> {
    this.request = request;
    return new Promise((resolve) => { this.resolve = resolve; });
  }
  finish(move: Position) {
    if (!this.request || !this.resolve) throw new Error('CPU要求がありません。');
    this.resolve({ ...this.request, move });
  }
  dispose() {}
}

class IllegalCpu implements CpuEngine {
  async search(request: CpuSearchRequest): Promise<CpuSearchResult> {
    return { ...request, move: { index: 0, row: 0, col: 0 } };
  }
  dispose() {}
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('React画面と操作', () => {
  it('設定画面を表示し、未接続CPUを製品機能として開始しない', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /考えるほど/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /人 対 CPU/ })).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('CPU用Web Workerを利用できません');
    expect(screen.getByRole('button', { name: /対局をはじめる/ })).toBeDisabled();
  });

  it('v2.0.0の対応ソースとライセンス文書への導線を表示する', () => {
    render(<App />);
    fireEvent.click(screen.getByText('ライセンス文書と改変の詳細'));
    expect(screen.getByRole('link', { name: '対応ソース（v2.0.0）' })).toHaveAttribute(
      'href',
      'https://github.com/shiroshiba-lab/reversi-game-source/releases/tag/v2.0.0',
    );
    expect(screen.getByRole('link', { name: /NOTICE/ })).toHaveAttribute('href', 'egaroucid/NOTICE.txt');
  });

  it('人対人を開始し、マウスとキーボードで着手して石数・手番を更新する', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('radio', { name: /人 対 人/ }));
    fireEvent.click(screen.getByRole('button', { name: /対局をはじめる/ }));
    expect(screen.getAllByRole('gridcell')).toHaveLength(64);
    fireEvent.click(screen.getByRole('gridcell', { name: 'D3、空き、着手可能' }));
    expect(screen.getByText('4', { selector: '#black-score' })).toBeInTheDocument();
    expect(screen.getByText('白の手番', { selector: '#side-turn' })).toBeInTheDocument();
    const c3 = screen.getByRole('gridcell', { name: 'C3、空き、着手可能' });
    c3.focus();
    fireEvent.keyDown(c3, { key: ' ' });
    expect(screen.getByText('2', { selector: '#move-count' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('gridcell', { name: /D3、黒の石/ }), { key: 'ArrowRight' });
    expect(document.activeElement).toHaveAttribute('data-index', '20');
  });

  it('設定だけを互換キーへ保存し、再描画時に復元する', () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole('radio', { name: /人 対 人/ }));
    fireEvent.click(screen.getByRole('button', { name: /対局をはじめる/ }));
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({ mode: 'human-human' });
    unmount();
    render(<App />);
    expect(screen.getByRole('radio', { name: /人 対 人/ })).toBeChecked();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('破棄確認dialogへfocusを移し、取消後に起点へ戻す', async () => {
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
    render(<App />);
    fireEvent.click(screen.getByRole('radio', { name: /人 対 人/ }));
    fireEvent.click(screen.getByRole('button', { name: /対局をはじめる/ }));
    const restart = screen.getByRole('button', { name: 'もう一度' });
    fireEvent.click(restart);
    await waitFor(() => expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(restart).toHaveFocus());
  });

  it('Fake CPUで人対CPUを進める', async () => {
    render(<App cpuEngine={new FirstLegalCpu()} />);
    fireEvent.click(screen.getByRole('button', { name: /対局をはじめる/ }));
    fireEvent.click(screen.getByRole('gridcell', { name: 'D3、空き、着手可能' }));
    await waitFor(() => expect(screen.getByText('2', { selector: '#move-count' })).toBeInTheDocument(), { timeout: 1500 });
    expect(screen.getByText('黒の手番', { selector: '#side-turn' })).toBeInTheDocument();
  });

  it('Strict Modeのeffect再実行でも二重着手せず、利用中engineを破棄しない', async () => {
    const cpu = new FirstLegalCpu();
    const view = render(<StrictMode><App cpuEngine={cpu} /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: /対局をはじめる/ }));
    fireEvent.click(screen.getByRole('gridcell', { name: 'D3、空き、着手可能' }));
    await waitFor(() => expect(screen.getByText('2', { selector: '#move-count' })).toBeInTheDocument(), { timeout: 1500 });
    expect(cpu.disposed).toBe(false);
    view.unmount();
    await waitFor(() => expect(cpu.disposed).toBe(true));
  });

  it('再対局後に遅延した旧CPU結果を破棄する', async () => {
    const cpu = new DeferredCpu();
    render(<App cpuEngine={cpu} />);
    fireEvent.click(screen.getByRole('button', { name: /対局をはじめる/ }));
    fireEvent.click(screen.getByRole('gridcell', { name: 'D3、空き、着手可能' }));
    await waitFor(() => expect(cpu.request).not.toBeNull(), { timeout: 1500 });
    fireEvent.click(screen.getByRole('button', { name: 'もう一度' }));
    fireEvent.click(screen.getByRole('button', { name: '続行する' }));
    cpu.finish({ index: 18, row: 2, col: 2 });
    await waitFor(() => expect(screen.getByText('0', { selector: '#move-count' })).toBeInTheDocument());
  });

  it('Fake CPU対CPUを停止・一手進行・再開できる', async () => {
    render(<App cpuEngine={new FirstLegalCpu()} />);
    fireEvent.click(screen.getByRole('radio', { name: /CPU 対 CPU/ }));
    fireEvent.click(screen.getByRole('button', { name: /対局をはじめる/ }));
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(screen.getByText('0', { selector: '#move-count' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '一手進める' }));
    await waitFor(() => expect(screen.getByText('1', { selector: '#move-count' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '再開' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再開' }));
    await waitFor(() => expect(Number(screen.getByText(/\d+/, { selector: '#move-count' }).textContent)).toBeGreaterThan(1), { timeout: 1500 });
  });

  it('Fake CPUの非合法着手を拒否して安全停止する', async () => {
    render(<App cpuEngine={new IllegalCpu()} />);
    fireEvent.click(screen.getByRole('button', { name: /対局をはじめる/ }));
    fireEvent.click(screen.getByRole('gridcell', { name: 'D3、空き、着手可能' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('安全に停止しました'), { timeout: 1500 });
    expect(screen.getByText('1', { selector: '#move-count' })).toBeInTheDocument();
  });
});
