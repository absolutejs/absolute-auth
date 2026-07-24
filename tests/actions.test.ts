import { describe, expect, test } from 'bun:test';
import { createActionPipeline, type AuthAction } from '../src/actions';

type TestUser = { email: string; sub: string };

const order: string[] = [];

const tag = (
	name: string,
	result: 'pass' | 'deny' | 'redirect'
): AuthAction<TestUser> => ({
	event: 'postLogin',
	name,
	handler: () => {
		order.push(name);
		if (result === 'pass') return { kind: 'pass' };
		if (result === 'deny') return { kind: 'deny', reason: name };

		return { kind: 'redirect', url: `/x/${name}` };
	}
});

describe('action pipeline', () => {
	test('runs matching actions in order and passes if all pass', async () => {
		order.length = 0;
		const pipeline = createActionPipeline<TestUser>([
			tag('one', 'pass'),
			tag('two', 'pass'),
			tag('three', 'pass')
		]);

		const result = await pipeline.run('postLogin', {});
		expect(result).toEqual({ kind: 'pass' });
		expect(order).toEqual(['one', 'two', 'three']);
	});

	test('a deny short-circuits the chain', async () => {
		order.length = 0;
		const pipeline = createActionPipeline<TestUser>([
			tag('one', 'pass'),
			tag('two', 'deny'),
			tag('three', 'pass')
		]);

		const result = await pipeline.run('postLogin', {});
		expect(result).toEqual({ kind: 'deny', reason: 'two' });
		expect(order).toEqual(['one', 'two']); // 'three' never runs
	});

	test('a redirect short-circuits the chain', async () => {
		order.length = 0;
		const pipeline = createActionPipeline<TestUser>([
			tag('one', 'redirect')
		]);

		const result = await pipeline.run('postLogin', {});
		expect(result).toEqual({ kind: 'redirect', url: '/x/one' });
	});

	test('actions only run for their event (single or list)', async () => {
		order.length = 0;
		const both: AuthAction<TestUser> = {
			event: ['postLogin', 'postRegister'],
			name: 'both',
			handler: () => {
				order.push('both');

				return { kind: 'pass' };
			}
		};
		const onlyMfa: AuthAction<TestUser> = {
			event: 'postMfa',
			name: 'onlyMfa',
			handler: () => {
				order.push('mfa');

				return { kind: 'pass' };
			}
		};

		const pipeline = createActionPipeline<TestUser>([both, onlyMfa]);

		await pipeline.run('postLogin', {});
		await pipeline.run('postRegister', {});
		await pipeline.run('postMfa', {});

		expect(order).toEqual(['both', 'both', 'mfa']);
	});
});
