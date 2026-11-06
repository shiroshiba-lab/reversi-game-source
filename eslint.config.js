import eslint from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'frontend/dist/**',
      'shared/dist/**',
      'node_modules/**',
      'playwright-report/**',
      'release/**',
      'test-results/**',
    ],
  },
  {
    files: ['frontend/**/*.{ts,tsx}', 'shared/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.strict],
  },
  {
    files: ['frontend/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    ...reactRefresh.configs.vite,
  },
);
