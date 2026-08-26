import { Elysia, t } from 'elysia';
import { getStatusFromSource } from './session/access';
import { sessionStore } from './session/state';
import type { AuthSessionSource } from './session/types';
import { userSessionIdTypebox } from './typebox';
import {
	resolveAccessTokenPrincipal,
	type AccessTokenPrincipalConfig,
	type AuthPrincipal
} from './principal';

export const DEFAULT_NATIVE_PUSH_ROUTE = '/auth/mobile/push' as const;

export type NativePushPlatform = 'apns' | 'fcm';

export type NativePushRegistrationInput = {
	/** Opaque server-issued installation identity, absent on first registration. */
	installationId?: string;
	locale?: string;
	platform: NativePushPlatform;
	tenant: string;
	token: string;
	topics: readonly string[];
	userId: string;
};

export type NativePushRemovalInput = {
	installationId: string;
	tenant: string;
	userId: string;
};

export type NativePushRegistrar = {
	/** Must verify ownership when installationId is present. */
	registerInstallation(
		input: NativePushRegistrationInput
	): Promise<{ installationId: string }>;
	/** Remove every provider token for this authenticated installation identity. */
	removeInstallation(input: NativePushRemovalInput): Promise<void>;
};

export type NativePushConfig<UserType> = {
	registrar: NativePushRegistrar;
	/** Server-owned tenant identity. Clients cannot submit or override it. */
	tenant:
		| string
		| ((principal: AuthPrincipal<UserType>) => Promise<string> | string);
	/** Server-owned topics. Clients cannot subscribe themselves to arbitrary topics. */
	topics?: (
		principal: AuthPrincipal<UserType>
	) => Promise<readonly string[]> | readonly string[];
};

const requireServerText = (value: string, field: string) => {
	const normalized = value.trim();
	if (!normalized)
		throw new TypeError(`Native push ${field} must not be empty.`);

	return normalized;
};

const isInstallationOwnershipError = (error: unknown) =>
	error instanceof Error && error.name === 'PushInstallationOwnershipError';

export const nativePushRoutes = <UserType>({
	accessTokens,
	authSessionStore,
	config
}: {
	accessTokens: AccessTokenPrincipalConfig<UserType>;
	authSessionStore?: AuthSessionSource<UserType>;
	config: NativePushConfig<UserType>;
}) => {
	const resolveTenant = async (principal: AuthPrincipal<UserType>) =>
		requireServerText(
			typeof config.tenant === 'function'
				? await config.tenant(principal)
				: config.tenant,
			'native tenant'
		);
	const resolveTopics = async (principal: AuthPrincipal<UserType>) =>
		[
			...new Set(
				((await config.topics?.(principal)) ?? []).map((topic) =>
					requireServerText(topic, 'topic')
				)
			)
		].sort();

	return new Elysia({ name: '@absolutejs/auth/native-push' })
		.use(sessionStore<UserType>())
		.guard({
			cookie: t.Cookie({ user_session_id: userSessionIdTypebox }),
			schema: 'merge'
		})
		.derive(
			async ({
				store: { session },
				cookie: { user_session_id },
				headers
			}) => {
				const { user } = await getStatusFromSource<UserType>({
					authSessionStore,
					session,
					user_session_id
				});
				const principal = user
					? ({
							kind: 'session',
							subject: accessTokens.oidc.getUserId(user),
							user
						} satisfies AuthPrincipal<UserType>)
					: await resolveAccessTokenPrincipal({
							authorization: headers.authorization,
							config: accessTokens
						});

				return { nativePushPrincipal: principal };
			}
		)
		.post(
			DEFAULT_NATIVE_PUSH_ROUTE,
			{
				body: t.Object({
					installationId: t.Optional(
						t.String({ maxLength: 128, minLength: 1 })
					),
					locale: t.Optional(
						t.String({ maxLength: 64, minLength: 1 })
					),
					platform: t.Union([t.Literal('apns'), t.Literal('fcm')]),
					token: t.String({ maxLength: 8192, minLength: 1 })
				}),
				beforeHandle: ({ nativePushPrincipal, status }) =>
					nativePushPrincipal
						? undefined
						: status('Unauthorized', 'User is not authenticated')
			},
			async ({ body, nativePushPrincipal, status }) => {
				if (!nativePushPrincipal)
					return status('Unauthorized', 'User is not authenticated');
				let registration: { installationId: string };
				try {
					registration = await config.registrar.registerInstallation({
						...(body.installationId
							? { installationId: body.installationId }
							: {}),
						...(body.locale ? { locale: body.locale } : {}),
						platform: body.platform,
						tenant: await resolveTenant(nativePushPrincipal),
						token: body.token,
						topics: await resolveTopics(nativePushPrincipal),
						userId: nativePushPrincipal.subject
					});
				} catch (error) {
					if (isInstallationOwnershipError(error))
						return status('Conflict', {
							code: 'installation-ownership' as const
						});

					throw error;
				}

				return {
					installationId: requireServerText(
						registration.installationId,
						'installation id'
					),
					registered: true as const
				};
			}
		)
		.delete(
			DEFAULT_NATIVE_PUSH_ROUTE,
			{
				body: t.Object({
					installationId: t.String({ maxLength: 128, minLength: 1 })
				}),
				beforeHandle: ({ nativePushPrincipal, status }) =>
					nativePushPrincipal
						? undefined
						: status('Unauthorized', 'User is not authenticated')
			},
			async ({ body, nativePushPrincipal, status }) => {
				if (!nativePushPrincipal)
					return status('Unauthorized', 'User is not authenticated');
				await config.registrar.removeInstallation({
					installationId: body.installationId,
					tenant: await resolveTenant(nativePushPrincipal),
					userId: nativePushPrincipal.subject
				});

				return { removed: true as const };
			}
		);
};
