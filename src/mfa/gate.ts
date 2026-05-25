import type { MfaConfig } from './config';
import { isMfaEnrolled } from './types';

// Builds the `isMfaRequired` predicate the credential/OAuth login flows consult, from
// the MFAStore enrollment state. `auth()` wires this into `credentials` automatically.
export const createMfaGate =
	<UserType>({ getUserId, mfaStore }: MfaConfig<UserType>) =>
	async (user: UserType) =>
		isMfaEnrolled(await mfaStore.getEnrollment(getUserId(user)));
