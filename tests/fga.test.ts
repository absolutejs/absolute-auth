import { beforeEach, describe, expect, test } from 'bun:test';
import {
	check,
	createFgaEngine,
	listObjects,
	listSubjects
} from '../src/fga/config';
import { createInMemoryWarrantStore } from '../src/fga/inMemoryStores';
import { parseSchema } from '../src/fga/schema';
import type { FgaConfig, FgaSchema } from '../src/fga/config';

// owner < editor < viewer (inheritance); a doc also inherits its parent folder's viewers; and
// usersets (group#member) expand.
const schema: FgaSchema = {
	document: {
		editor: {
			kind: 'union',
			rules: [
				{ kind: 'self' },
				{ kind: 'computedUserset', relation: 'owner' }
			]
		},
		owner: { kind: 'self' },
		parent: { kind: 'self' },
		viewer: {
			kind: 'union',
			rules: [
				{ kind: 'self' },
				{ kind: 'computedUserset', relation: 'editor' },
				{
					kind: 'tupleToUserset',
					relation: 'viewer',
					viaRelation: 'parent'
				}
			]
		}
	},
	folder: { viewer: { kind: 'self' } },
	group: { member: { kind: 'self' } }
};

const user = (subjectId: string) => ({
	subjectId,
	subjectType: 'user'
});

describe('fine-grained authorization', () => {
	let config: FgaConfig = {
		schema,
		warrantStore: createInMemoryWarrantStore()
	};

	beforeEach(async () => {
		config = { schema, warrantStore: createInMemoryWarrantStore() };
		const { warrantStore } = config;
		await warrantStore.saveWarrant({
			relation: 'owner',
			resourceId: 'doc1',
			resourceType: 'document',
			...user('alice')
		});
		await warrantStore.saveWarrant({
			relation: 'viewer',
			resourceId: 'folder1',
			resourceType: 'folder',
			...user('bob')
		});
		await warrantStore.saveWarrant({
			relation: 'parent',
			resourceId: 'doc1',
			resourceType: 'document',
			subjectId: 'folder1',
			subjectType: 'folder'
		});
		await warrantStore.saveWarrant({
			relation: 'viewer',
			resourceId: 'doc1',
			resourceType: 'document',
			subjectId: 'eng',
			subjectRelation: 'member',
			subjectType: 'group'
		});
		await warrantStore.saveWarrant({
			relation: 'member',
			resourceId: 'eng',
			resourceType: 'group',
			...user('carol')
		});
	});

	const can = (relation: string, subjectId: string) =>
		check(config, {
			relation,
			resourceId: 'doc1',
			resourceType: 'document',
			subjectId,
			subjectType: 'user'
		});

	test('direct + computed-userset inheritance (owner -> editor -> viewer)', async () => {
		expect(await can('owner', 'alice')).toBe(true);
		expect(await can('editor', 'alice')).toBe(true);
		expect(await can('viewer', 'alice')).toBe(true);
	});

	test('tuple-to-userset inheritance (doc viewer via parent folder)', async () => {
		expect(await can('viewer', 'bob')).toBe(true);
		expect(await can('owner', 'bob')).toBe(false);
		expect(await can('editor', 'bob')).toBe(false);
	});

	test('userset expansion (group#member)', async () => {
		expect(await can('viewer', 'carol')).toBe(true);
		expect(await can('viewer', 'dave')).toBe(false);
	});

	test('listSubjects expands every path', async () => {
		const subjects = await listSubjects(config, {
			relation: 'viewer',
			resourceId: 'doc1',
			resourceType: 'document'
		});
		const ids = subjects.map((subject) => subject.subjectId).sort();
		expect(ids).toEqual(['alice', 'bob', 'carol']);
	});

	test('listObjects returns every resource the subject can reach', async () => {
		await config.warrantStore.saveWarrant({
			relation: 'owner',
			resourceId: 'doc2',
			resourceType: 'document',
			...user('alice')
		});

		const reach = (subjectId: string) =>
			listObjects(config, {
				relation: 'viewer',
				resourceType: 'document',
				subjectId,
				subjectType: 'user'
			});

		expect((await reach('alice')).sort()).toEqual(['doc1', 'doc2']);
		expect(await reach('bob')).toEqual(['doc1']); // only via parent folder
		expect(await reach('carol')).toEqual(['doc1']); // only via group#member
		expect(await reach('dave')).toEqual([]);
	});

	test('createFgaEngine binds config; revocation removes access', async () => {
		const engine = createFgaEngine(config);
		const query = {
			relation: 'owner',
			resourceId: 'doc1',
			resourceType: 'document',
			subjectId: 'alice',
			subjectType: 'user'
		};
		expect(await engine.check(query)).toBe(true);
		await engine.deleteWarrant({
			relation: 'owner',
			resourceId: 'doc1',
			resourceType: 'document',
			...user('alice')
		});
		expect(await engine.check(query)).toBe(false);
		// alice loses viewer too (it inherited from owner)
		expect(await engine.check({ ...query, relation: 'viewer' })).toBe(
			false
		);
	});
});

describe('fga schema parser', () => {
	const dsl = `
# sample schema
type user

type folder
  relations
    define viewer: [user]

type document
  relations
    define owner: [user]
    define editor: [user] or owner
    define parent: [folder]
    define viewer: [user] or editor or viewer from parent
`;

	test('parseSchema turns the DSL into an FgaSchema', () => {
		const parsed = parseSchema(dsl);

		expect(parsed.document?.owner).toEqual({ kind: 'self' });
		expect(parsed.document?.editor).toEqual({
			kind: 'union',
			rules: [
				{ kind: 'self' },
				{ kind: 'computedUserset', relation: 'owner' }
			]
		});
		expect(parsed.document?.viewer).toEqual({
			kind: 'union',
			rules: [
				{ kind: 'self' },
				{ kind: 'computedUserset', relation: 'editor' },
				{
					kind: 'tupleToUserset',
					relation: 'viewer',
					viaRelation: 'parent'
				}
			]
		});
		expect(parsed.folder?.viewer).toEqual({ kind: 'self' });
	});

	test('a parsed schema drives check end-to-end', async () => {
		const warrantStore = createInMemoryWarrantStore();
		const config: FgaConfig = { schema: parseSchema(dsl), warrantStore };
		await warrantStore.saveWarrant({
			relation: 'owner',
			resourceId: 'doc1',
			resourceType: 'document',
			subjectId: 'alice',
			subjectType: 'user'
		});

		// owner -> editor -> viewer, all from the parsed rules
		expect(
			await check(config, {
				relation: 'viewer',
				resourceId: 'doc1',
				resourceType: 'document',
				subjectId: 'alice',
				subjectType: 'user'
			})
		).toBe(true);
	});
});
