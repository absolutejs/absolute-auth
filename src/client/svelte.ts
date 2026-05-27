// Thin Svelte composables over `createAuthClient`, mirroring `./react`. Same `{ data,
// error, isPending, mutate, reset }` shape — only the reactivity is Svelte's (writable
// stores from `svelte/store`, which work in both Svelte 4 with `$store` auto-subscription
// and Svelte 5 with $state-based usage via `get(store)` or `$:` reactivity).
// Bring your own form / UI; these are primitives.

import { writable, type Writable } from 'svelte/store';
import type { AuthClient, AuthClientError } from './createAuthClient';

type Mutator<Args, Data> = (
	args: Args
) => Promise<{ data: Data | null; error: AuthClientError | null }>;

type MutationState<Args, Data> = {
	data: Writable<Data | null>;
	error: Writable<AuthClientError | null>;
	isPending: Writable<boolean>;
	mutate: Mutator<Args, Data>;
	reset: () => void;
};

// Generic mutation composable. The exported composables are 1-2 line specializations of
// this — kept private so consumers depend on the named API, not this internal shape.
const useMutation = <Args, Data>(
	run: Mutator<Args, Data>
): MutationState<Args, Data> => {
	const data: Writable<Data | null> = writable(null);
	const error: Writable<AuthClientError | null> = writable(null);
	const isPending = writable(false);

	const mutate: Mutator<Args, Data> = async (args) => {
		isPending.set(true);
		error.set(null);
		const result = await run(args);
		data.set(result.data);
		error.set(result.error);
		isPending.set(false);

		return result;
	};

	const reset = () => {
		data.set(null);
		error.set(null);
		isPending.set(false);
	};

	return { data, error, isPending, mutate, reset };
};

export const useMagicLink = (client: AuthClient) =>
	useMutation(client.passwordless.requestMagicLink);

export const useMfaChallenge = (client: AuthClient) =>
	useMutation(client.mfa.challenge);

export const usePasswordReset = (client: AuthClient) =>
	useMutation(client.passwordReset.request);

// Query composable for the user's active sessions; refetch() reruns it, revoke(sessionId)
// kills one and refetches. Same `{ data, error, isPending }` triplet as the mutations so
// the consumer can render one way.
export const useSessions = (client: AuthClient) => {
	const data: Writable<unknown[] | null> = writable(null);
	const error: Writable<AuthClientError | null> = writable(null);
	const isPending = writable(true);

	const refetch = async () => {
		isPending.set(true);
		const result = await client.sessions.list();
		data.set(result.data);
		error.set(result.error);
		isPending.set(false);
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
