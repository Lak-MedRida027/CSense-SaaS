import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/.tsbuild/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.claude/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Express identifies error middleware by arity, so unused `_next` params are intentional.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Config files sit outside the TS projects: lint them without type information.
  {
    files: ['**/*.config.{ts,mjs,js}', 'eslint.config.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  },

  // Server: structured logging only.
  {
    files: ['server/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'error' },
  },

  // Server tests: supertest types `res.body` as `any`, so the no-unsafe-* family only produces noise
  // there. Production code under server/src keeps the full strict rule set.
  {
    files: ['server/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Desktop main + preload run in Node/Electron.
  {
    files: ['desktop/src/main/**/*.ts', 'desktop/src/preload/**/*.ts', 'desktop/e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Renderer: React, hooks and accessibility rules.
  {
    files: ['desktop/src/renderer/**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: globals.browser,
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['desktop/src/renderer/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['desktop/src/renderer/**/*.{ts,tsx}'],
    ...jsxA11y.flatConfigs.recommended,
  },

  // The renderer has no network access (CSP `connect-src 'self'`, ADR 0013): the API is reached by the
  // main process only, through the bridge. These bans make a stray fetch a lint error, not a CSP surprise.
  {
    files: ['desktop/src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
          name,
          message: 'The renderer must not use the network: call the preload bridge instead.',
        })),
      ],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].flatMap((object) =>
          ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((property) => ({
            object,
            property,
            message: 'The renderer must not use the network: call the preload bridge instead.',
          })),
        ),
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'The renderer talks to main only via window.csense.' },
          ],
        },
      ],
    },
  },

  // Main-process logic reaches Electron through the ports (ADR 0013 item 9), so controllers stay
  // unit-testable with fakes. Only the glue files below may import `electron`.
  {
    files: ['desktop/src/main/**/*.ts'],
    ignores: [
      'desktop/src/main/electron/ports.ts',
      'desktop/src/main/bootstrap.ts',
      'desktop/src/main/tray.ts',
      'desktop/src/main/security/hardening.ts',
      'desktop/src/main/security/protocol.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message:
                'Import Electron only in the port/glue files; depend on electron/types.ts instead.',
            },
          ],
        },
      ],
    },
  },

  // Design system: UI code takes colour from tokens only (design/tokens -> CSS variables).
  // CSS modules are covered by desktop/src/renderer/src/design/noColourLiterals.test.ts.
  {
    files: ['desktop/src/renderer/src/{components,screens,layouts}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message: 'Use a design token (var(--cs-...)) instead of a hex colour literal.',
        },
        {
          selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]',
          message: 'Use a design token (var(--cs-...)) instead of a hex colour literal.',
        },
        {
          selector: 'Literal[value=/\\b(rgb|hsl)a?\\(/]',
          message: 'Use a design token (var(--cs-...)) instead of an rgb()/hsl() colour literal.',
        },
      ],
    },
  },

  prettier,
);
