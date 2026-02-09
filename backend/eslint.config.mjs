import { defineConfig, globalIgnores } from 'eslint/config';
import tsParser from '@typescript-eslint/parser';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import js from '@eslint/js';

export default defineConfig([
  globalIgnores([
    'src/__tests__/',
    'src/static/**/*.js',
    // Deprecated flows kept for reference; not maintained to current lint rules.
    'src/lib/flowEngine/builtInFlows/_old/**',
  ]),
  {
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      parserOptions: {},

      globals: { ...globals.node },
    },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.typescript,
    ],
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx'],
      },
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
    plugins: {},
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-useless-escape': 'off',
      'no-self-assign': 'off',
      'no-restricted-syntax': 'off',
      semi: ['error', 'always'],
      'object-curly-spacing': ['error', 'always'],
      'key-spacing': ['error', {
        beforeColon: false,
        afterColon: true,
      }],
      'comma-dangle': ['error', 'always-multiline'],
      'arrow-spacing': ['error', {
        before: true,
        after: true,
      }],
      'space-infix-ops': 'error',
      'space-before-blocks': 'error',
      'keyword-spacing': ['error', {
        before: true,
        after: true,
      }],
      'comma-spacing': ['error', {
        before: false,
        after: true,
      }],
      'semi-spacing': ['error', {
        before: false,
        after: true,
      }],
      'no-trailing-spaces': ['error'],
      'space-in-parens': ['error', 'never'],
      'eol-last': ['error', 'always'],
      'no-multiple-empty-lines': ['error', {
        max: 1,
        maxEOF: 0,
        maxBOF: 0,
      }],
      'padding-line-between-statements': ['error', {
        blankLine: 'always',
        prev: 'import',
        next: '*',
      }, {
          blankLine: 'never',
          prev: 'import',
          next: 'import',
        }],
      'quote-props': ['error', 'as-needed'],
      quotes: ['error', 'single'],
      indent: ['error', 2, {
        SwitchCase: 1,
        ignoredNodes: ['PropertyDefinition'],
      }],
      'prefer-const': 'error',
      'prefer-destructuring': ['error', {
        VariableDeclarator: {
          array: false,
          object: true,
        },

        AssignmentExpression: {
          array: false,
          object: false,
        },
      }, {
          enforceForRenamedProperties: false,
        }],
      'arrow-parens': ['error', 'always'],
      'brace-style': ['error', '1tbs', {
        allowSingleLine: true,
      }],
      'no-else-return': 'error',
      'consistent-return': 'off', // todo: enable and refactor
      'no-console': 'warn',
      'import/order': 'warn',
      'import/no-named-as-default-member': 'off',
      '@typescript-eslint/no-explicit-any': 'off', // todo: enable and refactor
      'spaced-comment': ['error', 'always', {
        line: {
          markers: ['/'],
          exceptions: ['-', '+'],
        },
        block: {
          markers: ['!'],
          exceptions: ['*'],
          balanced: true,
        },
      }],
      'no-multi-spaces': ['error', { exceptions: { Property: false }, ignoreEOLComments: true }],
      'no-useless-concat': 'error',
      'prefer-template': 'error',
      'arrow-body-style': ['error', 'as-needed'],
    },
  },
]);
