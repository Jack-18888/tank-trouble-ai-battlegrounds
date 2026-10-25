import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/**', '.qa/**', '.sites-runtime/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  { rules: { eqeqeq: ['error', 'always'], 'prefer-const': 'error', 'no-var': 'error' } },
  prettier,
]);
