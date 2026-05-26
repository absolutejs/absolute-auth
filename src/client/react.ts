// Thin React hooks over `createAuthClient`. Same `{ data, error }` shape; the hook adds
// `isPending` state and a stable mutator. Bring your own form/UI — these are primitives, not
// components. Composables (Vue/Solid/Svelte) will follow the same pattern over the same client.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthClient, AuthClientError } from './createAuthClient';

type Mutator<Args, Data> = (
	args: Args
) => Promise<{ data: Data | null; error: AuthClientError | null }>;

type MutationState<Args, Data> = {
	data: Data | null;
	error: AuthClientError | null;
	isPending: boolean;
	mutate: Mutator<Args, Data>;
	reset: () => void;
};

// Generic mutation hook. The other hooks are 1–2 line specializations of this — kept private
// here so consumers see the cohesive named API and don't depend on this shape.
const useMutation = <Args, Data>(
	run: Mutator<Args, Data>
): MutationState<Args, Data> => {
	const [data, setData] = useState<Data | null>(null);
	const [error, setError] = useState<AuthClientError | null>(null);
	const [isPending, setIsPending] = useState(false);
	const mountedRef = useRef(true);
	useEffect(
		() => () => {
			mountedRef.current = false;
		},
		[]
	);

	const mutate: Mutator<Args, Data> = useCallback(
		async (args) => {
			setIsPending(true);
			setError(null);
			const result = await run(args);
			if (mountedRef.current) {
				setData(result.data);
				setError(result.error);
				setIsPending(false);
			}

			return result;
		},
		[run]
	);

	const reset = useCallback(() => {
		setData(null);
		setError(null);
		setIsPending(false);
	}, []);

	return { data, error, isPending, mutate, reset };
};

export const useMagicLink = (client: AuthClient) =>
	useMutation(client.passwordless.requestMagicLink);

export const useMfaChallenge = (client: AuthClient) =>
	useMutation(client.mfa.challenge);

export const usePasswordReset = (client: AuthClient) =>
	useMutation(client.passwordReset.request);

// Query hook for the user's active sessions; refetch() reruns it. The shape matches the
// mutation hooks closely (isPending/error/data) so the consumer can render one way.
export const useSessions = (client: AuthClient) => {
	const [data, setData] = useState<unknown[] | null>(null);
	const [error, setError] = useState<AuthClientError | null>(null);
	const [isPending, setIsPending] = useState(true);
	const mountedRef = useRef(true);
	useEffect(
		() => () => {
			mountedRef.current = false;
		},
		[]
	);

	const refetch = useCallback(async () => {
		setIsPending(true);
		const result = await client.sessions.list();
		if (mountedRef.current) {
			setData(result.data);
			setError(result.error);
			setIsPending(false);
		}
	}, [client]);

	useEffect(() => {
		void refetch();
	}, [refetch]);

	const revoke = useCallback(
		async (sessionId: string) => {
			const result = await client.sessions.revoke(sessionId);
			if (result.error === null) await refetch();

			return result;
		},
		[client, refetch]
	);

	return { data, error, isPending, refetch, revoke };
};

export const useSignIn = (client: AuthClient) =>
	useMutation(client.signIn.email);

export const useSignOut = (client: AuthClient) => useMutation(client.signOut);

export const useSignUp = (client: AuthClient) =>
	useMutation(client.signUp.email);
