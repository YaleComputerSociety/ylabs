import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/build/**',
      '**/dist/**',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/*.config.mjs',
      '**/*.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  {
    files: ['server/src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        project: './server/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['server/src/models/**/*.ts', 'server/src/db/**/*.ts'],
    // A test is a consumer rather than part of the layer's surface, so a model
    // integration test may import the scraper or script that exercises the schema.
    ignores: ['**/__tests__/**'],
    rules: {
      // `models/` and `db/` are the bottom of the server import order, so a stored
      // vocabulary belongs in `models/storedVocabularies.ts` rather than in the
      // service or scraper that writes it. See skills/architecture/SKILL.md.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/services/**',
                '**/scrapers/**',
                '**/scripts/**',
                '**/routes/**',
                '**/controllers/**',
                '**/middleware/**',
              ],
              message:
                'models/ and db/ may not import a higher layer. Move the shared value set into models/storedVocabularies.ts and re-export it from the layer that interprets it.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['client/src/**/*.ts', 'client/src/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'client/scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Several operator gates detect NUL and C0 control bytes as their whole
      // purpose, so a literal \x00-\x1f class here is the check, not a typo.
      'no-control-regex': 'off',
    },
  },
  {
    files: [
      'scripts/e2e-student-journey-smoke.mjs',
      'scripts/e2e-merge-tombstone-smoke.mjs',
      'scripts/research-detail-professor-audit.mjs',
      'scripts/unified-research-search-audit.mjs',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  prettier,
];
