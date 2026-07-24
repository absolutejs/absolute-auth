// Thin React hooks over `createAuthClient`. Same `{ data, error }` shape; the hook adds
// `isPending` state and a stable mutator. Bring your own form/UI — these are primitives, not
// components. Composables (Vue/Solid/Svelte) will follow the same pattern over the same client.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthClient, AuthClientError } from './createAuthClient';
import {
	runConditionalAuthentication,
	runPasskeyRegistration
} from './passkeyHelpers';

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
export const usePasskeyAutofill = (client: AuthClient) => {
	const [data, setData] = useState<{ status: 'authenticated' } | null>(null);
	const [error, setError] = useState<AuthClientError | null>(null);
	const [isPending, setIsPending] = useState(false);
	const mountedRef = useRef(true);
	useEffect(
		() => () => {
			mountedRef.current = false;
		},
		[]
	);

	const start = useCallback(async () => {
		setIsPending(true);
		setError(null);
		const result = await runConditionalAuthentication(client);
		if (mountedRef.current) {
			setData(result.data);
			setError(result.error);
			setIsPending(false);
		}
	}, [client]);

	const cancel = useCallback(() => {
		// startAuthentication doesn't expose an AbortController in @simplewebauthn/browser;
		// best-effort cancel is to clear the pending flag. The Promise will still resolve
		// when the browser autofill dismisses; mountedRef gates the result write.
		setIsPending(false);
	}, []);

	return { cancel, data, error, isPending, start };
};
export const usePasswordReset = (client: AuthClient) =>
	useMutation(client.passwordReset.request);
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
export const useUpgradeToPasskey = (client: AuthClient) => {
	const [passkeys, setPasskeys] = useState<unknown[] | null>(null);
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
		const result = await client.passkeys.list();
		if (mountedRef.current) {
			setPasskeys(result.data);
			setError(result.error);
			setIsPending(false);
		}
	}, [client]);

	useEffect(() => {
		void refetch();
	}, [refetch]);

	const register = useCallback(async () => {
		const result = await runPasskeyRegistration(client);
		if (result.error === null) await refetch();

		return result;
	}, [client, refetch]);

	const shouldPrompt = passkeys !== null && passkeys.length === 0;

	return { error, isPending, passkeys, refetch, register, shouldPrompt };
};

// Drop-in headless components — minimal default markup, fully
// restyleable via the `classNames` prop. Every element carries a
// `data-abs-auth=…` attribute the consumer can target from CSS. Useful
// when migrating off Clerk's `<UserButton />` / `<SignIn />`: pass
// `classNames` to match your existing visual treatment, drop the
// vendor dep.
export { SignIn, type SignInProps } from './components/react/SignIn';
export { SignUp, type SignUpProps } from './components/react/SignUp';
export {
	UserButton,
	type UserButtonItem,
	type UserButtonProps,
	type UserButtonUser
} from './components/react/UserButton';
