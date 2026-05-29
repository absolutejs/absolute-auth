import type { SamlAdapter, SamlProfile } from './config';
import type { SamlConnection } from './types';

// A ready-made SamlAdapter wrapping @node-saml/node-saml (SP-side SAML 2.0:
// signed-assertion validation, AuthnRequest redirect, SP metadata).
// @node-saml/node-saml is an OPTIONAL peer, loaded lazily here so apps that
// don't use SAML never pull in the XML/crypto stack. `createNodeSamlAdapter()`
// is async (resolves the dynamic import once) — await it before passing the
// adapter to `samlSsoRoutes`. SP-initiated SLO is omitted (it needs an SP
// signing key, which this SP-credential-free setup doesn't hold); the package
// treats the SLO methods as optional.
//
// The SP entityId/audience is derived from the ACS URL origin so it stays
// consistent across the metadata we publish and the assertions we validate.

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

export const createNodeSamlAdapter = async (): Promise<SamlAdapter> => {
	const { SAML } = await import('@node-saml/node-saml');

	const build = (acsUrl: string, connection: SamlConnection) => {
		const spEntityId = new URL(acsUrl).origin;

		return new SAML({
			audience: spEntityId,
			callbackUrl: acsUrl,
			entryPoint: connection.config.idpSsoUrl,
			idpCert: connection.config.idpX509Cert,
			issuer: spEntityId,
			logoutUrl: connection.config.idpSloUrl,
			wantAssertionsSigned: true
		});
	};

	return {
		createAuthorizationUrl: ({ acsUrl, connection, relayState }) =>
			build(acsUrl, connection).getAuthorizeUrlAsync(
				relayState ?? '',
				undefined,
				{}
			),
		getServiceProviderMetadata: ({ acsUrl, connection }) =>
			build(acsUrl, connection).generateServiceProviderMetadata(null),
		validateAssertion: async ({ acsUrl, connection, samlResponse }) => {
			const { profile } = await build(
				acsUrl,
				connection
			).validatePostResponseAsync({ SAMLResponse: samlResponse });
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
};
