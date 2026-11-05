// ESLint flat config: recommended JavaScript and TypeScript rules.
// Formatting is left to Prettier (eslint-config-prettier turns off rules that would clash).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/', '**/coverage/', '**/node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'writable',
      },
    },
    rules: {
      // Allow intentionally unused arguments and variables when prefixed with "_".
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // backend/src/types holds shared types only (see AGENTS.md). Anything that exists at runtime
    // (functions, classes, constants, enums, value exports) belongs next to the code that uses it.
    files: ['backend/src/types/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          'FunctionDeclaration',
          'ClassDeclaration',
          'VariableDeclaration',
          'TSEnumDeclaration',
          "ImportDeclaration[importKind='value']",
          "ExportNamedDeclaration[exportKind='value']",
          "ExportAllDeclaration[exportKind='value']",
        ].map((selector) => ({ selector, message: 'backend/src/types may only contain types.' })),
      ],
    },
  },
  {
    // The web page runs in the browser and uses React hooks.
    files: ['frontend/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: { globals: globals.browser },
  },
  {
    // jest.config.js is CommonJS by design.
    files: ['**/*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  prettier,
);
