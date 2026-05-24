/* HTMX fragment renderers for the Absolute Auth UI.
 *
 * Mirrors the `resolve*HTMXRenderers` story shipped by @absolutejs/ai and
 * @absolutejs/rag: the package owns the default fragment HTML so consumers
 * don't redefine it, while every renderer stays overridable and the data the
 * fragments display is supplied at resolve time. */

/** Minimal shape the account/menu/protected fragments read off the resolved
 *  user. The consumer's full user record is structurally assignable. */
export type AuthHtmxUser = {
	sub: string;
	email?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	primary_auth_identity_id?: string | null;
};

export type AuthHtmxProviderInfo = {
	name: string;
	logoUrl: string;
};

/** Per-provider display data (name + logo) keyed by provider option. */
export type AuthHtmxProviderData = Record<string, AuthHtmxProviderInfo>;

export type AuthHtmxConnectorTarget = {
	provider: string;
	label: string;
	description: string;
};

/** OAuth client a provider authorization URL targets. Providers configured
 *  with separate login/connector clients use this to disambiguate. */
export type AuthHtmxClient = 'login' | 'connector';

export type AuthIdentitySummary = {
	id: string;
	provider_subject: string;
	isPrimary?: boolean;
};

export type AuthIdentityMergeRequestSummary = {
	id: string;
	status: string;
	conflicting_auth_provider: string;
	conflicting_provider_subject: string;
};

export type AuthIdentityPayload = {
	identities: Record<string, AuthIdentitySummary[]>;
	mergeRequests: AuthIdentityMergeRequestSummary[];
};

export type LinkedProviderBindingSummary = {
	id: string;
	label?: string | null;
	externalAccountId: string;
	connectorProvider: string;
	externalAccountType: string;
	status: string;
	availableScopes: string[];
};

export type LinkedProviderGrantSummary = {
	id: string;
	authProviderKey: string;
	status: string;
	providerSubject: string;
	grantedScopes: string[];
};

export type LinkedProviderPayload = {
	bindings: LinkedProviderBindingSummary[];
	grants: LinkedProviderGrantSummary[];
};

/** Per-fragment overrides. Any renderer left unset uses the package default. */
export type AuthHtmxRenderOverrides = {
	account?: (user: AuthHtmxUser) => string;
	authMenu?: (user: AuthHtmxUser | null) => string;
	connectorLinks?: () => string;
	connectors?: (payload: LinkedProviderPayload) => string;
	identities?: (payload: AuthIdentityPayload, query: string) => string;
	protected?: (user: AuthHtmxUser) => string;
	providerLogin?: (verb: string, includeDropdown: boolean) => string;
};

export type AuthHtmxRenderersConfig = {
	/** Display data (name + logo) for every provider the UI references. */
	providerData: AuthHtmxProviderData;
	/** Providers shown as one-tap login buttons, in order. */
	featuredLoginProviders: string[];
	/** Connector targets shown on the connectors page. */
	connectorTargets: AuthHtmxConnectorTarget[];
	/** Builds the OAuth2 authorization URL for a provider. Defaults to
	 *  `/oauth2/<provider>/authorization` (with `?client=<client>` when a
	 *  client is given). Override to add per-provider client routing. */
	authorizationHref?: (provider: string, client?: AuthHtmxClient) => string;
	/** Per-fragment overrides. */
	render?: AuthHtmxRenderOverrides;
};

export type ResolvedAuthHtmxRenderers = Required<AuthHtmxRenderOverrides> & {
	escapeHtml: (value: string) => string;
};

/** Config for the `htmx` option on `absoluteAuth`. Extends the renderers
 *  config with the data actions the fragment routes call — keeping the auth
 *  package agnostic of your identity schema while it owns the route wiring
 *  (protectRoute gating, payload re-rendering, signout, delete-account flow). */
export type AuthHtmxConfig = AuthHtmxRenderersConfig & {
	/** Load the current user's grouped identities + pending merge requests. */
	loadAuthIdentities: (
		userSub: string
	) => AuthIdentityPayload | Promise<AuthIdentityPayload>;
	/** Load the current user's connector grants + external-account bindings. */
	loadLinkedProviders: (
		userSub: string
	) => LinkedProviderPayload | Promise<LinkedProviderPayload>;
	/** Promote an identity to the user's primary. */
	setPrimaryIdentity: (input: {
		identityId: string;
		userSub: string;
	}) => void | Promise<unknown>;
	/** Remove an identity (the route already guards last-identity + primary). */
	removeIdentity: (input: {
		identityId: string;
		userSub: string;
	}) => void | Promise<unknown>;
	/** Accept a pending merge request into the current user. */
	mergeIdentity: (input: {
		mergeRequestId: string;
		userSub: string;
	}) => void | Promise<unknown>;
	/** Dismiss a pending merge request. */
	dismissMergeRequest: (input: {
		mergeRequestId: string;
		userSub: string;
	}) => void | Promise<unknown>;
	/** Revoke a connector grant the user owns. */
	removeGrant: (input: {
		grantId: string;
		userSub: string;
	}) => void | Promise<unknown>;
	/** Remove an external-account binding the user owns. */
	removeBinding: (input: {
		bindingId: string;
		userSub: string;
	}) => void | Promise<unknown>;
	/** Delete the user's account and all linked data. */
	deleteAccount: (input: { userSub: string }) => void | Promise<unknown>;
};
