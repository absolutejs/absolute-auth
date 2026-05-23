import type {
	LinkedProviderAccessTokenLease,
	LinkedProviderBinding,
	LinkedProviderBindingStore,
	LinkedProviderCredentialFailureReport,
	LinkedProviderCredentialResolver,
	LinkedProviderGrant,
	LinkedProviderGrantStore,
	ResolveLinkedProviderCredentialInput,
	ResolvedLinkedProviderCredential
} from '@absolutejs/linked-providers';

export type LinkedProviderRefreshResult = {
	grant: LinkedProviderGrant;
	lease: LinkedProviderAccessTokenLease;
};

export type CreateLinkedProviderCredentialResolverOptions = {
	grantStore: LinkedProviderGrantStore;
	bindingStore: LinkedProviderBindingStore;
	loadAccessTokenLease: (
		grant: LinkedProviderGrant
	) =>
		| Promise<LinkedProviderAccessTokenLease | null>
		| LinkedProviderAccessTokenLease
		| null;
	refreshAccessTokenLease?: (
		grant: LinkedProviderGrant,
		input?: {
			minValidityMs?: number;
			requiredScopes?: string[];
		}
	) =>
		| Promise<LinkedProviderRefreshResult | null>
		| LinkedProviderRefreshResult
		| null;
	now?: () => number;
	onReportFailure?: (input: {
		credential: ResolvedLinkedProviderCredential;
		report: LinkedProviderCredentialFailureReport;
		grant?: LinkedProviderGrant;
		binding?: LinkedProviderBinding;
	}) => Promise<void> | void;
};

const uniqueStrings = (values: string[]) => [...new Set(values)];

const getEffectiveScopes = (
	grant: LinkedProviderGrant,
	binding: LinkedProviderBinding
) => {
	if (binding.availableScopes.length === 0) {
		return uniqueStrings(grant.grantedScopes);
	}

	const bindingScopeSet = new Set(binding.availableScopes);
	return uniqueStrings(
		grant.grantedScopes.filter((scope) => bindingScopeSet.has(scope))
	);
};

const hasRequiredScopes = (
	availableScopes: string[],
	requiredScopes?: string[]
) => (requiredScopes ?? []).every((scope) => availableScopes.includes(scope));

const isGrantUsable = (grant: LinkedProviderGrant) =>
	grant.status === 'active' || grant.status === 'refresh_required';

const isBindingUsable = (binding: LinkedProviderBinding) =>
	binding.status === 'active';

const needsRefresh = (
	lease: LinkedProviderAccessTokenLease | null,
	now: number,
	minValidityMs?: number
) => {
	if (!lease) return true;
	if (lease.expiresAt === undefined) return false;
	return lease.expiresAt <= now + (minValidityMs ?? 0);
};

const ensureLeaseScopes = (
	lease: LinkedProviderAccessTokenLease,
	requiredScopes?: string[]
) => {
	if (!hasRequiredScopes(lease.grantedScopes, requiredScopes)) {
		throw new Error(
			'Linked provider access token lease is missing required scopes'
		);
	}
};

const ensureLeaseValidity = (
	lease: LinkedProviderAccessTokenLease,
	now: number,
	minValidityMs?: number
) => {
	if (lease.expiresAt === undefined) return;
	if (lease.expiresAt <= now + (minValidityMs ?? 0)) {
		throw new Error(
			'Linked provider access token lease does not satisfy minimum validity'
		);
	}
};

const buildResolvedCredential = (
	grant: LinkedProviderGrant,
	binding: LinkedProviderBinding
): ResolvedLinkedProviderCredential => ({
	bindingId: binding.id,
	grantId: grant.id,
	ownerRef: grant.ownerRef,
	connectorProvider: binding.connectorProvider,
	providerFamily: grant.providerFamily,
	authProviderKey: grant.authProviderKey,
	externalAccountId: binding.externalAccountId,
	externalAccountType: binding.externalAccountType,
	scopes: getEffectiveScopes(grant, binding),
	capabilities: binding.capabilities ? [...binding.capabilities] : undefined,
	label: binding.label,
	username: binding.username,
	email: binding.email,
	metadata: {
		...(grant.metadata ?? {}),
		...(binding.metadata ?? {})
	}
});

const annotateFailureMetadata = (
	metadata: Record<string, unknown> | undefined,
	report: LinkedProviderCredentialFailureReport,
	now: number
) => ({
	...(metadata ?? {}),
	lastCredentialFailureAt: now,
	lastCredentialFailureCode: report.code,
	lastCredentialFailureMessage: report.message,
	lastCredentialFailureRetryAt: report.retryAt
});

const sortNewestFirst = <T extends { updatedAt: number }>(items: T[]) =>
	[...items].sort((left, right) => right.updatedAt - left.updatedAt);

export const createLinkedProviderCredentialResolver = ({
	grantStore,
	bindingStore,
	loadAccessTokenLease,
	refreshAccessTokenLease,
	now = () => Date.now(),
	onReportFailure
}: CreateLinkedProviderCredentialResolverOptions): LinkedProviderCredentialResolver => ({
	listBindings: async ({ ownerRef, connectorProvider, status }) =>
		sortNewestFirst(
			await bindingStore.listBindingsByOwner(ownerRef)
		).filter(
			(binding) =>
				(connectorProvider === undefined ||
					binding.connectorProvider === connectorProvider) &&
				(status === undefined || binding.status === status)
		),
	resolveCredential: async (input: ResolveLinkedProviderCredentialInput) => {
		const bindings = sortNewestFirst(
			await bindingStore.listBindingsByOwner(input.ownerRef)
		).filter(
			(binding) =>
				binding.connectorProvider === input.connectorProvider &&
				isBindingUsable(binding) &&
				(input.bindingId === undefined ||
					binding.id === input.bindingId) &&
				(input.externalAccountId === undefined ||
					binding.externalAccountId === input.externalAccountId)
		);

		for (const binding of bindings) {
			const grant = await grantStore.getGrant(binding.grantId);
			if (
				!grant ||
				grant.ownerRef !== input.ownerRef ||
				!isGrantUsable(grant)
			) {
				continue;
			}

			const effectiveScopes = getEffectiveScopes(grant, binding);
			if (!hasRequiredScopes(effectiveScopes, input.requiredScopes)) {
				continue;
			}

			return buildResolvedCredential(grant, binding);
		}

		return null;
	},
	getAccessToken: async (credential, input) => {
		const binding = await bindingStore.getBinding(credential.bindingId);
		if (!binding || !isBindingUsable(binding)) {
			throw new Error('Linked provider binding is unavailable');
		}

		const grant = await grantStore.getGrant(credential.grantId);
		if (!grant || !isGrantUsable(grant)) {
			throw new Error('Linked provider grant is unavailable');
		}

		const requiredScopes = input?.requiredScopes;
		const effectiveScopes = getEffectiveScopes(grant, binding);
		if (!hasRequiredScopes(effectiveScopes, requiredScopes)) {
			throw new Error(
				'Linked provider credential is missing required scopes'
			);
		}

		const currentTime = now();
		let lease = await loadAccessTokenLease(grant);
		if (needsRefresh(lease, currentTime, input?.minValidityMs)) {
			if (!refreshAccessTokenLease) {
				throw new Error(
					'Linked provider access token lease requires refresh'
				);
			}

			const refreshed = await refreshAccessTokenLease(grant, input);
			if (!refreshed) {
				throw new Error('Linked provider access token refresh failed');
			}

			await grantStore.saveGrant(refreshed.grant);
			lease = refreshed.lease;
		}

		if (!lease) {
			throw new Error(
				'Linked provider access token lease is unavailable'
			);
		}

		ensureLeaseScopes(lease, requiredScopes);
		ensureLeaseValidity(lease, currentTime, input?.minValidityMs);
		return lease;
	},
	reportFailure: async (credential, report) => {
		const currentTime = now();
		const grant = await grantStore.getGrant(credential.grantId);
		const binding = await bindingStore.getBinding(credential.bindingId);

		if (grant) {
			const nextGrant: LinkedProviderGrant = {
				...grant,
				updatedAt: currentTime,
				lastRefreshError: report.message ?? report.code,
				metadata: annotateFailureMetadata(
					grant.metadata,
					report,
					currentTime
				)
			};

			if (report.code === 'unauthorized' || report.code === 'revoked') {
				nextGrant.status = 'revoked';
			}

			await grantStore.saveGrant(nextGrant);
		}

		if (binding) {
			const nextBinding: LinkedProviderBinding = {
				...binding,
				updatedAt: currentTime,
				metadata: annotateFailureMetadata(
					binding.metadata,
					report,
					currentTime
				)
			};

			if (report.code === 'unauthorized' || report.code === 'revoked') {
				nextBinding.status = 'disconnected';
			} else if (report.code === 'insufficient_scope') {
				nextBinding.status = 'restricted';
			}

			await bindingStore.saveBinding(nextBinding);
		}

		await onReportFailure?.({
			credential,
			report,
			grant: grant ?? undefined,
			binding: binding ?? undefined
		});
	}
});
