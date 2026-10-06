import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'supabase/.temp/**',
      '.local-pg/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Hard Rule 4: no PHI in logs. Direct console use is banned everywhere;
      // use the ID-only `logger` helpers instead.
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.tsx'],
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18.3' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // All user-facing strings live in src/copy/ (wording test + i18n-ready).
      'react/jsx-no-literals': [
        'error',
        { allowedStrings: ['·', '/', '—', '–', '×', ':', '(', ')', '+', '%', '|', '•'] },
      ],
      'react/jsx-key': 'error',
    },
  },
  {
    // Logger implementations are the only place console may be called.
    files: [
      'apps/web/src/lib/logger.ts',
      'supabase/functions/_shared/logger.ts',
      'scripts/lib/log.mjs',
      'supabase/seed/log.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['supabase/functions/**/*.ts'],
    languageOptions: { globals: { Deno: 'readonly' } },
  },
);
