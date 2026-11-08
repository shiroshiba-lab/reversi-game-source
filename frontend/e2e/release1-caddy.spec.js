import { test, expect } from '@playwright/test';
import { atomicSwitch } from '../../scripts/release1-static-delivery.mjs';
import { CONTENT_SECURITY_POLICY } from '../../scripts/serve-release1-staging.mjs';

const stagingRoot = process.env.RELEASE1_STAGING_ROOT;
if (!stagingRoot) throw new Error('RELEASE1_STAGING_ROOTが必要です。');

const securityHeaders = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

async function switchTo(target) {
  expect(await atomicSwitch(stagingRoot, target)).toBe(target);
}

function expectSecurityHeaders(response) {
  const headers = response.headers();
  for (const [name, value] of Object.entries(securityHeaders)) expect(headers[name]).toBe(value);
  expect(headers.server).toBeUndefined();
}

test.beforeEach(async () => switchTo('v2-candidate'));
test.afterAll(async () => switchTo('v2-candidate'));

test('Caddy実応答はCSP・cache・WASM MIME・404 security headerを満たす', async ({ request }) => {
  const index = await request.get('/index.html');
  expect(index.status()).toBe(200);
  expect(index.headers()['cache-control']).toBe('no-cache');
  expectSecurityHeaders(index);

  const source = (await index.body()).toString('utf8');
  const js = source.match(/src="([^"]+index-[^"]+\.js)"/)?.[1];
  const css = source.match(/href="([^"]+index-[^"]+\.css)"/)?.[1];
  expect(js).toBeTruthy();
  expect(css).toBeTruthy();
  for (const path of [js, css, '/assets/v1.0.0/main.js', '/assets/v1.1.0/main.js']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expectSecurityHeaders(response);
  }

  for (const path of [
    '/egaroucid/ai.js',
    '/egaroucid/ai.wasm',
    '/egaroucid/egaroucid.worker.js',
    '/egaroucid/NOTICE.txt',
    '/egaroucid/Emscripten-LICENSE.txt',
    '/egaroucid/artifact-manifest.json',
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-cache');
    expectSecurityHeaders(response);
  }
  expect((await request.get('/egaroucid/ai.wasm')).headers()['content-type']).toContain('application/wasm');

  for (const path of ['/not-found-step3', '/.env', '/.git/HEAD']) {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
    expect(response.headers()['cache-control']).toBe('no-store');
    expectSecurityHeaders(response);
  }
});

test('Caddy read-only mountでv1.1.0→v2.0→v1.1.0を原子的に切り替える', async ({ page }) => {
  await switchTo('v1.1.0-reference');
  await page.goto('/');
  await expect(page.locator('#cpu-engine')).toHaveCount(0);
  await expect(page.locator('input[name="mode"]')).toHaveCount(3);

  await switchTo('v2-candidate');
  await page.reload();
  await expect(page.locator('#cpu-engine')).toBeVisible();
  await page.locator('input[name="mode"][value="human-cpu"]').check();
  await page.locator('input[name="humanColor"][value="2"]').check();
  await page.locator('#cpu-engine').selectOption('egaroucid');
  await page.locator('#cpu-egaroucid-level').selectOption('0');
  await page.getByRole('button', { name: /対局をはじめる/ }).click();
  await expect(page.locator('#move-count')).toHaveText('1', { timeout: 20_000 });

  await switchTo('v1.1.0-reference');
  await page.reload();
  await expect(page.locator('#cpu-engine')).toHaveCount(0);
  await expect(page.locator('input[name="mode"]')).toHaveCount(3);
});
