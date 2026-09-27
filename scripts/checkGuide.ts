/** Typechecks every `ts file=<path>` block in the checked guides against the
 * package's built `dist` types, resolved through its own `exports` map exactly
 * as a consumer's import would be. Run after `bun run build`. */
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
	guideWorkDirectory,
	readGuideExamples,
	writeGuideExamples
} from './guideExamples';

// Run from the repository root through `bun run check:guide`.
const root = resolve(process.cwd());
if (!existsSync(join(root, 'dist/server.d.ts')))
	throw new Error('dist is missing: run `bun run build` before check:guide');

const directory = guideWorkDirectory('typecheck');
await rm(directory, { force: true, recursive: true });
const examples = await readGuideExamples();
await writeGuideExamples(directory, examples);
await writeFile(
	join(directory, 'tsconfig.json'),
	JSON.stringify(
		{
			compilerOptions: {
				jsx: 'react-jsx',
				lib: ['DOM', 'DOM.Iterable', 'ESNext'],
				module: 'ESNext',
				moduleResolution: 'bundler',
				noEmit: true,
				noUncheckedIndexedAccess: true,
				skipLibCheck: true,
				strict: true,
				target: 'ESNext',
				types: ['bun']
			},
			include: ['**/*.ts', '**/*.tsx']
		},
		null,
		'\t'
	)
);

const compiler = Bun.spawnSync(
	[
		join(root, 'node_modules/.bin/tsc'),
		'--project',
		join(directory, 'tsconfig.json')
	],
	{ cwd: root, stderr: 'inherit', stdout: 'inherit' }
);
if (compiler.exitCode !== 0) process.exit(compiler.exitCode);
await rm(directory, { force: true, recursive: true });
console.log(
	`check:guide: ${examples.length} example files compile against dist`
);
