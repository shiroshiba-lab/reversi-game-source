import { defineConfig } from '@playwright/test';
import productionConfig from './playwright.v2.config.js';

export default defineConfig({
  ...productionConfig,
  use: {
    ...productionConfig.use,
    baseURL: 'http://127.0.0.1:5175',
  },
  webServer: {
    command: 'npm run build --workspace @reversi/shared && npm run dev --workspace @reversi/frontend -- --port 5175',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
