import 'reflect-metadata';
import type { SamlAdapter, SamlProfile } from './config';
import type { SamlConnection } from './types';

// A ready-made SamlAdapter wrapping @node-saml/node-saml (SP-side SAML 2.0:
// signed-assertion validation, AuthnRequest redirect, SP metadata, and — when
// SP signing credentials are supplied — Single Logout). @node-saml/node-saml is
// an OPTIONAL peer, loaded lazily here so apps that don't use SAML never pull in
// the XML/crypto stack. `createNodeSamlAdapter()` is async (resolves the dynamic
// import once) — await it before passing the adapter to `samlSsoRoutes`.
//
// The SP entityId/audience is derived from the ACS/SLO URL origin so it stays
// consistent across the metadata we publish and the assertions we validate.
//
// Single Logout (SP- and IdP-initiated) is enabled by passing `spPrivateKey`
// (PEM). Signing a LogoutRequest/LogoutResponse needs the SP's own key, which a
// credential-free SP doesn't hold — so the four SLO adapter methods are only
// exposed when a key is supplied, and `samlSsoRoutes` falls back to a local
// signout otherwise. `spCertificate` (PEM, no headers) is the matching public
// cert published in metadata's <KeyDescriptor>/<SingleLogoutService> so the IdP
// can verify our signatures.

// node-saml spreads each SAML attribute onto the profile as a top-level key
// alongside these standard fields — everything else is a user attribute.
const STANDARD_PROFILE_KEYS = new Set([
	'ID',
	'getAssertion',
	'getAssertionXml',
	'getSamlResponseXml',
	'issuer',
	'mainAttributes',
	'nameID',
	'nameIDFormat',
	'sessionIndex',
	'spNameQualifier'
]);

// Matches @node-saml/node-saml's DEFAULT_IDENTIFIER_FORMAT — what every modern
// SaaS IdP (Okta, Entra, Google) issues. Used for the NameID we echo back on a
// LogoutRequest/LogoutResponse; IdPs match the logout on NameID + SessionIndex.
const DEFAULT_NAMEID_FORMAT =
	'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';

export type NodeSamlAdapterOptions = {
	// SP private key (PEM) used to sign AuthnRequests and LogoutRequests/Responses.
	// When omitted, SLO is disabled (the adapter exposes no logout methods).
	spPrivateKey?: string;
	// SP public X.509 cert (PEM body) published in SP metadata.
	spCertificate?: string;
	// Redirect-binding signature digest. SHA-256 is the modern default; SHA-1 is
	// deprecated and rejected by most IdPs.
	signatureAlgorithm?: 'sha1' | 'sha256' | 'sha512';
};

// Derive the ACS and SLO endpoints for a connection from whichever sibling URL
// the caller has. `samlSsoRoutes` mounts them as `${ssoRoute}/saml/:org/acs`
// and `.../slo`, so one is a path-swap of the other — this keeps the adapter
// from needing both passed on every call.
const siblingEndpoints = (urls: { acsUrl?: string; sloUrl?: string }) => {
	const acsUrl = urls.acsUrl ?? urls.sloUrl?.replace(/\/slo(\?|$)/, '/acs$1');
	const sloUrl = urls.sloUrl ?? urls.acsUrl?.replace(/\/acs(\?|$)/, '/slo$1');

	return { acsUrl, sloUrl };
};

export const createNodeSamlAdapter = async (
	options: NodeSamlAdapterOptions = {}
): Promise<SamlAdapter> => {
	const { SAML } = await import('@node-saml/node-saml');
	const {
		signatureAlgorithm = 'sha256',
		spCertificate,
		spPrivateKey
	} = options;
	const canSign = spPrivateKey !== undefined;

	const build = (
		connection: SamlConnection,
		urls: { acsUrl?: string; sloUrl?: string }
	) => {
		const { acsUrl, sloUrl } = siblingEndpoints(urls);
		const baseUrl = acsUrl ?? sloUrl;
		if (baseUrl === undefined) {
			throw new Error(
				'node-saml adapter requires an acsUrl or sloUrl to build a SAML client'
			);
		}
		const spEntityId = new URL(baseUrl).origin;

		return new SAML({
			audience: spEntityId,
			callbackUrl: acsUrl ?? baseUrl,
			entryPoint: connection.config.idpSsoUrl,
			idpCert: connection.config.idpX509Cert,
			issuer: spEntityId,
			logoutUrl: connection.config.idpSloUrl,
			wantAssertionsSigned: true,
			// Signing material — only set when an SP key is configured, so the
			// no-SLO path stays byte-for-byte the credential-free behavior.
			...(canSign
				? {
						logoutCallbackUrl: sloUrl ?? baseUrl,
						privateKey: spPrivateKey,
						signatureAlgorithm
					}
				: {})
		});
	};

	const adapter: SamlAdapter = {
		createAuthorizationUrl: ({ acsUrl, connection, relayState }) =>
			build(connection, { acsUrl }).getAuthorizeUrlAsync(
				relayState ?? '',
				undefined,
				{}
			),
		getServiceProviderMetadata: ({ acsUrl, connection, sloUrl }) =>
			build(connection, {
				acsUrl,
				sloUrl
			}).generateServiceProviderMetadata(null, spCertificate ?? null),
		validateAssertion: async ({ acsUrl, connection, samlResponse }) => {
			const { profile } = await build(connection, {
				acsUrl
			}).validatePostResponseAsync({ SAMLResponse: samlResponse });
			if (!profile) {
				throw new Error('SAML response contained no assertion profile');
			}

			const attributes: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(profile)) {
				if (!STANDARD_PROFILE_KEYS.has(key)) attributes[key] = value;
			}

			const email =
				profile.email ??
				(profile.nameID.includes('@') ? profile.nameID : undefined);
			const result: SamlProfile = {
				attributes,
				email,
				nameId: profile.nameID,
				sessionIndex: profile.sessionIndex
			};

			return result;
		}
	};

	// Without an SP signing key we can't mint signed logout messages, so leave
	// the SLO methods off — `samlSsoRoutes` then degrades to a local signout.
	if (!canSign) return adapter;

	return {
		...adapter,
		// SP-initiated: signed LogoutRequest redirect (NameID + SessionIndex) to
		// the IdP's SLO endpoint.
		createLogoutRequestUrl: ({
			connection,
			nameId,
			relayState,
			sessionIndex,
			sloUrl
		}) => {
			const saml = build(connection, { sloUrl });

			return saml.getLogoutUrlAsync(
				{
					issuer: new URL(sloUrl).origin,
					nameID: nameId,
					nameIDFormat: DEFAULT_NAMEID_FORMAT,
					sessionIndex
				},
				relayState ?? '',
				{}
			);
		},
		// Signed LogoutResponse redirect — our reply to an IdP-initiated request.
		createLogoutResponseUrl: ({
			connection,
			inResponseTo,
			nameId,
			relayState,
			sloUrl
		}) => {
			const saml = build(connection, { sloUrl });

			return saml.getLogoutResponseUrlAsync(
				{
					ID: inResponseTo,
					issuer: new URL(sloUrl).origin,
					nameID: nameId ?? '',
					nameIDFormat: DEFAULT_NAMEID_FORMAT
				},
				relayState ?? '',
				{},
				true
			);
		},
		// Validate an IdP-initiated LogoutRequest (HTTP-Redirect binding) and pull
		// out NameID / SessionIndex / request ID. Throws on a bad signature.
		validateLogoutRequest: async ({
			connection,
			relayState,
			samlRequest,
			signature,
			signatureAlgorithm: sigAlg,
			signedQueryString,
			sloUrl
		}) => {
			const saml = build(connection, { sloUrl });
			const { profile } = await saml.validateRedirectAsync(
				{
					RelayState: relayState,
					SAMLRequest: samlRequest,
					SigAlg: sigAlg,
					Signature: signature
				},
				signedQueryString ?? ''
			);

			return {
				nameId: profile?.nameID,
				relayState,
				requestId: profile?.ID,
				sessionIndex: profile?.sessionIndex
			};
		},
		// Validate the IdP's LogoutResponse to our SP-initiated request. Throws on
		// a bad signature or a non-Success status.
		validateLogoutResponse: async ({
			connection,
			relayState,
			samlResponse,
			signature,
			signatureAlgorithm: sigAlg,
			signedQueryString,
			sloUrl
		}) => {
			const saml = build(connection, { sloUrl });
			await saml.validateRedirectAsync(
				{
					RelayState: relayState,
					SAMLResponse: samlResponse,
					SigAlg: sigAlg,
					Signature: signature
				},
				signedQueryString ?? ''
			);
		}
	};
};
