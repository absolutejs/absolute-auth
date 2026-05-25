import { describe, expect, test } from 'bun:test';
import { hasOrganizationScope } from '../src/tenancy';

describe('hasOrganizationScope', () => {
	test('narrows resources that carry a non-empty organizationId', () => {
		expect(hasOrganizationScope({ organizationId: 'org_123' })).toBe(true);
	});

	test('rejects missing or empty organization ids', () => {
		expect(hasOrganizationScope({})).toBe(false);
		expect(hasOrganizationScope({ organizationId: '' })).toBe(false);
	});
});
