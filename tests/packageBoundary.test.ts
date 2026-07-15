import { describe, expect, test } from 'bun:test';

const sharedBuildOptions: { external: string[]; target: 'bun' } = {
	external: [
		'@node-saml/node-saml',
		'@opentelemetry/api',
		'@simplewebauthn/server',
		'elysia',
		'react',
		'solid-js',
		'svelte',
		'vue'
	],
	target: 'bun' as const
};

describe('optional dependency package boundaries', () => {
	test('the main entry does not pull in the optional node-saml adapter', async () => {
		const result = await Bun.build({
			...sharedBuildOptions,
			entrypoints: ['src/index.ts']
		});

		expect(result.success).toBe(true);
		expect(result.outputs).toHaveLength(1);
		const [output] = result.outputs;
		if (output === undefined)
			throw new Error('main bundle was not emitted');
		expect(await output.text()).not.toContain('@node-saml/node-saml');
		expect(await output.text()).not.toContain('@simplewebauthn/server');
	});

	test('the saml subpath owns the optional node-saml import', async () => {
		const result = await Bun.build({
			...sharedBuildOptions,
			entrypoints: ['src/saml.ts']
		});

		expect(result.success).toBe(true);
		expect(result.outputs).toHaveLength(1);
		const [output] = result.outputs;
		if (output === undefined)
			throw new Error('saml bundle was not emitted');
		expect(await output.text()).toContain('@node-saml/node-saml');
	});

	test('the webauthn subpath owns the optional SimpleWebAuthn import', async () => {
		const result = await Bun.build({
			...sharedBuildOptions,
			entrypoints: ['src/webauthn.ts']
		});

		expect(result.success).toBe(true);
		expect(result.outputs).toHaveLength(1);
		const [output] = result.outputs;
		if (output === undefined)
			throw new Error('webauthn bundle was not emitted');
		expect(await output.text()).toContain('@simplewebauthn/server');
	});
});
