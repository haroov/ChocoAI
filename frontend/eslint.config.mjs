import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, globalIgnores } from 'eslint/config';
import { fixupConfigRules, fixupPluginRules } from '@eslint/compat';
import react from 'eslint-plugin-react';
import unusedImports from 'eslint-plugin-unused-imports';
import _import from 'eslint-plugin-import';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import jsxA11Y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  globalIgnores([
    '.now/*',
    '**/*.css',
    '**/.changeset',
    '**/dist',
    'esm/*',
    'public/*',
    'tests/*',
    'scripts/*',
    '**/*.config.js',
    '**/.DS_Store',
    '**/node_modules',
    '**/coverage',
    '**/.next',
    '**/build',
    '!**/.commitlintrc.cjs',
    '!**/.lintstagedrc.cjs',
    '!**/jest.config.js',
    '!**/plopfile.js',
    '!**/react-shim.js',
    '!**/tsup.config.ts',
  ]),
  {
    extends: fixupConfigRules(
      compat.extends(
        'plugin:react/recommended',
        'plugin:react-hooks/recommended',
        'plugin:jsx-a11y/recommended',
      ),
    ),

    plugins: {
      react: fixupPluginRules(react),
      'unused-imports': unusedImports,
      import: fixupPluginRules(_import),
      '@typescript-eslint': typescriptEslint,
      'jsx-a11y': fixupPluginRules(jsxA11Y),
    },

    languageOptions: {
      globals: {
        ...Object.fromEntries(
          Object.entries(globals.browser).map(([key]) => [key, 'off']),
        ),
        ...globals.node,
      },

      parser: tsParser,
      ecmaVersion: 12,
      sourceType: 'module',

      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },

    settings: {
      react: {
        version: 'detect',
      },
    },

    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'],

    rules: {
      'react/prop-types': 'off',
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/interactive-supports-focus': 'warn',
      'no-unused-vars': 'off',
      'unused-imports/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'warn',

      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_.*?$',
        },
      ],

      'react/self-closing-comp': 'warn',

      'react/jsx-sort-props': 'off',

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
      'react/jsx-indent': ['error', 2],
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
      'consistent-return': 'warn',
      'no-console': 'warn',
      'import/order': 'warn',
      'import/no-named-as-default-member': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
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
      'react/jsx-curly-brace-presence': ['error', { props: 'never', children: 'ignore' }],
      'react/function-component-definition': [2, {
        namedComponents: 'arrow-function',
        unnamedComponents: 'arrow-function',
      }],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Use apiClientStore.fetch instead of fetch',
        },
      ],
      'no-multi-spaces': ['error', { exceptions: { Property: false }, ignoreEOLComments: true }],
      'react/jsx-max-props-per-line': ['error', { maximum: 1, when: 'multiline' }],
      'react/jsx-first-prop-new-line': ['error', 'multiline-multiprop'],
      'react/jsx-closing-bracket-location': ['error', 'line-aligned'],
      'react/jsx-one-expression-per-line': ['error', { allow: 'single-child' }],
      'max-len': ['error', {
        code: 120,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
        ignoreUrls: true,
      }],
      'react/jsx-tag-spacing': [
        'error',
        {
          closingSlash: 'never',
          beforeSelfClosing: 'always',
          afterOpening: 'never',
          beforeClosing: 'never',
        },
      ],
      'react/jsx-no-useless-fragment': ['error', { allowExpressions: false }],
      'no-useless-concat': 'error',
      'prefer-template': 'error',
      'react/jsx-curly-spacing': ['error', { when: 'never', children: true }],
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'jsx-a11y/no-autofocus': 'off',
      'arrow-body-style': ['error', 'as-needed'],
      'jsx-a11y/no-static-element-interactions': 'off',
    },
  },
]);
