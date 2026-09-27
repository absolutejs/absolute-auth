import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// Scripts and tests run from the repository root (`bun run`, `bun test`).
const REPOSITORY_ROOT = resolve(process.cwd());
const FENCE = /^```(?:ts|tsx)(?<info>[^\n]*)\n(?<code>[\s\S]*?)^```$/gmu;
const ERROR_PREVIEW_LENGTH = 200;
const FILE_ATTRIBUTE = /\bfile=(\S+)/u;
const UNCHECKED = /\bunchecked\b/u;

export type GuideExample = { code: string; file: string; guide: string };

/** Guides whose `ts file=<path>` blocks are compiled (and, in tests, run). */
export const CHECKED_GUIDES = ['docs/PERSISTENT-CREDENTIALS.md'];

/** Package specifiers mapped to source entry points, for running the examples
 * in tests before `dist` exists. The typecheck uses the published `dist` types. */
export const SOURCE_ENTRY_POINTS: Record<string, string> = {
	'@absolutejs/auth': join(REPOSITORY_ROOT, 'src/index.ts'),
	'@absolutejs/auth/bun': join(REPOSITORY_ROOT, 'src/bun.ts'),
	'@absolutejs/auth/server': join(REPOSITORY_ROOT, 'src/server.ts')
};

const rewriteImports = (code: string, imports: Record<string, string>) =>
	code.replace(
		/from '(@absolutejs\/auth(?:\/[a-z-]+)?)'/gu,
		(statement, specifier: string) => {
			const target = imports[specifier];

			return target === undefined ? statement : `from '${target}'`;
		}
	);

/** Every TypeScript block must name its file or say it is unchecked, so a new
 * example cannot silently escape the compiler. */
export const extractGuideExamples = (guide: string, markdown: string) =>
	[...markdown.matchAll(FENCE)].flatMap((match) => {
		const info = match.groups?.['info'] ?? '';
		const code = match.groups?.['code'] ?? '';
		const file = FILE_ATTRIBUTE.exec(info)?.[1];
		if (file) return [{ code, file, guide }];
		if (UNCHECKED.test(info)) return [];
		throw new Error(
			`${guide}: a TypeScript block needs "file=<path>" or "unchecked" in its fence:\n${code.slice(0, ERROR_PREVIEW_LENGTH)}`
		);
	});

export const guideWorkDirectory = (name: string) =>
	join(REPOSITORY_ROOT, '.guide-check', name);

export const readGuideExamples = async () => {
	const perGuide = await Promise.all(
		CHECKED_GUIDES.map(async (guide) =>
			extractGuideExamples(
				guide,
				await readFile(join(REPOSITORY_ROOT, guide), 'utf8')
			)
		)
	);

	return perGuide.flat();
};

export const writeGuideExamples = async (
	directory: string,
	examples: GuideExample[],
	imports: Record<string, string> = {}
) => {
	await Promise.all(
		examples.map(async ({ code, file }) => {
			const target = join(directory, file);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, rewriteImports(code, imports));
		})
	);
};
