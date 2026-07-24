import 'reflect-metadata';
import type {
	AuthenticationResponseJSON,
	RegistrationResponseJSON
} from '@simplewebauthn/server';
import type { WebAuthnAdapter } from './adapter';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const hasCredentialEnvelope = (value: unknown) => {
	if (!isRecord(value)) return false;
	const response = Reflect.get(value, 'response');

	return (
		typeof Reflect.get(value, 'id') === 'string' &&
		typeof Reflect.get(value, 'rawId') === 'string' &&
		Reflect.get(value, 'type') === 'public-key' &&
		isRecord(Reflect.get(value, 'clientExtensionResults')) &&
		isRecord(response) &&
		typeof Reflect.get(response, 'clientDataJSON') === 'string'
	);
};

const isAuthenticationResponse = (
	value: unknown
): value is AuthenticationResponseJSON => {
	if (!isRecord(value) || !hasCredentialEnvelope(value)) return false;
	const response = Reflect.get(value, 'response');
	if (!isRecord(response)) return false;
	const userHandle = Reflect.get(response, 'userHandle');

	return (
		typeof Reflect.get(response, 'authenticatorData') === 'string' &&
		typeof Reflect.get(response, 'signature') === 'string' &&
		(userHandle === undefined || typeof userHandle === 'string')
	);
};

const isRegistrationResponse = (
	value: unknown
): value is RegistrationResponseJSON => {
	if (!isRecord(value) || !hasCredentialEnvelope(value)) return false;
	const response = Reflect.get(value, 'response');

	return (
		isRecord(response) &&
		typeof Reflect.get(response, 'attestationObject') === 'string'
	);
};

// A ready-made WebAuthnAdapter wrapping @simplewebauthn/server (the vetted
// attestation/assertion verifier). @simplewebauthn/server is an OPTIONAL peer:
// it's loaded lazily here so apps that don't use passkeys never pull it in.
// `createSimpleWebAuthnAdapter()` is async (resolves the dynamic import once);
// await it before passing the adapter to `webauthnRoutes`.
export const createSimpleWebAuthnAdapter =
	async (): Promise<WebAuthnAdapter> => {
		const {
			generateAuthenticationOptions,
			generateRegistrationOptions,
			verifyAuthenticationResponse,
			verifyRegistrationResponse
		} = await import('@simplewebauthn/server');

		const toBase64Url = (bytes: Uint8Array) =>
			Buffer.from(bytes).toString('base64url');
		const fromBase64Url = (value: string) =>
			new Uint8Array(Buffer.from(value, 'base64url'));

		return {
			createAuthenticationOptions: async ({ allowCredentials, rpId }) => {
				const options = await generateAuthenticationOptions({
					allowCredentials: allowCredentials.map(({ id }) => ({
						id
					})),
					rpID: rpId
				});

				return {
					challenge: options.challenge,
					options: { ...options }
				};
			},
			createRegistrationOptions: async ({
				excludeCredentials,
				rpId,
				rpName,
				userDisplayName,
				userId,
				userName
			}) => {
				const options = await generateRegistrationOptions({
					excludeCredentials: excludeCredentials.map(({ id }) => ({
						id
					})),
					rpID: rpId,
					rpName,
					userDisplayName,
					userID: Uint8Array.from(new TextEncoder().encode(userId)),
					userName
				});

				return {
					challenge: options.challenge,
					options: { ...options }
				};
			},
			verifyAuthentication: async ({
				credential,
				expectedChallenge,
				expectedOrigin,
				expectedRPID,
				response
			}) => {
				if (!isAuthenticationResponse(response))
					return { verified: false };
				const result = await verifyAuthenticationResponse({
					credential: {
						counter: credential.counter,
						id: credential.credentialId,
						publicKey: fromBase64Url(credential.publicKey)
					},
					expectedChallenge,
					expectedOrigin,
					expectedRPID,
					response
				});

				return {
					newCounter: result.authenticationInfo?.newCounter,
					verified: result.verified
				};
			},
			verifyRegistration: async ({
				expectedChallenge,
				expectedOrigin,
				expectedRPID,
				response
			}) => {
				if (!isRegistrationResponse(response))
					return { verified: false };
				const result = await verifyRegistrationResponse({
					expectedChallenge,
					expectedOrigin,
					expectedRPID,
					response
				});
				if (!result.verified || !result.registrationInfo) {
					return { verified: false };
				}
				const { credential, credentialBackedUp, credentialDeviceType } =
					result.registrationInfo;

				return {
					credential: {
						backedUp: credentialBackedUp,
						counter: credential.counter,
						credentialId: credential.id,
						deviceType: credentialDeviceType,
						publicKey: toBase64Url(credential.publicKey),
						transports: credential.transports
					},
					verified: true
				};
			}
		};
	};
