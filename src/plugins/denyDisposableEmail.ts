// Tiny wrapper around the existing `isDisposableEmail` so it slots into the
// CredentialsConfig.onCreateCredentialUser hook chain. Composes with whatever else the
// consumer is doing in onCreateCredentialUser — call this first, fall through on pass.
//
// ~10 lines; mostly here as a concrete demonstration that "plugin" = "named function".

import { isDisposableEmail } from '../credentials/emailValidation';

export type DenyDisposableEmailDecision =
	| { allow: false; reason: string }
	| { allow: true };

export const denyDisposableEmailPlugin = async (
	email: string
): Promise<DenyDisposableEmailDecision> => {
	const trimmed = email.trim().toLowerCase();
	if (await isDisposableEmail(trimmed)) {
		return { allow: false, reason: 'disposable_email' };
	}

	return { allow: true };
};
