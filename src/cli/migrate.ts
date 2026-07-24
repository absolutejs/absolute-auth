#!/usr/bin/env bun
// CLI dispatcher. The bin entry `absolute-auth` lands here; the first
// positional decides which subcommand we run.
//
//   bunx absolute-auth migrate --db <url> [--blocks block1,block2,...]
//   bunx absolute-auth import <source> <file> --db <url> [--commit]
//
// Subcommands:
//   migrate  apply the package's Drizzle migrations
//   import   read a user export from another auth library, insert into our schema
//   help     print this message

import { importers, runImport } from './import';
import { blockMigrations, type BlockName, runMigrations } from '../migrations';

const TOP_USAGE = `Usage:
  bunx absolute-auth <command> [options]

Commands:
  migrate                Apply the package's Drizzle migrations
  import <source> <file> Import a user export from another auth library
                         <source> is one of: ${Object.keys(importers).sort().join(', ')}
  help                   Print this message

Run 'bunx absolute-auth <command> --help' for command-specific options.
`;

const MIGRATE_USAGE = `Usage:
  bunx absolute-auth migrate --db <url> [--blocks block1,block2,...]

Options:
  --db, --database-url    Postgres connection string (falls back to DATABASE_URL env)
  --blocks                Comma-separated subset of blocks to apply (default: all)
  --help                  Print this message

Available blocks: ${Object.keys(blockMigrations).sort().join(', ')}
`;

const IMPORT_USAGE = `Usage:
  bunx absolute-auth import <source> <file> --db <url> [--commit]

Arguments:
  source    one of: ${Object.keys(importers).sort().join(', ')}
  file      path to the export JSON (see docs/MIGRATE-FROM-*.md per source)

Options:
  --db, --database-url    Postgres connection string (falls back to DATABASE_URL env)
  --commit                Without this, the run is a dry-run (counts only, no inserts)
  --help                  Print this message
`;

type MigrateArgs = {
	blocks: string[] | undefined;
	databaseUrl: string | undefined;
	help: boolean;
};

const isBlockName = (value: string): value is BlockName =>
	Object.hasOwn(blockMigrations, value);

const applyMigrateFlag = (
	parsed: MigrateArgs,
	args: string[],
	flag: string | undefined
) => {
	if (flag === '--help' || flag === '-h') {
		parsed.help = true;

		return;
	}
	if (flag === '--db' || flag === '--database-url') {
		parsed.databaseUrl = args.shift();

		return;
	}
	if (flag !== '--blocks') return;
	const list = args.shift() ?? '';
	parsed.blocks = list
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
};

const parseMigrateArgs = (argv: string[]) => {
	const parsed: MigrateArgs = {
		blocks: undefined,
		databaseUrl: undefined,
		help: false
	};
	const args = [...argv];
	while (args.length > 0) {
		applyMigrateFlag(parsed, args, args.shift());
	}

	return parsed;
};

type ImportArgs = {
	commit: boolean;
	databaseUrl: string | undefined;
	file: string | undefined;
	help: boolean;
	source: string | undefined;
};

const applyImportArgument = (
	parsed: ImportArgs,
	args: string[],
	positionals: string[],
	next: string | undefined
) => {
	if (next === undefined) return;
	if (next === '--help' || next === '-h') {
		parsed.help = true;

		return;
	}
	if (next === '--db' || next === '--database-url') {
		parsed.databaseUrl = args.shift();

		return;
	}
	if (next === '--commit') {
		parsed.commit = true;

		return;
	}
	if (!next.startsWith('--')) positionals.push(next);
};

const parseImportArgs = (argv: string[]) => {
	const parsed: ImportArgs = {
		commit: false,
		databaseUrl: undefined,
		file: undefined,
		help: false,
		source: undefined
	};
	const args = [...argv];
	const positionals: string[] = [];
	while (args.length > 0) {
		applyImportArgument(parsed, args, positionals, args.shift());
	}
	const [source, file] = positionals;
	parsed.source = source;
	parsed.file = file;

	return parsed;
};

const die = (message: string, usage: string) => {
	process.stderr.write(`error: ${message}\n\n`);
	process.stderr.write(usage);
	process.exit(1);
};

const runMigrate = async (argv: string[]) => {
	const { blocks, databaseUrl, help } = parseMigrateArgs(argv);
	if (help) {
		process.stdout.write(MIGRATE_USAGE);

		return;
	}
	const resolved = databaseUrl ?? process.env['DATABASE_URL'];
	if (resolved === undefined || resolved.length === 0) {
		die('a Postgres URL is required (--db or DATABASE_URL)', MIGRATE_USAGE);

		return;
	}
	const unknown =
		blocks?.filter((block) => !(block in blockMigrations)) ?? [];
	if (unknown.length > 0) {
		die(`unknown block(s): ${unknown.join(', ')}`, MIGRATE_USAGE);

		return;
	}
	const selectedBlocks = blocks?.filter(isBlockName);
	const result = await runMigrations({
		blocks: selectedBlocks,
		databaseUrl: resolved
	});
	process.stdout.write(
		`\n${result.applied.length} migration(s) applied, ${result.skipped.length} skipped.\n`
	);
};

const runImportCommand = async (argv: string[]) => {
	const { commit, databaseUrl, file, help, source } = parseImportArgs(argv);
	if (help) {
		process.stdout.write(IMPORT_USAGE);

		return;
	}
	if (source === undefined) {
		die('source is required', IMPORT_USAGE);

		return;
	}
	const importer = importers[source];
	if (importer === undefined) {
		die(`unknown source "${source}"`, IMPORT_USAGE);

		return;
	}
	if (file === undefined) {
		die('file path is required', IMPORT_USAGE);

		return;
	}
	const resolved = databaseUrl ?? process.env['DATABASE_URL'];
	if (resolved === undefined || resolved.length === 0) {
		die('a Postgres URL is required (--db or DATABASE_URL)', IMPORT_USAGE);

		return;
	}

	process.stdout.write(`[${source}] parsing ${file}…\n`);
	const result = await importer.parse(file);
	process.stdout.write(
		`[${source}] parsed ${result.users.length} user(s), ${result.identities.length} identity row(s).\n`
	);
	const counts = await runImport(result, { commit, databaseUrl: resolved });
	if (commit) {
		process.stdout.write(
			`[${source}] inserted ${counts.userCount} user(s), ${counts.identityCount} new identity row(s). ✓\n`
		);
	} else {
		process.stdout.write(
			`[${source}] dry-run — pass --commit to insert.\n`
		);
	}
};

const main = async () => {
	const argv = process.argv.slice(2);
	const command = argv.shift();
	if (command === undefined || command === 'help' || command === '--help') {
		process.stdout.write(TOP_USAGE);

		return;
	}
	if (command === 'migrate') {
		await runMigrate(argv);

		return;
	}
	if (command === 'import') {
		await runImportCommand(argv);

		return;
	}
	die(`unknown command "${command}"`, TOP_USAGE);
};

await main();
