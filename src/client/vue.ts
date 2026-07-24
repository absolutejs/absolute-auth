// Thin Vue composables over `createAuthClient`, mirroring `./react`. Same `{ data, error,
// isPending, mutate, reset }` shape — only the reactivity is Vue's (refs + onScopeDispose).
// Bring your own form / UI; these are primitives.

import { onScopeDispose, ref, type Ref } from 'vue';
import type { AuthClient, AuthClientError } from './createAuthClient';
import {
	runConditionalAuthentication,
	runPasskeyRegistration
} from './passkeyHelpers';

type Mutator<Args, Data> = (
	args: Args
) => Promise<{ data: Data | null; error: AuthClientError | null }>;

type MutationState<Args, Data> = {
	data: Ref<Data | null>;
	error: Ref<AuthClientError | null>;
	isPending: Ref<boolean>;
	mutate: Mutator<Args, Data>;
	reset: () => void;
};

// Generic mutation composable. The exported composables are 1-2 line specializations of
// this — kept private so consumers depend on the named API, not this internal shape.
const useMutation = <Args, Data>(
	run: Mutator<Args, Data>
): MutationState<Args, Data> => {
	const data: Ref<Data | null> = ref(null);
	const error: Ref<AuthClientError | null> = ref(null);
	const isPending = ref(false);
	let alive = true;
	onScopeDispose(() => {
		alive = false;
	});

	const mutate: Mutator<Args, Data> = async (args) => {
		isPending.value = true;
		error.value = null;
		const result = await run(args);
		if (alive) {
			data.value = result.data;
			error.value = result.error;
			isPending.value = false;
		}

		return result;
	};

	const reset = () => {
		data.value = null;
		error.value = null;
		isPending.value = false;
	};

	return { data, error, isPending, mutate, reset };
};

export const useMagicLink = (client: AuthClient) =>
	useMutation(client.passwordless.requestMagicLink);
export const useMfaChallenge = (client: AuthClient) =>
	useMutation(client.mfa.challenge);
export const usePasskeyAutofill = (client: AuthClient) => {
	const data: Ref<{ status: 'authenticated' } | null> = ref(null);
	const error: Ref<AuthClientError | null> = ref(null);
	const isPending = ref(false);
	let alive = true;
	onScopeDispose(() => {
		alive = false;
	});

	const start = async () => {
		isPending.value = true;
		error.value = null;
		const result = await runConditionalAuthentication(client);
		if (alive) {
			data.value = result.data;
			error.value = result.error;
			isPending.value = false;
		}
	};

	const cancel = () => {
		isPending.value = false;
	};

	return { cancel, data, error, isPending, start };
};
export const usePasswordReset = (client: AuthClient) =>
	useMutation(client.passwordReset.request);
export const useSessions = (client: AuthClient) => {
	const data: Ref<unknown[] | null> = ref(null);
	const error: Ref<AuthClientError | null> = ref(null);
	const isPending = ref(true);
	let alive = true;
	onScopeDispose(() => {
		alive = false;
	});

	const refetch = async () => {
		isPending.value = true;
		const result = await client.sessions.list();
		if (alive) {
			data.value = result.data;
			error.value = result.error;
			isPending.value = false;
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
	const passkeys: Ref<unknown[] | null> = ref(null);
	const error: Ref<AuthClientError | null> = ref(null);
	const isPending = ref(true);
	let alive = true;
	onScopeDispose(() => {
		alive = false;
	});

	const refetch = async () => {
		isPending.value = true;
		const result = await client.passkeys.list();
		if (alive) {
			passkeys.value = result.data;
			error.value = result.error;
			isPending.value = false;
		}
	};

	const register = async () => {
		const result = await runPasskeyRegistration(client);
		if (result.error === null) await refetch();

		return result;
	};

	void refetch();
	const shouldPrompt = ref(false);
	const updateShouldPrompt = () => {
		shouldPrompt.value =
			passkeys.value !== null && passkeys.value.length === 0;
	};
	// Update shouldPrompt whenever the list changes via refetch/register.
	const wrappedRefetch = async () => {
		await refetch();
		updateShouldPrompt();
	};
	const wrappedRegister = async () => {
		const result = await register();
		updateShouldPrompt();

		return result;
	};

	return {
		error,
		isPending,
		passkeys,
		refetch: wrappedRefetch,
		register: wrappedRegister,
		shouldPrompt
	};
};
