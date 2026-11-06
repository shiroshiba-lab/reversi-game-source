import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixture from '../../test/fixtures/v1.1.0-regression.json' with { type: 'json' };

function monitor(page) {
  const errors = [];
  const requests = [];
  const responses = [];
  const context = page.context();
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  context.on('request', (request) => requests.push(request.url()));
  context.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()}`));
  context.on('response', (response) => {
    responses.push({ url: response.url(), status: response.status(), contentType: response.headers()['content-type'] ?? '' });
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return { errors, requests, responses };
}

async function startHumanGame(page) {
  await page.locator('input[name="mode"][value="human-human"]').check();
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('.cell')).toHaveCount(64);
}

async function finishFirstLegalGame(page) {
  for (let count = 0; count < 60; count += 1) {
    if (await page.locator('#result-dialog').isVisible()) return;
    const legal = page.locator('.cell.is-legal').first();
    await expect(legal).toBeVisible();
    await legal.click();
  }
  await expect(page.locator('#result-dialog')).toBeVisible();
}

async function startHumanCpu(page, { humanColor = '1', level = 'easy' } = {}) {
  await page.locator('input[name="mode"][value="human-cpu"]').check();
  await page.locator(`input[name="humanColor"][value="${humanColor}"]`).check();
  await page.locator('#cpu-level').selectOption(level);
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
}

async function selectHumanEgaroucid(page, level) {
  await page.locator('input[name="mode"][value="human-cpu"]').check();
  await page.locator('input[name="humanColor"][value="2"]').check();
  await page.locator('#cpu-engine').selectOption('egaroucid');
  await page.locator('#cpu-egaroucid-level').selectOption(String(level));
}

async function expectNoHorizontalOverflow(page) {
  const report = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`,
          left: box.left,
          right: box.right,
          width: box.width,
        };
      })
      .filter(({ left, right, width }) => width > 0 && (left < -1 || right > viewportWidth + 1));
    return {
      viewportWidth,
      htmlScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders,
    };
  });
  expect(report, JSON.stringify(report)).toEqual({
    viewportWidth: report.viewportWidth,
    htmlScrollWidth: report.viewportWidth,
    bodyScrollWidth: report.viewportWidth,
    offenders: [],
  });
}

test('CPU表示・難易度説明・クレジット・開始ボタン余白を利用者向けUIに反映する', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#cpu-engine option[value="legacy"]')).toHaveText('オリジナルCPU（4段階）');
  await expect(page.locator('#cpu-engine option[value="egaroucid"]')).toHaveText('高性能AI（Level 0〜15）');
  await expect(page.locator('#cpu-level option')).toHaveText([
    '初級：合法手からランダムに選ぶ',
    '標準：角や相手の打てる場所を考えて選ぶ',
    '上級：数手先まで読んで選ぶ',
    '最強：より深く読み、有利な手を探す',
  ]);
  await expect(page.getByText('Web版のLevel番号です。')).toHaveCount(0);

  const startButtonGap = await page.getByRole('button', { name: /対局をはじめる/ }).evaluate((button) => {
    const previous = button.previousElementSibling;
    if (!previous) return 0;
    return button.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
  });
  expect(startButtonGap).toBeGreaterThanOrEqual(20);

  await expect(page.getByRole('heading', { name: 'このアプリについて・ライセンス' })).toBeVisible();
  const officialLink = page.getByRole('link', { name: 'Egaroucid for Web' });
  await expect(officialLink).toHaveAttribute('href', 'https://www.egaroucid.nyanyan.dev/ja/web/');
  await page.getByText('ライセンス文書と改変の詳細').focus();
  await page.getByText('ライセンス文書と改変の詳細').press('Enter');
  for (const href of ['egaroucid/NOTICE.txt', 'egaroucid/GPL-3.0.txt', 'egaroucid/Emscripten-LICENSE.txt', 'egaroucid/emsdk-LICENSE.txt']) {
    const response = await page.request.get(`/${href}`);
    expect(response.ok()).toBe(true);
  }
  const sourceLink = page.getByRole('link', { name: '対応ソース（v2.0.0）' });
  await expect(sourceLink).toHaveAttribute('href', 'https://github.com/shiroshiba-lab/reversi-game-source/releases/tag/v2.0.0');
  await expect(page.getByText('この公開リポジトリはEgaroucid公式リポジトリではありません。', { exact: false })).toBeVisible();
});

test('Egaroucid Level 0〜15を製品UIから選び、全Levelが合法な初手を返す', async ({ page }) => {
  test.setTimeout(120_000);
  const observed = monitor(page);
  await page.goto('/');
  for (let level = 0; level <= 15; level += 1) {
    await selectHumanEgaroucid(page, level);
    await page.getByRole('button', { name: /対局をはじめる/ }).click();
    await expect(page.locator('#move-count')).toHaveText('1', { timeout: 15_000 });
    await expect(page.locator('#status-message')).not.toHaveAttribute('data-kind', 'error');
    await expect(page.locator('#black-owner')).toContainText(`高性能AI Level ${level}`);
    await page.getByRole('button', { name: '設定に戻る' }).click();
    await page.getByRole('button', { name: '続行する' }).click();
  }
  await page.locator('input[name="humanColor"][value="1"]').check();
  await page.locator('#cpu-engine').selectOption('egaroucid');
  await page.locator('#cpu-egaroucid-level').selectOption('4');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).click();
  await expect(page.locator('#move-count')).toHaveText('2', { timeout: 15_000 });
  expect(observed.requests.some((url) => url.includes('/egaroucid/egaroucid.worker.js'))).toBe(true);
  expect(observed.errors).toEqual([]);
});

test('Vite開発版でもEgaroucid Level 15の混在対局とLevel 0の初手を実WASMから適用する', async ({ page }) => {
  test.setTimeout(90_000);
  const observed = monitor(page);

  await page.goto('/');
  await page.locator('input[name="mode"][value="cpu-cpu"]').check();
  await page.locator('#black-cpu-engine').selectOption('legacy');
  await page.locator('select[name="cpuLevelBlack"]').selectOption('expert');
  await page.locator('#white-cpu-engine').selectOption('egaroucid');
  await page.locator('#white-cpu-egaroucid-level').selectOption('15');
  await page.locator('#watch-speed').selectOption('500');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#move-count')).toHaveText('2', { timeout: 20_000 });
  await expect(page.locator('#black-owner')).toContainText('オリジナルCPU 最強');
  await expect(page.locator('#white-owner')).toContainText('高性能AI Level 15');

  await page.goto('/');
  await page.locator('input[name="mode"][value="cpu-cpu"]').check();
  await page.locator('#black-cpu-engine').selectOption('egaroucid');
  await page.locator('#black-cpu-egaroucid-level').selectOption('15');
  await page.locator('#white-cpu-engine').selectOption('legacy');
  await page.locator('select[name="cpuLevelWhite"]').selectOption('expert');
  await page.locator('#watch-speed').selectOption('500');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#move-count')).toHaveText('1', { timeout: 20_000 });
  await expect(page.locator('#black-owner')).toContainText('高性能AI Level 15');
  await expect(page.locator('#white-owner')).toContainText('オリジナルCPU 最強');

  await page.goto('/');
  await page.locator('input[name="mode"][value="human-cpu"]').check();
  await page.locator('input[name="humanColor"][value="1"]').check();
  await page.locator('#cpu-engine').selectOption('egaroucid');
  await page.locator('#cpu-egaroucid-level').selectOption('15');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).click();
  await expect(page.locator('#move-count')).toHaveText('2', { timeout: 20_000 });

  await page.goto('/');
  await selectHumanEgaroucid(page, 0);
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#move-count')).toHaveText('1', { timeout: 20_000 });

  const aiJsResponse = await page.request.get('/egaroucid/ai.js');
  expect(aiJsResponse.ok()).toBe(true);
  expect(aiJsResponse.headers()['content-type']).toContain('javascript');
  expect(observed.requests.some((url) => url.includes('/egaroucid/egaroucid.worker.js'))).toBe(true);
  expect(observed.requests.some((url) => url.includes('/egaroucid/ai.wasm'))).toBe(true);
  expect(observed.responses.some(({ url, status, contentType }) => url.includes('/egaroucid/egaroucid.worker.js') && status === 200 && contentType.includes('javascript'))).toBe(true);
  expect(observed.responses.some(({ url, status, contentType }) => url.includes('/egaroucid/ai.wasm') && status === 200 && contentType.includes('application/wasm'))).toBe(true);
  expect(observed.errors).toEqual([]);
});

test('Egaroucidと既存CPUを黒白に分け、停止・一手進行・再開できる', async ({ page }) => {
  test.setTimeout(30_000);
  const observed = monitor(page);
  await page.goto('/');
  await page.locator('input[name="mode"][value="cpu-cpu"]').check();
  await page.locator('#black-cpu-engine').selectOption('egaroucid');
  await page.locator('#black-cpu-egaroucid-level').selectOption('5');
  await page.locator('#white-cpu-engine').selectOption('legacy');
  await page.locator('select[name="cpuLevelWhite"]').selectOption('expert');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await page.getByRole('button', { name: '一時停止' }).click();
  await page.waitForTimeout(700);
  await expect(page.locator('#move-count')).toHaveText('0');
  await page.getByRole('button', { name: '一手進める' }).click();
  await expect(page.locator('#move-count')).toHaveText('1', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: '再開' })).toBeVisible();
  await page.getByRole('button', { name: '再開' }).click();
  await expect(page.locator('#move-count')).not.toHaveText('1', { timeout: 5_000 });
  await expect(page.locator('#black-owner')).toContainText('高性能AI Level 5');
  await expect(page.locator('#white-owner')).toContainText('オリジナルCPU 最強');
  expect(observed.errors).toEqual([]);
});

test('Egaroucidと既存CPUの混在CPU対CPUが一局完走する', async ({ page }) => {
  test.setTimeout(90_000);
  const observed = monitor(page);
  await page.goto('/');
  await page.locator('input[name="mode"][value="cpu-cpu"]').check();
  await page.locator('#black-cpu-engine').selectOption('egaroucid');
  await page.locator('#black-cpu-egaroucid-level').selectOption('0');
  await page.locator('#white-cpu-engine').selectOption('legacy');
  await page.locator('select[name="cpuLevelWhite"]').selectOption('easy');
  await page.locator('#watch-speed').selectOption('500');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#result-dialog')).toBeVisible({ timeout: 85_000 });
  const black = Number(await page.locator('#black-score').textContent());
  const white = Number(await page.locator('#white-score').textContent());
  expect(black + white).toBeLessThanOrEqual(64);
  expect(black + white).toBeGreaterThan(4);
  expect(observed.errors).toEqual([]);
});

test('EgaroucidのWASM読込失敗では盤面不変で停止し、手動再試行で復旧する', async ({ page }) => {
  test.setTimeout(30_000);
  let wasmFailures = 0;
  const failWasm = async (route) => {
    wasmFailures += 1;
    await route.abort('failed');
  };
  await page.route('**/egaroucid/ai.wasm*', failWasm);
  await page.goto('/');
  await selectHumanEgaroucid(page, 4);
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#status-message')).toHaveAttribute('data-kind', 'error', { timeout: 15_000 });
  await expect(page.locator('#move-count')).toHaveText('0');
  await expect(page.locator('#black-owner')).toContainText('高性能AI Level 4');
  await page.waitForTimeout(1_000);
  expect(wasmFailures).toBe(1);
  await page.unroute('**/egaroucid/ai.wasm*', failWasm);
  await page.getByRole('button', { name: '同じ設定で再試行' }).click();
  await expect(page.locator('#move-count')).toHaveText('1', { timeout: 15_000 });
  await expect(page.locator('#status-message')).not.toHaveAttribute('data-kind', 'error');
});

test('WebAssembly非対応時も既存CPUを選んで対局できる', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'WebAssembly', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await expect(page.locator('#cpu-engine')).toHaveValue('legacy');
  await expect(page.locator('#cpu-engine option[value="egaroucid"]')).toBeDisabled();
  await expect(page.getByRole('button', { name: /対局をはじめる/ })).toBeEnabled();
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).click();
  await expect(page.locator('#move-count')).toHaveText('2', { timeout: 5_000 });
});

test('React本番buildは外部通信とConsole errorなしで起動する', async ({ page }) => {
  const observed = monitor(page);
  await page.goto('/');
  await expect(page).toHaveTitle('リバーシ盤');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('heading', { name: /考えるほど/ })).toBeVisible();
  const wasmResponse = await page.request.get('/egaroucid/ai.wasm');
  expect(wasmResponse.ok()).toBe(true);
  expect(wasmResponse.headers()['content-type']).toContain('application/wasm');
  expect(new Set(observed.requests.map((url) => new URL(url).origin))).toEqual(new Set(['http://127.0.0.1:4174']));
  expect(observed.errors).toEqual([]);
});

test('実Workerで人対CPUを人間の黒・白から開始できる', async ({ page }) => {
  const observed = monitor(page);
  await page.goto('/');
  await startHumanCpu(page, { humanColor: '1', level: 'easy' });
  await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).click();
  await expect(page.locator('#move-count')).toHaveText('2', { timeout: 5_000 });
  await page.getByRole('button', { name: '設定に戻る' }).click();
  await page.getByRole('button', { name: '続行する' }).click();
  await startHumanCpu(page, { humanColor: '2', level: 'normal' });
  await expect(page.locator('#move-count')).toHaveText('1', { timeout: 5_000 });
  await expect(page.locator('#side-actor')).toContainText('あなた');
  expect(observed.requests.some((url) => url.includes('legacyCpu.worker'))).toBe(true);
  expect(observed.errors).toEqual([]);
});

test('実Workerの4難易度が人の着手へ合法に応答する', async ({ page }) => {
  test.setTimeout(30_000);
  const observed = monitor(page);
  for (const level of ['easy', 'normal', 'advanced', 'expert']) {
    await page.goto('/');
    await startHumanCpu(page, { humanColor: '1', level });
    await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).click();
    await expect(page.locator('#move-count')).toHaveText('2', { timeout: 6_000 });
    await expect(page.locator('#status-message')).not.toHaveAttribute('data-kind', 'error');
  }
  expect(observed.errors).toEqual([]);
});

test('実Workerの人対CPUを一局終局まで進行できる', async ({ page }) => {
  test.setTimeout(45_000);
  const observed = monitor(page);
  await page.goto('/');
  await startHumanCpu(page, { humanColor: '1', level: 'easy' });

  for (let turn = 0; turn < 60; turn += 1) {
    await page.waitForFunction(() => document.querySelector('#result-dialog')?.open || document.querySelector('.cell.is-legal'));
    if (await page.locator('#result-dialog').isVisible()) break;
    await page.locator('.cell.is-legal').first().click();
  }

  await expect(page.locator('#result-dialog')).toBeVisible();
  const black = Number(await page.locator('#black-score').textContent());
  const white = Number(await page.locator('#white-score').textContent());
  expect(black + white).toBeLessThanOrEqual(64);
  expect(black + white).toBeGreaterThan(4);
  expect(observed.errors).toEqual([]);
});

test('実WorkerのCPU対CPUを停止・一手進行・速度変更・再開できる', async ({ page }) => {
  const observed = monitor(page);
  await page.goto('/');
  await page.locator('input[name="mode"][value="cpu-cpu"]').check();
  await page.locator('select[name="cpuLevelBlack"]').selectOption('easy');
  await page.locator('select[name="cpuLevelWhite"]').selectOption('normal');
  await page.locator('#watch-speed').selectOption('500');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await page.getByRole('button', { name: '一時停止' }).click();
  await page.waitForTimeout(700);
  await expect(page.locator('#move-count')).toHaveText('0');
  await page.getByRole('button', { name: '一手進める' }).click();
  await expect(page.locator('#move-count')).toHaveText('1', { timeout: 3_000 });
  await expect(page.getByRole('button', { name: '再開' })).toBeVisible();
  await page.locator('#game-speed').selectOption('1000');
  await page.getByRole('button', { name: '再開' }).click();
  await expect(page.locator('#move-count')).not.toHaveText('1', { timeout: 4_000 });
  expect(observed.errors).toEqual([]);
});

test('実Workerの探索中に設定復帰しても古い結果を適用しない', async ({ page }) => {
  const observed = monitor(page);
  await page.goto('/');
  await startHumanCpu(page, { humanColor: '2', level: 'expert' });
  await expect(page.locator('#thinking-indicator')).toBeVisible({ timeout: 2_000 });
  await page.getByRole('button', { name: '設定に戻る' }).click();
  await page.getByRole('button', { name: '続行する' }).click();
  await expect(page.locator('#setup-view')).toBeVisible();
  await page.waitForTimeout(2_000);
  await expect(page.locator('#game-view')).toHaveCount(0);
  expect(observed.errors).toEqual([]);
});

test('Workerの処理中例外で安全停止し、自動再試行しない', async ({ page }) => {
  let workerRequests = 0;
  await page.route('**/assets/legacyCpu.worker-*.js', async (route) => {
    workerRequests += 1;
    await route.fulfill({
      contentType: 'text/javascript',
      body: "self.onmessage = ({ data }) => self.postMessage({ requestId: data.requestId, gameId: data.gameId, generationId: data.generationId, error: 'forced worker failure' });",
    });
  });
  await page.goto('/');
  await startHumanCpu(page, { humanColor: '1', level: 'easy' });
  await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).click();
  await expect(page.locator('#status-message')).toHaveAttribute('data-kind', 'error', { timeout: 5_000 });
  await expect(page.locator('#move-count')).toHaveText('1');
  await page.waitForTimeout(2_500);
  await expect(page.locator('#move-count')).toHaveText('1');
  expect(workerRequests).toBe(1);
});

test('実WorkerのCPU対CPUが一局完走する', async ({ page }) => {
  test.setTimeout(75_000);
  const observed = monitor(page);
  await page.goto('/');
  await page.locator('input[name="mode"][value="cpu-cpu"]').check();
  await page.locator('select[name="cpuLevelBlack"]').selectOption('easy');
  await page.locator('select[name="cpuLevelWhite"]').selectOption('easy');
  await page.locator('#watch-speed').selectOption('500');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#result-dialog')).toBeVisible({ timeout: 70_000 });
  const black = Number(await page.locator('#black-score').textContent());
  const white = Number(await page.locator('#white-score').textContent());
  expect(black + white).toBeLessThanOrEqual(64);
  expect(black + white).toBeGreaterThan(4);
  expect(observed.errors).toEqual([]);
});

test('Production buildの実Worker往復を製品条件で測定する', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const observed = monitor(page);
  await page.goto('/');
  await startHumanCpu(page, { humanColor: '1', level: 'easy' });
  await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).click();
  await expect(page.locator('#move-count')).toHaveText('2', { timeout: 5_000 });
  const workerUrl = observed.requests.find((url) => url.includes('legacyCpu.worker-'));
  expect(workerUrl).toBeTruthy();
  const positions = fixture.cpuPositions.filter(({ benchmark }) => benchmark).map(({ id, board, turn, legalMoves }) => ({ id, board, turn, legalMoves }));
  const report = await page.evaluate(async ({ url, positions: scenarios }) => {
    const cells = { '.': 0, B: 1, W: 2 };
    const worker = new Worker(url, { type: 'module' });
    const search = (message) => new Promise((resolve, reject) => {
      const onMessage = (event) => {
        if (event.data.requestId !== message.requestId) return;
        worker.removeEventListener('message', onMessage);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result);
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage(message);
    });
    const rows = [];
    for (const scenario of scenarios) {
      const board = scenario.board.flatMap((row) => [...row].map((symbol) => cells[symbol]));
      for (const level of ['advanced', 'expert']) {
        const runs = [];
        for (let iteration = 0; iteration < 3; iteration += 1) {
          const startedAt = performance.now();
          const result = await search({ requestId: `${scenario.id}-${level}-${iteration}`, gameId: 'browser-benchmark', generationId: 1, board, color: scenario.turn, level });
          const durationMs = performance.now() - startedAt;
          if (!scenario.legalMoves.includes(result.move?.index)) throw new Error(`${scenario.id}/${level}が非合法手を返しました。`);
          runs.push({ durationMs, move: result.move.index, completedDepth: result.diagnostics.completedDepth, timedOut: result.diagnostics.timedOut, exactCompleted: result.diagnostics.exactCompleted });
        }
        const times = runs.map(({ durationMs }) => durationMs).sort((left, right) => left - right);
        rows.push({ scenario: scenario.id, level, selectedMoves: [...new Set(runs.map(({ move }) => move))], meanMs: times.reduce((sum, value) => sum + value, 0) / times.length, medianMs: times[1], p95Ms: times[2], maximumMs: times[2], runs });
      }
    }
    worker.terminate();
    return rows;
  }, { url: workerUrl, positions });
  await testInfo.attach('browser-worker-benchmark.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  console.log(`browser-worker-benchmark ${JSON.stringify(report.map(({ scenario, level, selectedMoves, meanMs, medianMs, p95Ms, maximumMs, runs }) => ({ scenario, level, selectedMoves, meanMs: Number(meanMs.toFixed(1)), medianMs: Number(medianMs.toFixed(1)), p95Ms: Number(p95Ms.toFixed(1)), maximumMs: Number(maximumMs.toFixed(1)), completedDepths: runs.map(({ completedDepth }) => completedDepth), timeouts: runs.map(({ timedOut }) => timedOut) })))}`);
  expect(report).toHaveLength(12);
  expect(observed.errors).toEqual([]);
});

test('人対人をキーボードで進行し、確認dialogから再対局・設定復帰できる', async ({ page }) => {
  await page.goto('/');
  await startHumanGame(page);
  const d3 = page.getByRole('gridcell', { name: 'D3、空き、着手可能' });
  await d3.focus();
  await d3.press('Enter');
  await expect(page.locator('#move-count')).toHaveText('1');
  const c3 = page.getByRole('gridcell', { name: 'C3、空き、着手可能' });
  await c3.focus();
  await c3.press('Space');
  await expect(page.locator('#move-count')).toHaveText('2');
  await page.getByRole('button', { name: 'もう一度' }).click();
  await expect(page.getByRole('button', { name: 'キャンセル' })).toBeFocused();
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByRole('button', { name: 'もう一度' })).toBeFocused();
  await page.getByRole('button', { name: '設定に戻る' }).click();
  await page.getByRole('button', { name: '続行する' }).click();
  await expect(page.locator('#setup-view')).toBeVisible();
});

test('新規配置石ではなく反転した石だけをアニメーションする', async ({ page }) => {
  await page.goto('/');
  await startHumanGame(page);
  await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).click();
  await expect(page.locator('.cell[data-index="27"] .stone')).toHaveClass(/is-flipped/);
  await expect(page.locator('.cell[data-index="19"] .stone')).not.toHaveClass(/is-flipped/);
  await page.locator('.cell[data-index="27"] .stone').evaluate((stone) => { window.__previousFlippedStone = stone; });
  await page.getByRole('gridcell', { name: 'C3、空き、着手可能' }).click();
  await expect(page.locator('.cell[data-index="27"] .stone')).toHaveClass(/is-flipped/);
  await expect(page.locator('.cell[data-index="18"] .stone')).not.toHaveClass(/is-flipped/);
  expect(await page.evaluate(() => window.__previousFlippedStone.isConnected)).toBe(false);
});

test('設定を保存し、再読込では対局を再開しない', async ({ page }) => {
  await page.goto('/');
  await startHumanGame(page);
  await page.reload();
  await expect(page.locator('#setup-view')).toBeVisible();
  await expect(page.locator('input[name="mode"][value="human-human"]')).toBeChecked();
  await expect(page.locator('#game-view')).toHaveCount(0);
});

test('CPU対CPUの黒白難易度と観戦速度を互換キーから復元する', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[name="mode"][value="cpu-cpu"]').check();
  await page.locator('select[name="cpuLevelBlack"]').selectOption('advanced');
  await page.locator('select[name="cpuLevelWhite"]').selectOption('expert');
  await page.locator('#watch-speed').selectOption('2000');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('reversi-board.settings.v1')))).toEqual({
    mode: 'cpu-cpu',
    humanColor: null,
    cpuEngineBlack: 'legacy',
    cpuEngineWhite: 'legacy',
    cpuLevelBlack: 'advanced',
    cpuLevelWhite: 'expert',
    egaroucidLevelBlack: 4,
    egaroucidLevelWhite: 4,
    egaroucidUseBookBlack: true,
    egaroucidUseBookWhite: true,
    speed: 2000,
  });

  await page.reload();
  await expect(page.locator('#setup-view')).toBeVisible();
  await expect(page.locator('input[name="mode"][value="cpu-cpu"]')).toBeChecked();
  await expect(page.locator('select[name="cpuLevelBlack"]')).toHaveValue('advanced');
  await expect(page.locator('select[name="cpuLevelWhite"]')).toHaveValue('expert');
  await expect(page.locator('#watch-speed')).toHaveValue('2000');
  await expect(page.locator('#game-view')).toHaveCount(0);
});

test('Worker非対応時はCPUモードを説明付きで無効化し、人対人は継続できる', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('CPU用Web Workerを利用できません');
  await expect(page.getByRole('button', { name: /対局をはじめる/ })).toBeDisabled();
  await page.locator('input[name="mode"][value="human-human"]').check();
  await expect(page.getByRole('button', { name: /対局をはじめる/ })).toBeEnabled();
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('.cell')).toHaveCount(64);
});

test('人対人を自動パスと終局まで進め、結果を表示する', async ({ page }) => {
  await page.goto('/');
  await startHumanGame(page);
  await finishFirstLegalGame(page);
  await expect(page.locator('#result-dialog')).toBeVisible();
  await expect(page.locator('#result-score')).toContainText(/黒 \d+ — \d+ 白/);
  await expect(page.getByRole('heading', { name: '最終盤面' })).toBeVisible();
  await expect(page.locator('#final-board .final-board-cell')).toHaveCount(64);
  await expect(page.locator('#final-board button, #final-board [tabindex]')).toHaveCount(0);
  await expect(page.locator('#result-restart')).toBeFocused();

  const result = await page.evaluate(() => {
    const cellValue = (cell) => cell.querySelector('.stone.black') ? 'black' : cell.querySelector('.stone.white') ? 'white' : 'empty';
    const backgroundBoard = [...document.querySelectorAll('#board .cell')].map(cellValue);
    const finalBoard = [...document.querySelectorAll('#final-board .final-board-cell')].map((cell) => cell.dataset.cell);
    const displayedScore = document.querySelector('#result-score')?.textContent ?? '';
    return {
      backgroundBoard,
      finalBoard,
      displayedScore,
      black: finalBoard.filter((cell) => cell === 'black').length,
      white: finalBoard.filter((cell) => cell === 'white').length,
      empty: finalBoard.filter((cell) => cell === 'empty').length,
      moveCount: document.querySelector('#move-count')?.textContent,
      dialogOpen: document.querySelector('#result-dialog')?.open,
    };
  });
  expect(result.finalBoard).toEqual(result.backgroundBoard);
  expect(result.black + result.white + result.empty).toBe(64);
  expect(result.displayedScore).toBe(`黒 ${result.black} — ${result.white} 白`);
  expect(result.dialogOpen).toBe(true);

  await page.locator('#final-board .final-board-cell').first().click();
  await expect(page.locator('#move-count')).toHaveText(result.moveCount);
  expect(await page.locator('#final-board .final-board-cell').evaluateAll((cells) => cells.map((cell) => cell.dataset.cell))).toEqual(result.finalBoard);

  const axeResult = await new AxeBuilder({ page }).include('#result-dialog').analyze();
  expect(axeResult.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);

  await page.locator('#result-restart').click();
  await expect(page.locator('#result-dialog')).not.toBeVisible();
  await expect(page.locator('#move-count')).toHaveText('0');
  await finishFirstLegalGame(page);
  await page.locator('#result-setup').click();
  await expect(page.locator('#setup-view')).toBeVisible();
});

test('結果モーダルが主要viewportで横にはみ出さず、必要時に縦スクロールできる', async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 393, height: 852 }, { width: 428, height: 926 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await startHumanGame(page);
    await finishFirstLegalGame(page);
    await expectNoHorizontalOverflow(page);
    const geometry = await page.locator('#result-dialog').evaluate((dialog) => {
      const board = dialog.querySelector('#final-board').getBoundingClientRect();
      const box = dialog.getBoundingClientRect();
      return {
        boardWidth: board.width,
        boardHeight: board.height,
        dialogTop: box.top,
        dialogBottom: box.bottom,
        dialogClientWidth: dialog.clientWidth,
        dialogScrollWidth: dialog.scrollWidth,
        dialogClientHeight: dialog.clientHeight,
        dialogScrollHeight: dialog.scrollHeight,
        overflowY: getComputedStyle(dialog).overflowY,
      };
    });
    expect(Math.abs(geometry.boardWidth - geometry.boardHeight)).toBeLessThanOrEqual(1);
    expect(geometry.boardWidth).toBeGreaterThanOrEqual(viewport.width === 320 ? 190 : 200);
    expect(geometry.boardWidth).toBeLessThanOrEqual(240);
    expect(geometry.dialogTop).toBeGreaterThanOrEqual(0);
    expect(geometry.dialogBottom).toBeLessThanOrEqual(viewport.height);
    expect(geometry.dialogScrollWidth).toBeLessThanOrEqual(geometry.dialogClientWidth);
    expect(geometry.overflowY).toBe('auto');
    if (geometry.dialogScrollHeight > geometry.dialogClientHeight) {
      await page.locator('#result-setup').scrollIntoViewIfNeeded();
    }
    await expect(page.locator('#result-restart')).toBeVisible();
    await expect(page.locator('#result-setup')).toBeVisible();
  }
});

test('タッチ操作・reduced motion・axe重要違反なし', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('input[name="mode"][value="human-human"]').tap();
  await page.getByRole('button', { name: /対局をはじめる/ }).tap();
  await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).tap();
  await expect(page.locator('#move-count')).toHaveText('1');
  expect(await page.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector('.button')).transitionDuration))).toBeLessThanOrEqual(0.001);
  expect(await page.locator('.stone.is-flipped').evaluate((stone) => getComputedStyle(stone).animationName)).toBe('none');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
  await context.close();
});

test('393x852で3モード・長いCPU名・ライセンス詳細が横にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/');
  await page.locator('#cpu-engine').selectOption('egaroucid');
  await page.locator('#cpu-egaroucid-level').selectOption('15');
  await page.getByText('ライセンス文書と改変の詳細').click();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#white-owner')).toContainText('高性能AI Level 15');
  await expectNoHorizontalOverflow(page);

  await page.goto('/');
  await page.locator('input[name="mode"][value="cpu-cpu"]').check();
  await page.locator('#black-cpu-engine').selectOption('legacy');
  await page.locator('select[name="cpuLevelBlack"]').selectOption('expert');
  await page.locator('#white-cpu-engine').selectOption('egaroucid');
  await page.locator('#white-cpu-egaroucid-level').selectOption('15');
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#black-owner')).toContainText('オリジナルCPU 最強');
  await expect(page.locator('#white-owner')).toContainText('高性能AI Level 15');
  await expectNoHorizontalOverflow(page);

  await page.goto('/');
  await page.locator('input[name="mode"][value="human-human"]').check();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expectNoHorizontalOverflow(page);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 393, height: 852 }, { width: 428, height: 926 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1366, height: 768 }]) {
  test(`主要表示 ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.locator('#cpu-engine').selectOption('egaroucid');
    await expect(page.locator('#cpu-egaroucid-level option')).toHaveCount(16);
    await expectNoHorizontalOverflow(page);
    await startHumanGame(page);
    await expectNoHorizontalOverflow(page);
    const geometry = await page.locator('#board').evaluate((board) => { const box = board.getBoundingClientRect(); const cells = [...board.querySelectorAll('.cell')].map((cell) => cell.getBoundingClientRect()); return { width: box.width, height: box.height, cellDelta: Math.max(...cells.map((cell) => Math.abs(cell.width - cell.height))) }; });
    expect(Math.abs(geometry.width - geometry.height)).toBeLessThanOrEqual(1);
    expect(geometry.cellDelta).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: /遊び方/ }).click();
    const box = await page.locator('#guide-dialog').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  });
}
