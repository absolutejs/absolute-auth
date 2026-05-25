import { beforeEach, describe, expect, test } from 'bun:test';
import { check, createFgaEngine, listSubjects } from '../src/fga/config';
import { createInMemoryWarrantStore } from '../src/fga/inMemoryStores';
import type { FgaConfig, FgaSchema } from '../src/fga/config';

// owner < editor < viewer (inheritance); a doc also inherits its parent folder's viewers; and
// usersets (group#member) expand.
const schema: FgaSchema = {
	document: {
		editor: {
			kind: 'union',
			rules: [{ kind: 'self' }, { kind: 'computedUserset', relation: 'owner' }]
		},
		owner: { kind: 'self' },
		parent: { kind: 'self' },
		viewer: {
			kind: 'union',
			rules: [
				{ kind: 'self' },
				{ kind: 'computedUserset', relation: 'editor' },
				{ kind: 'tupleToUserset', relation: 'viewer', viaRelation: 'parent' }
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
	let config: FgaConfig = { schema, warrantStore: createInMemoryWarrantStore() };

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
		expect(await engine.check({ ...query, relation: 'viewer' })).toBe(false);
	});
});
