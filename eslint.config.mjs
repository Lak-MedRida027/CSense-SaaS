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
