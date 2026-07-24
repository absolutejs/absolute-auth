// eslint.config.mjs
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import pluginJs from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import absolutePlugin from 'eslint-plugin-absolute';
import promisePlugin from 'eslint-plugin-promise';
import securityPlugin from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig([
	{
		ignores: [
			'node_modules/**',
			'dist/**',
			'**/*.min.js',
			'**/*.min.css',
			'**/compiled/**',
			'.cache/**',
			'.claude/**'
		],
		linterOptions: {
			// Inline directives hide repository drift. Structural exceptions belong in
			// the narrow file-class overrides below so every exception is reviewable.
			noInlineConfig: true
		}
	},

	pluginJs.configs.recommended,

	...tseslint.configs.recommended,

	{
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			globals: {
				...globals.node,
				Buffer: 'readonly',
				Bun: 'readonly',
				NodeJS: 'readonly'
			},
			parser: tsParser,
			parserOptions: {
				createDefaultProgram: true,
				project: './tsconfig.eslint.json',
				tsconfigRootDir: __dirname
			}
		},
		plugins: { '@stylistic': stylistic },
		rules: {
			'@stylistic/padding-line-between-statements': [
				'error',
				{ blankLine: 'always', next: 'return', prev: '*' }
			],

			'@typescript-eslint/consistent-type-assertions': [
				'error',
				{ assertionStyle: 'never' }
			],
			'@typescript-eslint/consistent-type-definitions': ['error', 'type'],
			'@typescript-eslint/no-non-null-assertion': 'error',
			'@typescript-eslint/no-unnecessary-type-assertion': 'error'
		}
	},
	{
		files: ['**/*.{js,mjs,cjs,ts,tsx,jsx}'],
		ignores: ['node_modules/**'],
		languageOptions: {
			globals: {
				...globals.browser
			}
		},
		plugins: {
			absolute: absolutePlugin,
			promise: promisePlugin,
			security: securityPlugin
		},
		rules: {
			'absolute/explicit-object-types': 'error',
			'absolute/localize-react-props': 'error',
			'absolute/max-depth-extended': ['error', 1],
			'absolute/max-jsxnesting': ['error', 5],
			'absolute/min-var-length': [
				'error',
				{ allowedVars: ['_', 'id', 'db', 'OK', 'ws'], minLength: 3 }
			],
			'absolute/no-explicit-return-type': 'error',
			'absolute/no-import-meta-path': 'error',
			'absolute/no-useless-function': 'error',
			'absolute/sort-exports': [
				'error',
				{
					caseSensitive: true,
					natural: true,
					order: 'asc',
					variablesBeforeFunctions: true
				}
			],
			'absolute/sort-keys-fixable': [
				'error',
				{
					caseSensitive: true,
					natural: true,
					order: 'asc',
					variablesBeforeFunctions: true
				}
			],
			'arrow-body-style': ['error', 'as-needed'],
			'consistent-return': 'error',
			eqeqeq: 'error',
			'func-style': [
				'error',
				'expression',
				{ allowArrowFunctions: true }
			],
			'no-await-in-loop': 'error',
			'no-debugger': 'error',
			'no-duplicate-case': 'error',
			'no-duplicate-imports': 'error',
			'no-else-return': 'error',
			'no-empty-function': 'error',
			'no-empty-pattern': 'error',
			'no-empty-static-block': 'error',
			'no-fallthrough': 'error',
			'no-floating-decimal': 'error',
			'no-global-assign': 'error',
			'no-implicit-coercion': 'error',
			'no-implicit-globals': 'error',
			'no-loop-func': 'error',
			'no-magic-numbers': [
				'warn',
				{ detectObjects: false, enforceConst: true, ignore: [0, 1, 2] }
			],
			'no-misleading-character-class': 'error',
			'no-nested-ternary': 'error',
			'no-new-native-nonconstructor': 'error',
			'no-new-wrappers': 'error',
			'no-param-reassign': 'error',
			'no-restricted-exports': [
				'error',
				{ restrictDefaultExports: { direct: true } }
			],
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							importNames: ['default'],
							message:
								'Import only named React exports for tree-shaking.',
							name: 'react'
						}
					]
				}
			],
			'no-restricted-syntax': [
				'error',
				{
					message:
						'Do not use IIFEs. Extract to a named function instead.',
					selector:
						'CallExpression[callee.type="ArrowFunctionExpression"]'
				},
				{
					message:
						'Do not use IIFEs. Extract to a named function instead.',
					selector: 'CallExpression[callee.type="FunctionExpression"]'
				}
			],
			'no-return-await': 'error',
			'no-shadow': 'error',
			'no-undef': 'error',
			'no-unneeded-ternary': 'error',
			'no-unreachable': 'error',
			'no-useless-assignment': 'error',
			'no-useless-concat': 'error',
			'no-useless-return': 'error',
			'no-var': 'error',
			'prefer-arrow-callback': 'error',
			'prefer-const': 'error',
			'prefer-destructuring': [
				'error',
				{ array: true, object: true },
				{ enforceForRenamedProperties: false }
			],
			'prefer-template': 'error',
			'promise/always-return': 'warn',
			'promise/avoid-new': 'warn',
			'promise/catch-or-return': 'error',
			'promise/no-callback-in-promise': 'warn',
			'promise/no-nesting': 'warn',
			'promise/no-promise-in-callback': 'warn',
			'promise/no-return-wrap': 'error',
			'promise/param-names': 'error'
		}
	},
	{
		files: ['src/fga/config.ts'],
		rules: {
			// The FGA parser is mutually recursive; TypeScript requires declared
			// return contracts to break the inference cycle.
			'absolute/no-explicit-return-type': 'off'
		}
	},
	{
		files: [
			'src/actions.ts',
			'src/agents/registration.ts',
			'src/audit/integrity.ts',
			'src/credentials/backgroundOps.ts',
			'src/credentials/import.ts',
			'src/cli/import/index.ts',
			'src/oidc/clientAuth.ts',
			'src/organizations/operations.ts',
			'src/vc/sdJwt.ts',
			'src/webhooks/dispatcher.ts',
			'tests/adaptive.test.ts',
			'tests/mfaIntegration.test.ts'
		],
		rules: {
			// These files implement ordered retry, cryptographic-chain, migration,
			// or protocol-state workflows where parallelizing loop iterations would
			// change correctness rather than improve throughput.
			'no-await-in-loop': 'off'
		}
	},
	{
		files: ['src/agents/registration.ts'],
		rules: {
			// The bounded registration state machine validates nested protocol state;
			// flattening it would obscure the compare-and-swap invariants.
			'absolute/max-depth-extended': 'off'
		}
	},
	{
		files: ['tests/**/*.ts'],
		rules: {
			// Test fixtures are intentionally inline and contextually typed, while
			// mock factories must return fresh objects for isolation between cases.
			'absolute/explicit-object-types': 'off',
			'absolute/no-useless-function': 'off'
		}
	},
	{
		files: ['eslint.config.mjs'],
		rules: {
			// Config file: run directly, never bundled — import.meta.url is safe.
			'absolute/no-import-meta-path': 'off',
			'no-restricted-exports': 'off'
		}
	}
]);
