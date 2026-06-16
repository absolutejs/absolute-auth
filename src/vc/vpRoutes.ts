// HTTP surfaces for the OID4VP verifier. Mounted as a standalone Elysia plugin alongside
// the existing OIDC + VCI routes:
//
//   .use(vpRoutes({ vpConfig, issuerUrl, onVerifiedPresentation }))
//
// Routes:
//   POST /vp/authorize  — mint a presentation request, return { request_uri, requestId, nonce }
//   GET  /vp/request/:id — return the signed request object the wallet fetches
//   POST /vp/response   — accept the wallet's vp_token, verify, fire the consumer hook
//
// The consumer's `onVerifiedPresentation` hook receives the verified claims + holder JWK
// and decides what to do (mint a session, attach the proof to a checkout, etc.).

import { Elysia, t } from 'elysia';
import {
	createPresentationRequest,
	verifyPresentationResponse,
	type CreatePresentationRequestInput,
	type VerifiedPresentation,
	type Vp4Config
} from './openid4vp';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

const errorBody = (error: string, status: number) =>
	new Response(JSON.stringify({ error }), {
		headers: { 'content-type': 'application/json' },
		status
	});

export const DEFAULT_VP_ROUTE = '/vp';

export const vpRoutes = ({
	defaultClientId,
	issuerUrl,
	onVerifiedPresentation,
	vpConfig,
	vpRoute = DEFAULT_VP_ROUTE
}: {
	// Default client_id to stamp on requests when the consumer doesn't override per-call.
	defaultClientId: string;
	issuerUrl: string;
	onVerifiedPresentation?: (context: {
		verified: VerifiedPresentation;
	}) => Promise<void> | void;
	vpConfig: Vp4Config;
	vpRoute?: string;
}) => {
	const authorizeRoute = `${vpRoute}/authorize` as const;
	const requestRoute = `${vpRoute}/request/:id` as const;
	const responseRoute = `${vpRoute}/response` as const;

	return new Elysia()
		.post(
			authorizeRoute,
			async ({ body }) => {
				const input: CreatePresentationRequestInput = {
					clientId: body.client_id ?? defaultClientId,
					requestedClaims: body.requested_claims,
					state: body.state
				};
				const result = await createPresentationRequest({
					config: vpConfig,
					input,
					issuer: issuerUrl,
					getRequestUri: (id) =>
						`${issuerUrl}${vpRoute}/request/${id}`
				});

				return Response.json(
					{
						nonce: result.nonce,
						request_uri: result.requestUri,
						requestId: result.request.requestId
					},
					{ status: HTTP_OK }
				);
			},
			{
				body: t.Object({
					client_id: t.Optional(t.String()),
					requested_claims: t.Array(t.String()),
					state: t.Optional(t.String())
				})
			}
		)
		.get(
			requestRoute,
			async ({ params: { id } }) => {
				const stored = await vpConfig.requestStore.getRequest(id);
				if (stored === undefined) {
					return errorBody('unknown_request', HTTP_NOT_FOUND);
				}
				// Re-emit the signed request object every fetch — wallets sometimes re-fetch
				// on retry. The stored record carries the nonce + state we baked in.
				const rebuilt = await createPresentationRequest({
					config: {
						...vpConfig,
						requestStore: passthroughStore(stored)
					},
					input: {
						clientId: stored.clientId,
						requestedClaims: stored.requestedClaims,
						state: stored.state
					},
					issuer: issuerUrl,
					getRequestUri: () => `${issuerUrl}${vpRoute}/request/${id}`
				});

				return new Response(rebuilt.requestObject, {
					headers: {
						'content-type': 'application/oauth-authz-req+jwt'
					},
					status: HTTP_OK
				});
			},
			{ params: t.Object({ id: t.String() }) }
		)
		.post(
			responseRoute,
			async ({ body }) => {
				const requestId = body.state;
				if (requestId === undefined) {
					return errorBody('missing_state', HTTP_BAD_REQUEST);
				}
				const result = await verifyPresentationResponse({
					config: vpConfig,
					input: { requestId, vpToken: body.vp_token }
				});
				if (!result.ok)
					return errorBody(result.error, HTTP_BAD_REQUEST);
				if (onVerifiedPresentation !== undefined) {
					await onVerifiedPresentation({ verified: result.verified });
				}

				return Response.json(
					{
						disclosed_claims: result.verified.disclosedClaims,
						holder_jwk: result.verified.holderJwk,
						protected_claims: result.verified.protectedClaims,
						verified: true
					},
					{ status: HTTP_OK }
				);
			},
			{
				body: t.Object({
					presentation_submission: t.Optional(t.Unknown()),
					state: t.Optional(t.String()),
					vp_token: t.String()
				})
			}
		);
};

// The /vp/request/:id handler re-runs `createPresentationRequest` to re-emit the JWT, but
// we don't want it to write a duplicate row. This tiny pass-through wraps the stored record
// as a no-op `saveRequest` so the JWT is signed in-place.
const passthroughStore = (
	request: import('./openid4vp').PresentationRequest
) => ({
	consumeRequest: async () => request,
	getRequest: async () => request,
	saveRequest: async () => {
		/* no-op — record already persisted */
	}
});
