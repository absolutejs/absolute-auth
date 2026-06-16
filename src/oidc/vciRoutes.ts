// The four VCI HTTP surfaces, mounted as a standalone Elysia plugin. The consumer composes it
// alongside the OIDC provider:
//   .use(oidcRoutes(...))
//   .use(vciRoutes({ vciConfig, issuerUrl, signingKey }))
//
// Routes:
//   GET  /.well-known/openid-credential-issuer  — discovery
//   POST /vci/credential                         — issue an SD-JWT VC for an authorized access token
//   POST /vci/nonce                              — issue a fresh c_nonce for wallet proof-of-possession
//
// The pre-authorized_code grant on /oauth2/token is wired into the OIDC token route (see
// `oidc/routes.ts`) so it shares the token endpoint with every other grant — wallets reuse the
// same audience + signing key.

import { Elysia, t } from 'elysia';
import type { SigningKey } from './keys';
import {
	buildIssuerMetadata,
	DEFAULT_VCI_ROUTE,
	issueCredential,
	type VciConfig
} from './vci';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const BEARER_PREFIX = 'Bearer ';

const errorBody = (error: string, status: number) =>
	new Response(JSON.stringify({ error }), {
		headers: { 'content-type': 'application/json' },
		status
	});

const extractBearer = (authorization: string | undefined) => {
	if (
		authorization === undefined ||
		!authorization.startsWith(BEARER_PREFIX)
	) {
		return undefined;
	}
	const value = authorization.slice(BEARER_PREFIX.length).trim();

	return value.length === 0 ? undefined : value;
};

export const vciRoutes = ({
	issuerUrl,
	signingKey,
	vciConfig
}: {
	issuerUrl: string;
	signingKey: SigningKey;
	vciConfig: VciConfig;
}) => {
	const vciRoute = vciConfig.vciRoute ?? DEFAULT_VCI_ROUTE;
	const credentialRoute = `${vciRoute}/credential` as const;
	const nonceRoute = `${vciRoute}/nonce` as const;
	const vciSigningKey = vciConfig.signingKey ?? signingKey;

	return new Elysia()
		.get('/.well-known/openid-credential-issuer', () =>
			Response.json(
				buildIssuerMetadata({
					config: vciConfig,
					issuer: issuerUrl,
					vciRoute
				})
			)
		)
		.post(
			credentialRoute,
			async ({ body, headers }) => {
				const accessToken = extractBearer(headers.authorization);
				if (accessToken === undefined) {
					return errorBody('invalid_token', HTTP_UNAUTHORIZED);
				}
				const result = await issueCredential({
					config: vciConfig,
					input: {
						accessToken,
						proofJwt: body.proof?.jwt,
						requestedFormat: body.format
					},
					issuer: issuerUrl,
					signingKey: vciSigningKey
				});
				if (!result.ok)
					return errorBody(result.error, HTTP_BAD_REQUEST);

				return Response.json(
					{ credential: result.credential, format: result.format },
					{ status: HTTP_OK }
				);
			},
			{
				body: t.Object({
					format: t.Optional(t.Union([t.Literal('vc+sd-jwt')])),
					proof: t.Optional(
						t.Object({
							jwt: t.String(),
							proof_type: t.Literal('jwt')
						})
					)
				})
			}
		)
		.post(nonceRoute, async () => {
			if (vciConfig.credentialNonceStore === undefined) {
				return errorBody('not_supported', HTTP_BAD_REQUEST);
			}
			const { generateSecureToken, hashToken } = await import(
				'../crypto'
			);
			const nonceBytes = 16;
			const nonce = generateSecureToken(nonceBytes);
			const ttlMs = vciConfig.nonceTtlMs ?? 300_000;
			await vciConfig.credentialNonceStore.saveNonce({
				expiresAt: Date.now() + ttlMs,
				nonceHash: await hashToken(nonce)
			});
			const msPerSecond = 1000;

			return Response.json(
				{
					c_nonce: nonce,
					c_nonce_expires_in: Math.floor(ttlMs / msPerSecond)
				},
				{ status: HTTP_OK }
			);
		});
};
