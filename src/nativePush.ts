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
/** Canonical cross-platform push route. */
export const DEFAULT_PUSH_ROUTE = '/auth/push' as const;

export type PushPlatform = 'apns' | 'fcm' | 'webpush';
/** @deprecated Use PushPlatform. */
export type NativePushPlatform = PushPlatform;

export type WebPushRegistration = {
	endpoint: string;
	keys: { auth: string; p256dh: string };
};

type PushRegistrationCredential =
	| { platform: 'apns' | 'fcm'; token: string }
	| { platform: 'webpush'; subscription: WebPushRegistration };

export type PushRegistrationInput = PushRegistrationCredential & {
	/** Opaque server-issued installation identity, absent on first registration. */
	installationId?: string;
	locale?: string;
	tenant: string;
	topics: readonly string[];
	userId: string;
};

/** @deprecated Use PushRegistrationInput. */
export type NativePushRegistrationInput = PushRegistrationInput;

export type PushRemovalInput = {
	installationId: string;
	tenant: string;
	userId: string;
};

/** @deprecated Use PushRemovalInput. */
export type NativePushRemovalInput = PushRemovalInput;

export type PushRegistrar = {
	/** Must verify ownership when installationId is present. */
	registerInstallation(
		input: PushRegistrationInput
	): Promise<{ installationId: string }>;
	/** Remove every provider token for this authenticated installation identity. */
	removeInstallation(input: PushRemovalInput): Promise<void>;
};

/** @deprecated Use PushRegistrar. */
export type NativePushRegistrar = PushRegistrar;

export type PushConfig<UserType> = {
	registrar: PushRegistrar;
	/** Server-owned tenant identity. Clients cannot submit or override it. */
	tenant:
		| string
		| ((principal: AuthPrincipal<UserType>) => Promise<string> | string);
	/** Server-owned topics. Clients cannot subscribe themselves to arbitrary topics. */
	topics?: (
		principal: AuthPrincipal<UserType>
	) => Promise<readonly string[]> | readonly string[];
};

/** @deprecated Use PushConfig. */
export type NativePushConfig<UserType> = PushConfig<UserType>;

const requireServerText = (value: string, field: string) => {
	const normalized = value.trim();
	if (!normalized) throw new TypeError(`Push ${field} must not be empty.`);

	return normalized;
};

const isInstallationOwnershipError = (error: unknown) =>
	error instanceof Error && error.name === 'PushInstallationOwnershipError';

export const pushRoutes = <UserType>({
	accessTokens,
	authSessionStore,
	config
}: {
	accessTokens: AccessTokenPrincipalConfig<UserType>;
	authSessionStore?: AuthSessionSource<UserType>;
	config: PushConfig<UserType>;
}) => {
	const resolveTenant = async (principal: AuthPrincipal<UserType>) =>
		requireServerText(
			typeof config.tenant === 'function'
				? await config.tenant(principal)
				: config.tenant,
			'tenant'
		);
	const resolveTopics = async (principal: AuthPrincipal<UserType>) =>
		[
			...new Set(
				((await config.topics?.(principal)) ?? []).map((topic) =>
					requireServerText(topic, 'topic')
				)
			)
		].sort();

	type RegistrationBody = PushRegistrationCredential & {
		installationId?: string;
		locale?: string;
	};
	const register = async (
		body: RegistrationBody,
		principal: AuthPrincipal<UserType>
	) => {
		try {
			const registration = await config.registrar.registerInstallation({
				...(body.installationId
					? { installationId: body.installationId }
					: {}),
				...(body.locale ? { locale: body.locale } : {}),
				...(body.platform === 'webpush'
					? {
							platform: body.platform,
							subscription: body.subscription
						}
					: { platform: body.platform, token: body.token }),
				tenant: await resolveTenant(principal),
				topics: await resolveTopics(principal),
				userId: principal.subject
			});

			return {
				installationId: requireServerText(
					registration.installationId,
					'installation id'
				),
				registered: true as const
			};
		} catch (error) {
			if (isInstallationOwnershipError(error)) return null;

			throw error;
		}
	};
	const remove = async (
		installationId: string,
		principal: AuthPrincipal<UserType>
	) => {
		try {
			await config.registrar.removeInstallation({
				installationId,
				tenant: await resolveTenant(principal),
				userId: principal.subject
			});
		} catch (error) {
			if (isInstallationOwnershipError(error)) return false;

			throw error;
		}

		return true;
	};
	const installationIdSchema = t.Optional(
		t.String({ maxLength: 128, minLength: 1 })
	);
	const localeSchema = t.Optional(t.String({ maxLength: 64, minLength: 1 }));
	const commonRegistrationFields: {
		installationId: typeof installationIdSchema;
		locale: typeof localeSchema;
	} = {
		installationId: installationIdSchema,
		locale: localeSchema
	};
	const registrationBody = t.Union([
		t.Object({
			...commonRegistrationFields,
			platform: t.Union([t.Literal('apns'), t.Literal('fcm')]),
			token: t.String({ maxLength: 8192, minLength: 1 })
		}),
		t.Object({
			...commonRegistrationFields,
			platform: t.Literal('webpush'),
			subscription: t.Object({
				endpoint: t.String({ maxLength: 8192, minLength: 1 }),
				keys: t.Object({
					auth: t.String({ maxLength: 8192, minLength: 1 }),
					p256dh: t.String({ maxLength: 8192, minLength: 1 })
				})
			})
		})
	]);
	const requirePushPrincipal = ({
		pushPrincipal,
		status
	}: {
		pushPrincipal: AuthPrincipal<UserType> | undefined;
		status: (code: 'Unauthorized', body: string) => unknown;
	}) =>
		pushPrincipal
			? undefined
			: status('Unauthorized', 'User is not authenticated');
	const registrationOptions: {
		beforeHandle: typeof requirePushPrincipal;
		body: typeof registrationBody;
	} = {
		beforeHandle: requirePushPrincipal,
		body: registrationBody
	};
	const removalBody = t.Object({
		installationId: t.String({ maxLength: 128, minLength: 1 })
	});
	const removalOptions: {
		beforeHandle: typeof requirePushPrincipal;
		body: typeof removalBody;
	} = {
		beforeHandle: requirePushPrincipal,
		body: removalBody
	};

	return new Elysia({ name: '@absolutejs/auth/push' })
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

				return { pushPrincipal: principal };
			}
		)
		.post(
			DEFAULT_PUSH_ROUTE,
			registrationOptions,
			async ({ body, pushPrincipal, status }) => {
				if (!pushPrincipal)
					return status('Unauthorized', 'User is not authenticated');
				const result = await register(body, pushPrincipal);

				return (
					result ??
					status('Conflict', {
						code: 'installation-ownership' as const
					})
				);
			}
		)
		.post(
			DEFAULT_NATIVE_PUSH_ROUTE,
			registrationOptions,
			async ({ body, pushPrincipal, status }) => {
				if (!pushPrincipal)
					return status('Unauthorized', 'User is not authenticated');
				const result = await register(body, pushPrincipal);

				return (
					result ??
					status('Conflict', {
						code: 'installation-ownership' as const
					})
				);
			}
		)
		.delete(
			DEFAULT_PUSH_ROUTE,
			removalOptions,
			async ({ body, pushPrincipal, status }) => {
				if (!pushPrincipal)
					return status('Unauthorized', 'User is not authenticated');

				return (await remove(body.installationId, pushPrincipal))
					? { removed: true as const }
					: status('Conflict', {
							code: 'installation-ownership' as const
						});
			}
		)
		.delete(
			DEFAULT_NATIVE_PUSH_ROUTE,
			removalOptions,
			async ({ body, pushPrincipal, status }) => {
				if (!pushPrincipal)
					return status('Unauthorized', 'User is not authenticated');

				return (await remove(body.installationId, pushPrincipal))
					? { removed: true as const }
					: status('Conflict', {
							code: 'installation-ownership' as const
						});
			}
		);
};

/** @deprecated Use pushRoutes. */
export const nativePushRoutes = pushRoutes;
