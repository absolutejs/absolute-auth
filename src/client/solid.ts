// Thin Solid composables over `createAuthClient`, mirroring `./react`. Same `{ data, error,
// isPending, mutate, reset }` shape — only the reactivity is Solid's (signals + onCleanup).
// Bring your own form / UI; these are primitives.

import { createSignal, onCleanup, type Accessor } from 'solid-js';
import type { AuthClient, AuthClientError } from './createAuthClient';
import {
	runConditionalAuthentication,
	runPasskeyRegistration
} from './passkeyHelpers';

type Mutator<Args, Data> = (
	args: Args
) => Promise<{ data: Data | null; error: AuthClientError | null }>;

type MutationState<Args, Data> = {
	data: Accessor<Data | null>;
	error: Accessor<AuthClientError | null>;
	isPending: Accessor<boolean>;
	mutate: Mutator<Args, Data>;
	reset: () => void;
};

// Generic mutation composable. The exported composables are 1-2 line specializations of
// this — kept private so consumers depend on the named API, not this internal shape.
const useMutation = <Args, Data>(
	run: Mutator<Args, Data>
): MutationState<Args, Data> => {
	const [data, setData] = createSignal<Data | null>(null);
	const [error, setError] = createSignal<AuthClientError | null>(null);
	const [isPending, setIsPending] = createSignal(false);
	let alive = true;
	onCleanup(() => {
		alive = false;
	});

	const mutate: Mutator<Args, Data> = async (args) => {
		setIsPending(true);
		setError(null);
		const result = await run(args);
		if (alive) {
			// Solid's setter accepts a value or a setter-fn; the fn-form keeps Data | null
			// passing through without narrowing the writable signal's value type.
			setData(() => result.data);
			setError(result.error);
			setIsPending(false);
		}

		return result;
	};

	const reset = () => {
		setData(() => null);
		setError(null);
		setIsPending(false);
	};

	return { data, error, isPending, mutate, reset };
};

export const useMagicLink = (client: AuthClient) =>
	useMutation(client.passwordless.requestMagicLink);
export const useMfaChallenge = (client: AuthClient) =>
	useMutation(client.mfa.challenge);
export const usePasskeyAutofill = (client: AuthClient) => {
	const [data, setData] = createSignal<{ status: 'authenticated' } | null>(
		null
	);
	const [error, setError] = createSignal<AuthClientError | null>(null);
	const [isPending, setIsPending] = createSignal(false);
	let alive = true;
	onCleanup(() => {
		alive = false;
	});

	const start = async () => {
		setIsPending(true);
		setError(null);
		const result = await runConditionalAuthentication(client);
		if (alive) {
			setData(() => result.data);
			setError(result.error);
			setIsPending(false);
		}
	};

	const cancel = () => {
		setIsPending(false);
	};

	return { cancel, data, error, isPending, start };
};
export const usePasswordReset = (client: AuthClient) =>
	useMutation(client.passwordReset.request);
export const useSessions = (client: AuthClient) => {
	const [data, setData] = createSignal<unknown[] | null>(null);
	const [error, setError] = createSignal<AuthClientError | null>(null);
	const [isPending, setIsPending] = createSignal(true);
	let alive = true;
	onCleanup(() => {
		alive = false;
	});

	const refetch = async () => {
		setIsPending(true);
		const result = await client.sessions.list();
		if (alive) {
			setData(() => result.data);
			setError(result.error);
			setIsPending(false);
		}
	};

	const revoke = async (sessionId: string) => {
		const result = await client.sessions.revoke(sessionId);
		if (result.error === null) await refetch();

		return result;
	};

	void refetch();

	return { data, error, isPending, refetch, revoke };
};
export const useSignIn = (client: AuthClient) =>
	useMutation(client.signIn.email);
export const useSignOut = (client: AuthClient) => useMutation(client.signOut);
export const useSignUp = (client: AuthClient) =>
	useMutation(client.signUp.email);
export const useUpgradeToPasskey = (client: AuthClient) => {
	const [passkeys, setPasskeys] = createSignal<unknown[] | null>(null);
	const [error, setError] = createSignal<AuthClientError | null>(null);
	const [isPending, setIsPending] = createSignal(true);
	let alive = true;
	onCleanup(() => {
		alive = false;
	});

	const refetch = async () => {
		setIsPending(true);
		const result = await client.passkeys.list();
		if (alive) {
			setPasskeys(() => result.data);
			setError(result.error);
			setIsPending(false);
		}
	};

	const register = async () => {
		const result = await runPasskeyRegistration(client);
		if (result.error === null) await refetch();

		return result;
	};

	void refetch();
	const shouldPrompt = () => {
		const list = passkeys();

		return list !== null && list.length === 0;
	};

	return { error, isPending, passkeys, refetch, register, shouldPrompt };
};
