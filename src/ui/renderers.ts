import { isValidProviderOption, providerOptions } from 'citra';
import type {
	AuthHtmxClient,
	AuthHtmxRenderersConfig,
	AuthHtmxUser,
	AuthIdentityPayload,
	LinkedProviderPayload,
	ResolvedAuthHtmxRenderers
} from './types';

export const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

const defaultAuthorizationHref = (provider: string, client?: AuthHtmxClient) =>
	client
		? `/oauth2/${provider}/authorization?client=${client}`
		: `/oauth2/${provider}/authorization`;

/** Resolve the Absolute Auth HTMX fragment renderers. Every fragment has a
 *  package default that emits the Absolute Auth class contract; pass `render`
 *  to override any of them. Provider display data, the featured login
 *  providers, the connector targets and the authorization-URL builder are
 *  supplied here so the fragments stay app-agnostic. */
export const resolveAuthHtmxRenderers = (
	config: AuthHtmxRenderersConfig
): ResolvedAuthHtmxRenderers => {
	const { connectorTargets, featuredLoginProviders, providerData } = config;
	const authorizationHref = config.authorizationHref ?? defaultAuthorizationHref;
	const overrides = config.render ?? {};

	const providerLabel = (key: string) =>
		isValidProviderOption(key) ? (providerData[key]?.name ?? key) : key;
	const providerLogo = (key: string) =>
		isValidProviderOption(key) ? (providerData[key]?.logoUrl ?? '') : '';

	const account = (user: AuthHtmxUser) => {
		const fullName = [user.first_name, user.last_name]
			.filter((part) => typeof part === 'string' && part.length > 0)
			.join(' ');

		return `<div class="grid-2">
    <div class="card"><h2 class="card__title">Canonical account</h2><p class="muted">Absolute Auth keeps one canonical user and links every OAuth identity to it. Conflicting identities raise a merge request.</p></div>
    <div class="card text-left"><h2 class="card__title">Profile fields</h2>
      <div class="spread"><span class="muted">Subject</span><span>${escapeHtml(user.sub)}</span></div>
      <div class="spread"><span class="muted">Name</span><span>${escapeHtml(fullName || '—')}</span></div>
      <div class="spread"><span class="muted">Email</span><span>${escapeHtml(user.email ?? '—')}</span></div>
      <div class="spread"><span class="muted">Primary identity</span><span>${escapeHtml(user.primary_auth_identity_id ?? '—')}</span></div>
    </div>
  </div>`;
	};

	const authMenu = (user: AuthHtmxUser | null) => {
		if (!user) {
			return `<a class="btn btn--primary btn--sm" href="/htmx">Sign in</a>`;
		}
		const label = user.email ?? user.first_name ?? 'Account';

		return `<span class="muted">${escapeHtml(label)}</span><a class="btn btn--ghost btn--sm" href="/htmx/signout">Sign out</a>`;
	};

	const connectorLinks = () =>
		connectorTargets
			.map(
				(target) =>
					`<div class="card text-left"><h2 class="card__title row"><img class="entity__logo" alt="" src="${providerLogo(target.provider)}" />${escapeHtml(target.label)}</h2><p class="muted">${escapeHtml(target.description)}</p><a class="btn btn--primary" href="${authorizationHref(target.provider, 'connector')}">Link ${escapeHtml(target.label)}</a></div>`
			)
			.join('');

	const connectors = (payload: LinkedProviderPayload) => {
		const scopeList = (scopes: string[]) =>
			scopes
				.map((scope) => `<span class="scope">${escapeHtml(scope)}</span>`)
				.join('');

		const bindings =
			payload.bindings.length === 0
				? `<div class="empty-state">No external accounts linked.</div>`
				: `<div class="entity-list">${payload.bindings
						.map(
							(binding) =>
								`<div class="entity"><div class="entity__meta"><span class="entity__title">${escapeHtml(binding.label ?? binding.externalAccountId)}<span class="pill">${escapeHtml(binding.connectorProvider)}</span></span><span class="entity__sub">${escapeHtml(binding.externalAccountType)} · ${escapeHtml(binding.status)}</span><div class="scope-list">${scopeList(binding.availableScopes)}</div></div><div class="entity__actions"><form hx-delete="/htmx/connectors/bindings/${binding.id}" hx-target="#connector-list" hx-swap="innerHTML"><button class="btn btn--danger btn--sm" type="submit">Remove</button></form></div></div>`
						)
						.join('')}</div>`;

		const grants =
			payload.grants.length === 0
				? `<div class="empty-state">No connector grants yet.</div>`
				: `<div class="entity-list">${payload.grants
						.map(
							(grant) =>
								`<div class="entity"><div class="entity__meta"><span class="entity__title">${escapeHtml(grant.authProviderKey)}<span class="pill pill--indigo">${escapeHtml(grant.status)}</span></span><span class="entity__sub">Subject ${escapeHtml(grant.providerSubject)}</span><div class="scope-list">${scopeList(grant.grantedScopes)}</div></div><div class="entity__actions"><form hx-delete="/htmx/connectors/grants/${grant.id}" hx-target="#connector-list" hx-swap="innerHTML"><button class="btn btn--danger btn--sm" type="submit">Remove</button></form></div></div>`
						)
						.join('')}</div>`;

		return `<h3 class="provider-heading">External accounts</h3>${bindings}<h3 class="provider-heading">Grants</h3>${grants}`;
	};

	const identities = (payload: AuthIdentityPayload, query: string) => {
		const pending = payload.mergeRequests.filter(
			(req) => req.status === 'pending'
		);
		const mergesHtml =
			pending.length === 0
				? ''
				: `<div class="stack"><h3 class="provider-heading">Merge requests</h3><div class="entity-list">${pending
						.map(
							(req) =>
								`<div class="entity card--danger"><div class="entity__meta"><span class="entity__title">${escapeHtml(providerLabel(req.conflicting_auth_provider))} conflict</span><span class="entity__sub">Subject ${escapeHtml(req.conflicting_provider_subject)}</span></div><div class="entity__actions">
                <form hx-post="/htmx/merge/${req.id}" hx-target="#identities-list" hx-swap="innerHTML" hx-include="#identity-query"><button class="btn btn--primary btn--sm" type="submit">Merge</button></form>
                <form hx-delete="/htmx/merge/${req.id}" hx-target="#identities-list" hx-swap="innerHTML" hx-include="#identity-query"><button class="btn btn--ghost btn--sm" type="submit">Dismiss</button></form>
              </div></div>`
						)
						.join('')}</div></div>`;

		const term = query.trim().toLowerCase();
		const groups = Object.entries(payload.identities)
			.map(([provider, list]) => ({
				identities: list.filter(
					(identity) =>
						term === '' ||
						providerLabel(provider).toLowerCase().includes(term) ||
						identity.id.toLowerCase().includes(term) ||
						identity.provider_subject.toLowerCase().includes(term)
				),
				provider
			}))
			.filter((group) => group.identities.length > 0);

		const groupsHtml =
			groups.length === 0
				? `<div class="empty-state">No identities match your search.</div>`
				: groups
						.map(
							(group) =>
								`<div class="provider-group"><h3 class="provider-heading">${
									providerLogo(group.provider)
										? `<img class="entity__logo" alt="" src="${providerLogo(group.provider)}" />`
										: ''
								}${escapeHtml(providerLabel(group.provider))}</h3><div class="entity-list">${group.identities
									.map(
										(identity) =>
											`<div class="entity"><div class="entity__main"><div class="entity__meta"><span class="entity__title">${escapeHtml(identity.provider_subject)}${identity.isPrimary ? `<span class="pill pill--primary">Primary</span>` : ''}</span><span class="entity__sub">${escapeHtml(identity.id)}</span></div></div><div class="entity__actions">
                      ${identity.isPrimary ? '' : `<form hx-post="/htmx/identities/${identity.id}/primary" hx-target="#identities-list" hx-swap="innerHTML" hx-include="#identity-query"><button class="btn btn--neutral btn--sm" type="submit">Set primary</button></form>`}
                      <form hx-delete="/htmx/identities/${identity.id}" hx-target="#identities-list" hx-swap="innerHTML" hx-include="#identity-query"><button class="btn btn--danger btn--sm" type="submit">Remove</button></form>
                    </div></div>`
									)
									.join('')}</div></div>`
						)
						.join('');

		return `${mergesHtml}${groupsHtml}`;
	};

	const protectedView = (user: AuthHtmxUser) =>
		`<section class="auth-section stack"><div><h1 class="page-heading">Protected page</h1><p class="muted">Your authenticated session resolves to this user record.</p></div><pre class="json">${escapeHtml(JSON.stringify(user, null, 2))}</pre></section>`;

	const providerLogin = (verb: string, includeDropdown: boolean) => {
		const featured = featuredLoginProviders
			.map(
				(provider) =>
					`<a class="oauth-button" href="${authorizationHref(provider)}"><img class="oauth-button__icon" alt="" src="${providerLogo(provider)}" /><span class="oauth-button__text">${escapeHtml(verb)} ${escapeHtml(providerLabel(provider))}</span></a>`
			)
			.join('');

		if (!includeDropdown) {
			return `<div class="oauth-grid">${featured}</div>`;
		}

		const options = providerOptions
			.map(
				(provider) =>
					`<option value="${provider}">${escapeHtml(providerLabel(provider))}</option>`
			)
			.join('');

		return `<div class="oauth-grid">${featured}
    <div class="separator"><span class="separator__line"></span><span class="separator__text">or any provider</span><span class="separator__line"></span></div>
    <form class="oauth-grid" action="/htmx/login-redirect" method="get">
      <select class="provider-select" name="provider" required>
        <option value="">Select a provider…</option>${options}
      </select>
      <button class="btn btn--primary" type="submit">Continue</button>
    </form>
  </div>`;
	};

	return {
		account: overrides.account ?? account,
		authMenu: overrides.authMenu ?? authMenu,
		connectorLinks: overrides.connectorLinks ?? connectorLinks,
		connectors: overrides.connectors ?? connectors,
		escapeHtml,
		identities: overrides.identities ?? identities,
		protected: overrides.protected ?? protectedView,
		providerLogin: overrides.providerLogin ?? providerLogin
	};
};
