#!/usr/bin/env bun
// CLI entry for the migration runner. Invocation:
//   bunx absolute-auth migrate --db $DATABASE_URL
//   bunx absolute-auth migrate --db $DATABASE_URL --blocks credentials,mfa,sessions
//   bunx absolute-auth migrate --help
//
// Resolves --db from --db / --database-url flags or the DATABASE_URL env var. --blocks is
// an optional comma-separated list; omit to apply every block the package ships.

import { blockMigrations, type BlockName, runMigrations } from '../migrations';

const USAGE = `Usage:
  bunx absolute-auth migrate --db <url> [--blocks block1,block2,...]

Options:
  --db, --database-url    Postgres connection string (falls back to DATABASE_URL env)
  --blocks                Comma-separated subset of blocks to apply (default: all)
  --help                  Print this message

Available blocks: ${Object.keys(blockMigrations).sort().join(', ')}
`;

type ParsedArgs = {
	blocks: BlockName[] | undefined;
	databaseUrl: string | undefined;
	help: boolean;
};

const consumeFlag = (
	parsed: ParsedArgs,
	flag: string | undefined,
	args: string[]
) => {
	if (flag === '--help' || flag === '-h') {
		parsed.help = true;
	} else if (flag === '--db' || flag === '--database-url') {
		parsed.databaseUrl = args.shift();
	} else if (flag === '--blocks') {
		const list = args.shift() ?? '';
		parsed.blocks = list
			.split(',')
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0)
			// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- validated against blockMigrations keys below
			.map((entry) => entry as BlockName);
	}
};

const parseArgs = (argv: string[]) => {
	const parsed: ParsedArgs = {
		blocks: undefined,
		databaseUrl: undefined,
		help: false
	};
	const args = [...argv];
	while (args.length > 0) {
		consumeFlag(parsed, args.shift(), args);
	}

	return parsed;
};

const die = (message: string) => {
	process.stderr.write(`error: ${message}\n\n`);
	process.stderr.write(USAGE);
	process.exit(1);
};

const main = async () => {
	const positional = process.argv.slice(2);
	if (positional[0] === 'migrate') positional.shift();
	const { blocks, databaseUrl, help } = parseArgs(positional);

	if (help) {
		process.stdout.write(USAGE);

		return;
	}

	const resolved = databaseUrl ?? process.env['DATABASE_URL'];
	if (resolved === undefined || resolved.length === 0) {
		die('a Postgres URL is required (--db or DATABASE_URL)');

		return;
	}

	const unknown = blocks?.filter((block) => !(block in blockMigrations)) ?? [];
	if (unknown.length > 0) {
		die(`unknown block(s): ${unknown.join(', ')}`);

		return;
	}

	const result = await runMigrations({ blocks, databaseUrl: resolved });
	process.stdout.write(
		`\n${result.applied.length} migration(s) applied, ${result.skipped.length} skipped.\n`
	);
};

await main();
