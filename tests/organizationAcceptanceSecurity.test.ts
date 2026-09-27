import { expect, test } from 'bun:test';
import { createInMemoryOrganizationStore } from '../src/organizations/inMemoryOrganizationStore';
import {
	createOrganization,
	inviteToOrganization,
	acceptInvitation
} from '../src/organizations/operations';
const fixture = async () => {
	const organizationStore = createInMemoryOrganizationStore();
	const org = await createOrganization({
		name: 'Private',
		organizationStore,
		ownerUserId: 'owner'
	});
	const invite = await inviteToOrganization({
		email: 'member@example.com',
		organizationId: org.organizationId,
		organizationStore,
		roles: ['member']
	});

	return { org, organizationStore, ...invite };
};
test('wrong or missing verified email cannot consume an invitation', async () => {
	const context = await fixture();
	expect(
		await acceptInvitation({ ...context, userId: 'attacker' })
	).toBeUndefined();
	expect(
		await acceptInvitation({
			...context,
			userId: 'attacker',
			verifiedEmail: 'attacker@example.com'
		})
	).toBeUndefined();
	expect(
		(
			await context.organizationStore.getInvitation(
				context.invitation.invitationId
			)
		)?.state
	).toBe('pending');
	expect(
		await context.organizationStore.getMembership(
			context.org.organizationId,
			'attacker'
		)
	).toBeUndefined();
	expect(
		await acceptInvitation({
			...context,
			userId: 'member',
			verifiedEmail: ' MEMBER@example.com '
		})
	).toBeDefined();
});
test('concurrent acceptance grants exactly one membership', async () => {
	const context = await fixture();
	const results = await Promise.all(
		Array.from({ length: 12 }, (_, index) =>
			acceptInvitation({
				...context,
				userId: `user-${index}`,
				verifiedEmail: 'member@example.com'
			})
		)
	);
	expect(results.filter(Boolean)).toHaveLength(1);
	expect(
		await context.organizationStore.listMembershipsByOrganization(
			context.org.organizationId
		)
	).toHaveLength(2);
});
test.each(['expired', 'revoked', 'deleted'])(
	'%s invitations fail closed',
	async (kind) => {
		const context = await fixture();
		if (kind === 'deleted')
			await context.organizationStore.deleteOrganization(
				context.org.organizationId
			);
		else if (kind === 'expired')
			await context.organizationStore.saveInvitation({
				...context.invitation,
				expiresAt: Date.now()
			});
		else
			await context.organizationStore.saveInvitation({
				...context.invitation,
				state: 'revoked'
			});
		expect(
			await acceptInvitation({
				...context,
				userId: 'member',
				verifiedEmail: 'member@example.com'
			})
		).toBeUndefined();
	}
);
test('invites cannot reactivate a suspended member or overwrite existing roles', async () => {
	const context = await fixture();
	const original = {
		createdAt: 1,
		organizationId: context.org.organizationId,
		roles: ['reader'],
		status: 'suspended' as const,
		updatedAt: 1,
		userId: 'member'
	};
	await context.organizationStore.saveMembership(original);
	expect(
		await acceptInvitation({
			...context,
			userId: 'member',
			verifiedEmail: 'member@example.com'
		})
	).toBeUndefined();
	await context.organizationStore.saveMembership({
		...original,
		status: 'active'
	});
	expect(
		(
			await acceptInvitation({
				...context,
				userId: 'member',
				verifiedEmail: 'member@example.com'
			})
		)?.roles
	).toEqual(['reader']);
});
test('legacy non-atomic custom stores fail closed', async () => {
	const context = await fixture();
	context.organizationStore.acceptInvitation = undefined;
	expect(
		await acceptInvitation({
			...context,
			userId: 'member',
			verifiedEmail: 'member@example.com'
		})
	).toBeUndefined();
});
