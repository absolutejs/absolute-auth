import {
	asset,
	build,
	getEnv,
	handleReactPageRequest,
	networking
} from '@absolutejs/absolute';
import { staticPlugin } from '@elysiajs/static';
import { neon } from '@neondatabase/serverless';
import { eq, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import { Elysia } from 'elysia';
import { absoluteAuth, createNeonAuthSessionStore } from '../src';
import { schema, type User } from './db/schema';
import {
	deleteDBAuthIdentityMergeRequest,
	getDBUser,
	listDBAuthIdentitiesByUser,
	listDBAuthIdentityMergeRequestsByTarget,
	mergeUserAccounts,
	removeDBAuthIdentity,
	setPrimaryAuthIdentity
} from './handlers/userHandlers';
import { createDrizzleLinkedProviderStores } from './linkedProviders/stores';
import { Connectors } from './pages/Connectors';
import { Home } from './pages/Home';
import { NotAuthorized } from './pages/NotAuthorized';
import { Protected } from './pages/Protected';
import { Settings } from './pages/Settings';
import { absoluteAuthConfig } from './utils/absoluteAuthConfig';

const manifest = await build({
	assetsDirectory: 'example/assets',
	buildDirectory: 'example/build',
	reactDirectory: 'example'
});

const databaseUrl = getEnv('DATABASE_URL');
const sql = neon(databaseUrl);
const authSessionStore = createNeonAuthSessionStore<User>(databaseUrl);
const db = drizzle(sql, {
	schema
});
const { bindingStore, grantStore } = createDrizzleLinkedProviderStores(db);

const buildLinkedProviderPayload = async (ownerRef: string) => {
	const [grants, bindings] = await Promise.all([
		grantStore.listGrantsByOwner(ownerRef),
		bindingStore.listBindingsByOwner(ownerRef)
	]);
	const grantById = new Map(
		grants.map((grant) => [grant.id, grant] as const)
	);

	return {
		ownerRef,
		grants,
		bindings: bindings.map((binding) => ({
			...binding,
			grantStatus: grantById.get(binding.grantId)?.status,
			grantUpdatedAt: grantById.get(binding.grantId)?.updatedAt
		}))
	};
};

const flattenIdentityGroups = <T>(identities: Record<string, T[]>) =>
	Object.values(identities).flat();

const buildAuthIdentityPayload = async (userSub: string) => {
	const [user, identityRows, mergeRequests] = await Promise.all([
		getDBUser({ userSub: userSub, db }),
		listDBAuthIdentitiesByUser({ db, userSub }),
		listDBAuthIdentityMergeRequestsByTarget({ db, targetUserSub: userSub })
	]);

	const primaryIdentityId = user?.primary_auth_identity_id;
	const identities = Object.groupBy(
		identityRows.map((identity) => ({
			...identity,
			isPrimary:
				primaryIdentityId !== null && primaryIdentityId !== undefined
					? identity.id === primaryIdentityId
					: `${identity.auth_provider.toUpperCase()}|${identity.provider_subject}` ===
						userSub
		})),
		(identity) => identity.auth_provider.toLowerCase()
	) as Record<
		string,
		Array<(typeof identityRows)[number] & { isPrimary: boolean }>
	>;

	return {
		identities,
		mergeRequests,
		primaryIdentityId,
		userSub
	};
};

const server = new Elysia()
	.use(
		staticPlugin({
			assets: './example/build',
			prefix: ''
		})
	)
	.use(
		await absoluteAuth<User>({
			...absoluteAuthConfig(db),
			authSessionStore
		})
	)
	.get('/', () => handleReactPageRequest(Home, asset(manifest, 'HomeIndex')))
	.get('/protected', ({ protectRoute }) =>
		protectRoute(
			() =>
				handleReactPageRequest(
					Protected,
					asset(manifest, 'ProtectedIndex')
				),
			() =>
				handleReactPageRequest(
					NotAuthorized,
					asset(manifest, 'NotAuthorizedIndex')
				)
		)
	)
	.get('/settings', ({ protectRoute }) =>
		protectRoute(
			() =>
				handleReactPageRequest(
					Settings,
					asset(manifest, 'SettingsIndex')
				),
			() =>
				handleReactPageRequest(
					NotAuthorized,
					asset(manifest, 'NotAuthorizedIndex')
				)
		)
	)
	.get('/connectors', ({ protectRoute }) =>
		protectRoute(
			() =>
				handleReactPageRequest(
					Connectors,
					asset(manifest, 'ConnectorsIndex')
				),
			() =>
				handleReactPageRequest(
					NotAuthorized,
					asset(manifest, 'NotAuthorizedIndex')
				)
		)
	)
	.get('/linked-providers', ({ protectRoute }) =>
		protectRoute(async (user) => buildLinkedProviderPayload(user.sub))
	)
	.get('/auth-identities', ({ protectRoute }) =>
		protectRoute(async (user) => buildAuthIdentityPayload(user.sub))
	)
	.delete('/account', ({ protectRoute }) =>
		protectRoute(async (user) => {
			const grants = await grantStore.listGrantsByOwner(user.sub);

			for (const grant of grants) {
				if (typeof grantStore.removeGrant === 'function') {
					await grantStore.removeGrant(grant.id);
				}
			}

			await db
				.delete(schema.authIdentityMergeRequests)
				.where(
					or(
						eq(
							schema.authIdentityMergeRequests.target_user_sub,
							user.sub
						),
						eq(
							schema.authIdentityMergeRequests.source_user_sub,
							user.sub
						)
					)
				);

			await db
				.delete(schema.authIdentities)
				.where(eq(schema.authIdentities.user_sub, user.sub));

			await db.delete(schema.users).where(eq(schema.users.sub, user.sub));

			return { ok: true, removedUserSub: user.sub };
		})
	)
	.post('/auth-identities/:id/primary', ({ params, protectRoute, status }) =>
		protectRoute(async (user) => {
			try {
				await setPrimaryAuthIdentity({
					db,
					identityId: params.id,
					userSub: user.sub
				});
			} catch (error) {
				return status(
					'Not Found',
					error instanceof Error
						? error.message
						: 'Auth identity not found'
				);
			}

			return {
				ok: true,
				...(await buildAuthIdentityPayload(user.sub))
			};
		})
	)
	.post(
		'/auth-identity-merge-requests/:id/merge',
		({ params, protectRoute, status }) =>
			protectRoute(async (user) => {
				try {
					await mergeUserAccounts({
						db,
						mergeRequestId: params.id,
						targetUserSub: user.sub
					});
				} catch (error) {
					return status(
						'Bad Request',
						error instanceof Error ? error.message : 'Merge failed'
					);
				}

				return {
					ok: true,
					...(await buildAuthIdentityPayload(user.sub))
				};
			})
	)
	.delete(
		'/auth-identity-merge-requests/:id',
		({ params, protectRoute, status }) =>
			protectRoute(async (user) => {
				const payload = await buildAuthIdentityPayload(user.sub);
				const mergeRequest = payload.mergeRequests.find(
					(candidate) => candidate.id === params.id
				);

				if (!mergeRequest) {
					return status('Not Found', 'Merge request not found');
				}

				await deleteDBAuthIdentityMergeRequest({
					db,
					id: mergeRequest.id
				});

				return {
					ok: true,
					...(await buildAuthIdentityPayload(user.sub))
				};
			})
	)
	.delete('/auth-identities/:id', ({ params, protectRoute, status }) =>
		protectRoute(async (user) => {
			const payload = await buildAuthIdentityPayload(user.sub);
			const allIdentities = flattenIdentityGroups(payload.identities);
			const identity = allIdentities.find(
				(candidate) => candidate.id === params.id
			);

			if (!identity) {
				return status('Not Found', 'Auth identity not found');
			}

			if (allIdentities.length <= 1) {
				return status(
					'Bad Request',
					'Cannot remove the last login identity'
				);
			}

			if (identity.isPrimary === true) {
				return status(
					'Bad Request',
					'Cannot remove the primary login identity yet'
				);
			}

			await removeDBAuthIdentity({ db, id: identity.id });

			return {
				ok: true,
				removed: {
					authProvider: identity.auth_provider,
					id: identity.id,
					providerSubject: identity.provider_subject
				},
				...(await buildAuthIdentityPayload(user.sub))
			};
		})
	)
	.delete(
		'/linked-providers/bindings/:id',
		({ params, protectRoute, status }) =>
			protectRoute(async (user) => {
				const bindings = await bindingStore.listBindingsByOwner(
					user.sub
				);
				const binding = bindings.find(
					(candidate) => candidate.id === params.id
				);

				if (!binding) {
					return status(
						'Not Found',
						`Linked provider binding  not found`
					);
				}

				if (typeof bindingStore.removeBinding !== 'function') {
					return status(
						'Not Implemented',
						'Linked provider binding removal is not supported by this store'
					);
				}

				await bindingStore.removeBinding(binding.id);

				return {
					ok: true,
					removed: {
						bindingId: binding.id,
						connectorProvider: binding.connectorProvider,
						externalAccountId: binding.externalAccountId
					},
					...(await buildLinkedProviderPayload(user.sub))
				};
			})
	)
	.delete(
		'/linked-providers/grants/:id',
		({ params, protectRoute, status }) =>
			protectRoute(async (user) => {
				const grant = await grantStore.getGrant(params.id);

				if (!grant || grant.ownerRef !== user.sub) {
					return status(
						'Not Found',
						`Linked provider grant  not found`
					);
				}

				if (typeof grantStore.removeGrant !== 'function') {
					return status(
						'Not Implemented',
						'Linked provider grant removal is not supported by this store'
					);
				}

				await grantStore.removeGrant(grant.id);

				return {
					ok: true,
					removed: {
						grantId: grant.id,
						authProviderKey: grant.authProviderKey,
						providerSubject: grant.providerSubject
					},
					...(await buildLinkedProviderPayload(user.sub))
				};
			})
	)
	.post('/cleanup', async ({ cleanupSessions }) => {
		await cleanupSessions();
	})
	.use(networking)
	.on('error', (error) => {
		const { request } = error;
		console.error(
			`Server error on ${request.method} ${request.url}: ${error.message}`
		);
	});

export type Server = typeof server;

// TODO : avoid using localhost as per RFC 8252 8.3 https://datatracker.ietf.org/doc/html/rfc8252#section-8.3
