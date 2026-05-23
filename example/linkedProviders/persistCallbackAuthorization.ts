import {
	extractPropFromIdentity,
	isValidProviderOption,
	OAuth2Client,
	OAuth2TokenResponse,
	providers,
	ProviderOption
} from 'citra';
import type {
	LinkedProviderBinding,
	LinkedProviderGrant
} from '@absolutejs/linked-providers';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import {
	ResolvedOAuthAuthorization,
	resolveOAuthAuthorization
} from '../../src';
import { SchemaType } from '../db/schema';
import { createDrizzleLinkedProviderStores } from './stores';

export const GMAIL_READONLY_SCOPE =
	'https://www.googleapis.com/auth/gmail.readonly';
export const GOOGLE_CONTACTS_READONLY_SCOPE =
	'https://www.googleapis.com/auth/contacts.readonly';
export const FACEBOOK_PAGES_SHOW_LIST_SCOPE = 'pages_show_list';
export const FACEBOOK_PAGES_READ_ENGAGEMENT_SCOPE = 'pages_read_engagement';
export const INSTAGRAM_BASIC_SCOPE = 'instagram_basic';

const META_GRAPH_BASE_URL = 'https://graph.facebook.com/v22.0';

const getGrantedScopes = (
	tokenResponse: OAuth2TokenResponse,
	configuredScopes: string[]
) => {
	const tokenScope = Reflect.get(tokenResponse as object, 'scope');
	if (typeof tokenScope === 'string' && tokenScope.trim().length > 0) {
		return [...new Set(tokenScope.split(/\s+/).filter(Boolean))];
	}

	return [...new Set(configuredScopes.filter(Boolean))];
};

const getPrimaryEmail = (userIdentity: Record<string, unknown>) => {
	const email = userIdentity.email;
	return typeof email === 'string' && email.trim().length > 0
		? email.trim().toLowerCase()
		: undefined;
};

const getPreferredLabel = (userIdentity: Record<string, unknown>) => {
	const name = userIdentity.name;
	if (typeof name === 'string' && name.trim().length > 0) {
		return name.trim();
	}

	return getPrimaryEmail(userIdentity);
};

const normalizeProviderSubject = (value: string | number) => String(value);

type MetaAccountsResponse = {
	data?: MetaPageAccount[];
};

type MetaPageAccount = {
	id?: string;
	name?: string;
	access_token?: string;
	category?: string;
	link?: string;
	fan_count?: number;
	instagram_business_account?: MetaInstagramBusinessAccount;
};

type MetaInstagramBusinessAccount = {
	id?: string;
	name?: string;
	username?: string;
	profile_picture_url?: string;
	biography?: string;
	website?: string;
};

const fetchMetaAccounts = async (accessToken: string) => {
	const url = new URL(`${META_GRAPH_BASE_URL}/me/accounts`);
	url.searchParams.set(
		'fields',
		[
			'id',
			'name',
			'access_token',
			'category',
			'link',
			'fan_count',
			'instagram_business_account{id,name,username,profile_picture_url,biography,website}'
		].join(',')
	);
	url.searchParams.set('limit', '200');
	url.searchParams.set('access_token', accessToken);

	const response = await fetch(url);
	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`Meta page discovery failed: ${response.status} ${response.statusText}${body.trim().length > 0 ? ` (${body.trim()})` : ''}`
		);
	}

	return (await response.json()) as MetaAccountsResponse;
};

const buildGoogleGrantAndBinding = async (input: {
	authProvider: ProviderOption;
	authorization: ResolvedOAuthAuthorization;
	authClient?: string;
	configuredScopes: string[];
	db: NeonHttpDatabase<SchemaType>;
	ownerRefOverride?: string;
	tokenResponse: OAuth2TokenResponse;
}) => {
	const {
		authClient,
		authProvider,
		authorization,
		configuredScopes,
		db,
		ownerRefOverride,
		tokenResponse
	} = input;
	const { bindingStore, grantStore } = createDrizzleLinkedProviderStores(db);
	const providerConfiguration = providers[authProvider];
	const providerSubject = normalizeProviderSubject(
		extractPropFromIdentity(
			authorization.userIdentity,
			providerConfiguration.subject,
			providerConfiguration.subjectType
		)
	);
	if (ownerRefOverride === undefined) {
		throw new Error(
			'Linked provider persistence requires a canonical owner ref'
		);
	}

	const ownerRef = ownerRefOverride;
	const grantedScopes = getGrantedScopes(tokenResponse, configuredScopes);
	const now = Date.now();
	const existingGrant = (await grantStore.listGrantsByOwner(ownerRef)).find(
		(grant) =>
			grant.authProviderKey === authProvider &&
			grant.providerSubject === providerSubject
	);
	const grantId = existingGrant?.id ?? `${authProvider}:${providerSubject}`;
	const grant: LinkedProviderGrant = {
		accessTokenCiphertext: authorization.accessToken,
		authProviderKey: authProvider,
		createdAt: existingGrant?.createdAt ?? now,
		expiresAt: authorization.expiresAt,
		grantedScopes,
		id: grantId,
		lastRefreshError: undefined,
		lastRefreshedAt: now,
		metadata: {
			providerClient: authClient,
			providerIdentity: authorization.userIdentity
		},
		ownerRef,
		providerFamily: 'google',
		providerSubject,
		refreshTokenCiphertext: authorization.refreshToken,
		status: 'active',
		tokenType: authorization.tokenType,
		updatedAt: now
	};

	await grantStore.saveGrant(grant);

	const existingBindings = await bindingStore.listBindingsByGrant(grantId);
	const bindings: LinkedProviderBinding[] = [];
	if (grantedScopes.includes(GMAIL_READONLY_SCOPE)) {
		const mailboxEmail = getPrimaryEmail(authorization.userIdentity);
		const externalAccountId = mailboxEmail ?? providerSubject;
		const existingBinding = existingBindings.find(
			(candidate) =>
				candidate.connectorProvider === 'gmail' &&
				candidate.externalAccountId === externalAccountId
		);

		bindings.push({
			availableScopes: grantedScopes,
			capabilities: ['messages.read', 'attachments.read'],
			connectorProvider: 'gmail',
			createdAt: existingBinding?.createdAt ?? now,
			email: mailboxEmail,
			externalAccountId,
			externalAccountType: 'mailbox',
			grantId,
			id:
				existingBinding?.id ??
				`gmail:${providerSubject}:${externalAccountId}`,
			label: getPreferredLabel(authorization.userIdentity),
			metadata: {
				providerIdentity: authorization.userIdentity,
				providerSubject
			},
			status: 'active',
			updatedAt: now,
			username: mailboxEmail?.split('@')[0]
		});
	}

	if (grantedScopes.includes(GOOGLE_CONTACTS_READONLY_SCOPE)) {
		const contactsEmail = getPrimaryEmail(authorization.userIdentity);
		const externalAccountId = contactsEmail ?? providerSubject;
		const existingBinding = existingBindings.find(
			(candidate) =>
				candidate.connectorProvider === 'google_contacts' &&
				candidate.externalAccountId === externalAccountId
		);

		bindings.push({
			availableScopes: grantedScopes,
			capabilities: ['contacts.read'],
			connectorProvider: 'google_contacts',
			createdAt: existingBinding?.createdAt ?? now,
			email: contactsEmail,
			externalAccountId,
			externalAccountType: 'contacts',
			grantId,
			id:
				existingBinding?.id ??
				`google_contacts:${providerSubject}:${externalAccountId}`,
			label: getPreferredLabel(authorization.userIdentity),
			metadata: {
				addressBook: 'connections',
				providerIdentity: authorization.userIdentity,
				providerSubject
			},
			status: 'active',
			updatedAt: now,
			username: contactsEmail?.split('@')[0]
		});
	}

	for (const binding of bindings) {
		await bindingStore.saveBinding(binding);
	}

	return { binding: bindings[0], bindings, grant };
};

const buildMetaBindings = async (input: {
	grantId: string;
	grantedScopes: string[];
	providerSubject: string;
	now: number;
	existingBindings: LinkedProviderBinding[];
	accessToken?: string;
}) => {
	const {
		grantId,
		grantedScopes,
		providerSubject,
		now,
		existingBindings,
		accessToken
	} = input;
	const bindings: LinkedProviderBinding[] = [];
	let discoveryError: string | undefined;

	if (!accessToken) {
		return { bindings, discoveryError: 'Meta access token unavailable' };
	}

	try {
		const accounts = await fetchMetaAccounts(accessToken);
		for (const page of accounts.data ?? []) {
			if (typeof page.id !== 'string' || page.id.trim().length === 0) {
				continue;
			}

			const pageId = page.id.trim();
			const existingPageBinding = existingBindings.find(
				(candidate) =>
					candidate.connectorProvider === 'facebook' &&
					candidate.externalAccountId === pageId
			);
			bindings.push({
				availableScopes: grantedScopes,
				capabilities: ['posts.read', 'pages.read'],
				connectorProvider: 'facebook',
				createdAt: existingPageBinding?.createdAt ?? now,
				externalAccountId: pageId,
				externalAccountType: 'page',
				grantId,
				id:
					existingPageBinding?.id ??
					`facebook:${providerSubject}:${pageId}`,
				label: page.name?.trim() || `Facebook Page ${pageId}`,
				metadata: {
					fanCount: page.fan_count,
					pageAccessToken: page.access_token,
					pageCategory: page.category,
					pageLink: page.link,
					providerSubject
				},
				status: 'active',
				updatedAt: now,
				username: undefined
			});

			const instagram = page.instagram_business_account;
			if (
				typeof instagram?.id === 'string' &&
				instagram.id.trim().length > 0
			) {
				const instagramId = instagram.id.trim();
				const existingInstagramBinding = existingBindings.find(
					(candidate) =>
						candidate.connectorProvider === 'instagram' &&
						candidate.externalAccountId === instagramId
				);
				bindings.push({
					availableScopes: grantedScopes,
					capabilities: ['media.read', 'profile.read'],
					connectorProvider: 'instagram',
					createdAt: existingInstagramBinding?.createdAt ?? now,
					externalAccountId: instagramId,
					externalAccountType: 'instagram_business',
					grantId,
					id:
						existingInstagramBinding?.id ??
						`instagram:${providerSubject}:${instagramId}`,
					label:
						instagram.name?.trim() ||
						instagram.username?.trim() ||
						instagramId,
					metadata: {
						biography: instagram.biography,
						instagramUsername: instagram.username,
						parentPageAccessToken: page.access_token,
						parentPageId: pageId,
						parentPageName: page.name,
						profilePictureUrl: instagram.profile_picture_url,
						providerSubject,
						website: instagram.website
					},
					status: 'active',
					updatedAt: now,
					username: instagram.username?.trim() || undefined
				});
			}
		}
	} catch (error) {
		discoveryError = error instanceof Error ? error.message : String(error);
	}

	return { bindings, discoveryError };
};

const buildFacebookGrantAndBindings = async (input: {
	authClient?: string;
	authProvider: ProviderOption;
	authorization: ResolvedOAuthAuthorization;
	configuredScopes: string[];
	db: NeonHttpDatabase<SchemaType>;
	ownerRefOverride?: string;
	tokenResponse: OAuth2TokenResponse;
}) => {
	const {
		authClient,
		authProvider,
		authorization,
		configuredScopes,
		db,
		ownerRefOverride,
		tokenResponse
	} = input;
	const { bindingStore, grantStore } = createDrizzleLinkedProviderStores(db);
	const providerConfiguration = providers[authProvider];
	const providerSubject = normalizeProviderSubject(
		extractPropFromIdentity(
			authorization.userIdentity,
			providerConfiguration.subject,
			providerConfiguration.subjectType
		)
	);
	if (ownerRefOverride === undefined) {
		throw new Error(
			'Linked provider persistence requires a canonical owner ref'
		);
	}

	const ownerRef = ownerRefOverride;
	const grantedScopes = getGrantedScopes(tokenResponse, configuredScopes);
	const now = Date.now();
	const existingGrant = (await grantStore.listGrantsByOwner(ownerRef)).find(
		(grant) =>
			grant.authProviderKey === authProvider &&
			grant.providerSubject === providerSubject
	);
	const grantId = existingGrant?.id ?? `${authProvider}:${providerSubject}`;
	const existingBindings = await bindingStore.listBindingsByGrant(grantId);
	const { bindings, discoveryError } = await buildMetaBindings({
		accessToken: authorization.accessToken,
		existingBindings,
		grantId,
		grantedScopes,
		now,
		providerSubject
	});

	const grant: LinkedProviderGrant = {
		accessTokenCiphertext: authorization.accessToken,
		authProviderKey: authProvider,
		createdAt: existingGrant?.createdAt ?? now,
		expiresAt: authorization.expiresAt,
		grantedScopes,
		id: grantId,
		lastRefreshError: discoveryError,
		lastRefreshedAt: now,
		metadata: {
			bindingDiscoveryError: discoveryError,
			providerClient: authClient,
			providerIdentity: authorization.userIdentity
		},
		ownerRef,
		providerFamily: 'meta',
		providerSubject,
		refreshTokenCiphertext: authorization.refreshToken,
		status: 'active',
		tokenType: authorization.tokenType,
		updatedAt: now
	};

	await grantStore.saveGrant(grant);
	for (const binding of bindings) {
		await bindingStore.saveBinding(binding);
	}

	return { binding: bindings[0], bindings, grant };
};

export const persistLinkedProviderCallbackAuthorization = async ({
	authClient,
	authProvider,
	configuredScopes = [],
	db,
	ownerRefOverride,
	providerInstance,
	resolvedAuthorization,
	tokenResponse
}: {
	authProvider: ProviderOption;
	authClient?: string;
	configuredScopes?: string[];
	db: NeonHttpDatabase<SchemaType>;
	ownerRefOverride?: string;
	providerInstance: OAuth2Client<ProviderOption>;
	resolvedAuthorization?: ResolvedOAuthAuthorization;
	tokenResponse: OAuth2TokenResponse;
}) => {
	const authorization =
		resolvedAuthorization ??
		(await resolveOAuthAuthorization({
			authProvider,
			providerInstance,
			tokenResponse
		}));

	if (!isValidProviderOption(authProvider)) {
		return { resolvedAuthorization: authorization };
	}

	if (authProvider === 'google') {
		const { binding, bindings, grant } = await buildGoogleGrantAndBinding({
			authClient,
			authProvider,
			authorization,
			configuredScopes,
			db,
			ownerRefOverride,
			tokenResponse
		});

		return {
			binding,
			bindings,
			grant,
			resolvedAuthorization: authorization
		};
	}

	if (authProvider === 'facebook') {
		const { binding, bindings, grant } =
			await buildFacebookGrantAndBindings({
				authClient,
				authProvider,
				authorization,
				configuredScopes,
				db,
				ownerRefOverride,
				tokenResponse
			});

		return {
			binding,
			bindings,
			grant,
			resolvedAuthorization: authorization
		};
	}

	return { resolvedAuthorization: authorization };
};
