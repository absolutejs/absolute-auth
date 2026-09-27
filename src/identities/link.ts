import { AuthIdentityConflictError } from '../errors';
import type { AuditEmitter } from '../audit/config';
import type { CallbackContext, JsonObject } from '../types';
import { resolveOAuthAuthorization } from '../utils';
import type { AuthIdentityStore } from './types';

const pickString = (identity: JsonObject, keys: string[]) => {
	for (const key of keys) {
		const value = identity[key];
		if (typeof value === 'string' && value.length > 0) return value;
	}

	return undefined;
};

// The body of an `onLinkIdentity` handler: attaches the provider account from this
// callback to the signed-in user. Throws `AuthIdentityConflictError` when the account
// already belongs to someone else, which the callback hands to `onLinkIdentityConflict`.
export const linkCallbackIdentity = async <UserType>({
	context,
	emit,
	getUserId,
	identityStore
}: {
	context: CallbackContext<UserType>;
	emit?: AuditEmitter;
	getUserId: (user: UserType) => string;
	identityStore: AuthIdentityStore;
}) => {
	if (!context.currentUser)
		throw new Error('Sign in before linking another sign-in method');
	const userId = getUserId(context.currentUser);
	const resolved = await resolveCallbackIdentity(context);
	try {
		const result = await identityStore.linkIdentity({
			metadata: resolved.metadata,
			provider: resolved.provider,
			providerSubject: resolved.providerSubject,
			userId
		});
		if (result.status === 'linked')
			await emit?.({
				at: Date.now(),
				metadata: { provider: resolved.provider },
				type: 'identity_linked',
				userId
			});

		return result;
	} catch (error) {
		if (error instanceof AuthIdentityConflictError)
			await emit?.({
				at: Date.now(),
				metadata: { provider: resolved.provider },
				type: 'identity_conflict',
				userId
			});
		throw error;
	}
};
// Reads the provider account behind an OAuth callback: its subject plus display details.
// The subject is the only thing used for matching; email and name are for showing.
export const resolveCallbackIdentity = async (
	context: Parameters<typeof resolveOAuthAuthorization>[0]
) => {
	const authorization = await resolveOAuthAuthorization({
		authProvider: context.authProvider,
		providerConfiguration: context.providerConfiguration,
		providerInstance: context.providerInstance,
		tokenResponse: context.tokenResponse
	});
	const identity = authorization.userIdentity;
	const subject =
		authorization.oauthSubject ??
		pickString(identity, ['sub', 'id', 'oid']);
	if (subject === undefined || subject === '')
		throw new Error(
			`${context.authProvider} returned no subject for this account`
		);
	const metadata: JsonObject = {};
	const email = pickString(identity, ['email', 'preferred_username', 'upn']);
	const name = pickString(identity, ['name', 'given_name']);
	if (email) metadata.email = email;
	if (name) metadata.name = name;

	return {
		authorization,
		metadata,
		provider: context.authProvider,
		providerSubject: String(subject)
	};
};
