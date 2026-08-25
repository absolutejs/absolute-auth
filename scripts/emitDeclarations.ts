import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const staging = resolve(root, '.absolutejs/declarations');
const destination = resolve(root, 'dist');

await rm(staging, { force: true, recursive: true });
await mkdir(staging, { recursive: true });

try {
	const process = Bun.spawn(
		[
			'bunx',
			'tsc',
			'--emitDeclarationOnly',
			'--project',
			'tsconfig.json',
			'--outDir',
			staging
		],
		{ cwd: root, stderr: 'inherit', stdout: 'inherit' }
	);
	const exitCode = await process.exited;
	if (exitCode !== 0) {
		throw new Error(`TypeScript declaration build failed (${exitCode}).`);
	}
	await cp(staging, destination, { recursive: true });
} finally {
	await rm(staging, { force: true, recursive: true });
}
