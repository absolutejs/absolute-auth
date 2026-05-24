import { AuthIntent } from './types';

export type AuthIdentityConflict = {
	authProvider: string;
	providerSubject: string;
	existingUserAuthSub: string;
	currentUserAuthSub?: string;
	intent?: AuthIntent;
};

export class AuthIdentityConflictError extends Error {
	conflict: AuthIdentityConflict;

	constructor(conflict: AuthIdentityConflict) {
		super(
			`${conflict.authProvider} identity ${conflict.providerSubject} is already linked to ${conflict.existingUserAuthSub}`
		);
		this.name = 'AuthIdentityConflictError';
		this.conflict = conflict;
	}
}
