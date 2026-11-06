import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { atomicSwitch } from '../../scripts/release1-static-delivery.mjs';
import { CONTENT_SECURITY_POLICY, EGAROUCID_ARTIFACT_TOKEN } from '../../scripts/serve-release1-staging.mjs';

const stagingRoot = process.env.RELEASE1_STAGING_ROOT;
if (!stagingRoot) throw new Error('RELEASE1_STAGING_ROOTが必要です。');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function switchTo(target) {
  expect(await atomicSwitch(stagingRoot, target)).toBe(target);
}

async function startV2Egaroucid(page, level) {
  await page.locator('input[name="mode"][value="human-cpu"]').check();
  await page.locator('input[name="humanColor"][value="2"]').check();
  await page.locator('#cpu-engine').selectOption('egaroucid');
  await page.locator('#cpu-egaroucid-level').selectOption(String(level));
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#move-count')).toHaveText('1', { timeout: 20_000 });
}

async function returnToSetup(page) {
  await page.getByRole('button', { name: '設定に戻る' }).click();
  await page.getByRole('button', { name: '続行する' }).click();
  await expect(page.locator('#setup-view')).toBeVisible();
}

test.beforeEach(async () => switchTo('v2-candidate'));
test.afterAll(async () => switchTo('v2-candidate'));

test('Production相当CSP・MIME・security headerでmodule Workerとclassic Worker/WASMを許可する', async ({ page, request }) => {
  test.setTimeout(60_000);
  const failures = [];
  const requested = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (failed) => failures.push(`requestfailed: ${failed.url()} ${failed.failure()?.errorText ?? ''}`));
  page.on('request', (current) => requested.push(current.url()));

  const index = await request.get('/');
  expect(index.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
  expect(index.headers()['x-content-type-options']).toBe('nosniff');
  expect(index.headers()['cross-origin-opener-policy']).toBe('same-origin');
  expect(index.headers()['cross-origin-resource-policy']).toBe('same-origin');
  expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
  expect(CONTENT_SECURITY_POLICY).toContain("worker-src 'self'");
  expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
  expect(CONTENT_SECURITY_POLICY).not.toContain(' *');
  expect(CONTENT_SECURITY_POLICY).not.toContain('blob:');
  expect(CONTENT_SECURITY_POLICY).not.toContain('data:');

  await page.goto('/');
  await startV2Egaroucid(page, 0);
  await returnToSetup(page);
  await startV2Egaroucid(page, 15);
  await returnToSetup(page);
  await page.locator('#cpu-engine').selectOption('legacy');
  await page.locator('#cpu-level').selectOption('expert');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#move-count')).toHaveText('1', { timeout: 8_000 });

  expect(requested.some((url) => url.includes('/assets/legacyCpu.worker-'))).toBe(true);
  expect(requested.some((url) => url.includes('/egaroucid/egaroucid.worker.js'))).toBe(true);
  expect(requested.some((url) => url.includes('/egaroucid/ai.wasm'))).toBe(true);
  const aiJs = await request.get(`/egaroucid/ai.js?artifact=${EGAROUCID_ARTIFACT_TOKEN}`);
  expect(aiJs.ok()).toBe(true);
  expect(aiJs.headers()['content-type']).toContain('javascript');
  // FirefoxのPlaywright request eventはclassic Worker内のimportScripts()を列挙しない。
  // Level 0/15の実着手成功がai.js実行のbrowser側証跡で、上のHTTP検査が配信側証跡となる。
  expect(failures.filter((message) => /content security policy|csp|wasm|worker/i.test(message))).toEqual([]);
  expect(failures).toEqual([]);
});
test('cacheをHTML・hash asset・固定Egaroucidで分離し、cold/warm/token変更を再検証する', async ({ request }) => {
  const index = await request.get('/index.html');
  const html = await index.body();
  expect(index.headers()['cache-control']).toBe('no-cache');
  const source = html.toString('utf8');
  const js = source.match(/src="([^"]+index-[^"]+\.js)"/)?.[1];
  const css = source.match(/href="([^"]+index-[^"]+\.css)"/)?.[1];
  expect(js).toBeTruthy();
  expect(css).toBeTruthy();
  for (const path of [js, css]) {
    const response = await request.get(path);
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  }

  const artifactUrl = `/egaroucid/ai.wasm?artifact=${EGAROUCID_ARTIFACT_TOKEN}`;
  const cold = await request.get(artifactUrl);
  const warm = await request.get(artifactUrl);
  const changed = await request.get('/egaroucid/ai.wasm?artifact=release1-02-token-change');
  expect(cold.headers()['cache-control']).toBe('no-cache');
  expect(warm.headers()['cache-control']).toBe('no-cache');
  expect(changed.headers()['cache-control']).toBe('no-cache');
  expect(cold.headers()['content-type']).toContain('application/wasm');
  expect(sha256(await cold.body())).toBe(sha256(await warm.body()));
  expect(sha256(await cold.body())).toBe(sha256(await changed.body()));

  for (const path of ['/egaroucid/NOTICE.txt', '/egaroucid/artifact-manifest.json']) {
    expect((await request.get(path)).headers()['cache-control']).toBe('no-cache');
  }

  for (const path of ['/assets/v1.0.0/main.js', '/assets/v1.0.0/styles.css', '/assets/v1.1.0/main.js']) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  }
});

test('v1画面を開いたままv2へ原子的切替し、継続着手と新規CPU Worker取得後のreloadを確認する', async ({ page }) => {
  test.setTimeout(45_000);
  await switchTo('v1.1.0-reference');
  const workerResponses = [];
  page.on('response', (response) => {
    if (response.url().includes('/assets/v1.1.0/cpu-worker.js')) workerResponses.push(response);
  });
  await page.goto('/');
  await expect(page.locator('#cpu-engine')).toHaveCount(0);
  await page.locator('input[name="mode"][value="human-human"]').check();
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).click();
  await expect(page.locator('#move-count')).toHaveText('1');

  await switchTo('v2-candidate');
  await page.getByRole('gridcell', { name: 'C3、空き、着手可能' }).click();
  await expect(page.locator('#move-count')).toHaveText('2');
  for (const path of ['/assets/v1.1.0/main.js?switch-proof=1', '/assets/v1.1.0/styles.css?switch-proof=1']) {
    const response = await page.request.get(path, { headers: { 'Cache-Control': 'no-cache' } });
    expect(response.ok()).toBe(true);
    expect(response.headers()['x-release1-selected-release']).toBe('v2-candidate');
  }

  await returnToSetup(page);
  await page.locator('input[name="mode"][value="human-cpu"]').check();
  await page.locator('input[name="humanColor"][value="2"]').check();
  await page.locator('#cpu-level').selectOption('easy');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#move-count')).toHaveText('1', { timeout: 8_000 });
  await expect.poll(() => workerResponses.length).toBeGreaterThan(0);
  expect(workerResponses.at(-1).status()).toBe(200);
  expect(workerResponses.at(-1).headers()['x-release1-selected-release']).toBe('v2-candidate');

  await page.reload();
  await expect(page.locator('#cpu-engine')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'このアプリについて・ライセンス' })).toBeVisible();
});

test('v2からv1へrollbackし、旧v2画面は安全停止、reload後のv1で3モードとCPUを確認する', async ({ page }) => {
  test.setTimeout(60_000);
  const failedRuntime = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && /(?:egaroucid|legacyCpu\.worker)/.test(response.url())) failedRuntime.push({ url: response.url(), status: response.status() });
  });
  await page.goto('/');
  await page.locator('input[name="mode"][value="human-human"]').check();
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).click();
  await switchTo('v1.1.0-reference');
  await page.getByRole('gridcell', { name: 'C3、空き、着手可能' }).click();
  await expect(page.locator('#move-count')).toHaveText('2');

  await returnToSetup(page);
  await page.locator('input[name="mode"][value="human-cpu"]').check();
  await page.locator('input[name="humanColor"][value="2"]').check();
  await page.locator('#cpu-engine').selectOption('egaroucid');
  await page.locator('#cpu-egaroucid-level').selectOption('4');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#status-message')).toHaveAttribute('data-kind', 'error', { timeout: 15_000 });
  await expect(page.locator('#move-count')).toHaveText('0');
  expect(failedRuntime.some(({ url, status }) => url.includes('/egaroucid/egaroucid.worker.js') && status === 404)).toBe(true);

  await page.reload();
  await expect(page.locator('#cpu-engine')).toHaveCount(0);
  await expect(page.locator('input[name="mode"]')).toHaveCount(3);

  await page.locator('input[name="mode"][value="human-human"]').check();
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).click();
  await expect(page.locator('#move-count')).toHaveText('1');
  await returnToSetup(page);

  await page.locator('input[name="mode"][value="human-cpu"]').check();
  await page.locator('#cpu-level').selectOption('easy');
  await page.locator('input[name="humanColor"][value="1"]').check();
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await page.getByRole('gridcell', { name: 'D3、空き、着手可能' }).click();
  await expect(page.locator('#move-count')).toHaveText('2', { timeout: 8_000 });
  await returnToSetup(page);

  await page.locator('input[name="mode"][value="cpu-cpu"]').check();
  await page.locator('select[name="cpuLevelBlack"]').selectOption('easy');
  await page.locator('select[name="cpuLevelWhite"]').selectOption('easy');
  await page.locator('#watch-speed').selectOption('500');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect.poll(async () => Number(await page.locator('#move-count').textContent()), { timeout: 8_000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: '一時停止' }).click();
});
