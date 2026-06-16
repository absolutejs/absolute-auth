// Framework-agnostic glue between the WebAuthn ceremonies the package exposes via
// `createAuthClient` and the browser's `navigator.credentials.{get,create}` APIs.
// Used by the framework composables (`./react`, `./vue`, `./solid`, `./svelte`) so the
// React + Vue + Solid + Svelte hooks all share the same imperative core; the framework
// wrappers only add reactivity.
//
// `@simplewebauthn/browser` is an OPTIONAL peer dep — consumers that don't import any
// of the passkey composables never load it. We dynamic-import lazily on first call so a
// non-passkey consumer pays nothing at module load.

import type { AuthClient, AuthClientError } from './createAuthClient';

type StartAuthentication = (options: {
	optionsJSON: unknown;
	useBrowserAutofill?: boolean;
}) => Promise<unknown>;

type StartRegistration = (options: {
	optionsJSON: unknown;
}) => Promise<unknown>;

const loadBrowser = async () => {
	const mod: {
		startAuthentication: StartAuthentication;
		startRegistration: StartRegistration;
	} =
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @simplewebauthn/browser is an optional peer dep; the dynamic import is gated by composable use sites + the shape matches the upstream signature we depend on
		(await import('@simplewebauthn/browser')) as {
			startAuthentication: StartAuthentication;
			startRegistration: StartRegistration;
		};

	return mod;
};

const errorFor = (caught: unknown): AuthClientError => ({
	body: null,
	message: caught instanceof Error ? caught.message : 'webauthn_failed',
	status: 0
});

// Runs the WebAuthn authentication ceremony in conditional-UI mode (the browser surfaces
// saved passkeys directly via autofill on a focused `<input autocomplete="webauthn">`).
// Returns the same `{ data, error }` shape `createAuthClient` already uses, so composables
// can pipe the result into their state setters unchanged.
export const runConditionalAuthentication = async (client: AuthClient) => {
	if (typeof window === 'undefined' || !window.PublicKeyCredential) {
		return {
			data: null,
			error: errorFor(new Error('webauthn_unavailable'))
		};
	}
	const options = await client.passkeys.authenticateOptions();
	if (options.error) return { data: null, error: options.error };
	try {
		const { startAuthentication } = await loadBrowser();
		const credential = await startAuthentication({
			optionsJSON: options.data,
			useBrowserAutofill: true
		});

		return client.passkeys.authenticateVerify(credential);
	} catch (caught) {
		return { data: null, error: errorFor(caught) };
	}
};

// Runs the WebAuthn registration ceremony for the currently authenticated user. Used by
// the "upgrade to passkey" prompt — after a password sign-in, surface a "save a passkey
// to this device for next time?" CTA.
export const runPasskeyRegistration = async (client: AuthClient) => {
	if (typeof window === 'undefined' || !window.PublicKeyCredential) {
		return {
			data: null,
			error: errorFor(new Error('webauthn_unavailable'))
		};
	}
	const options = await client.passkeys.registerOptions();
	if (options.error) return { data: null, error: options.error };
	try {
		const { startRegistration } = await loadBrowser();
		const credential = await startRegistration({
			optionsJSON: options.data
		});

		return client.passkeys.registerVerify(credential);
	} catch (caught) {
		return { data: null, error: errorFor(caught) };
	}
};
