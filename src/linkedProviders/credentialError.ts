/** Safe recovery information; raw provider responses stay in the cause. */
export class LinkedProviderCredentialError extends Error {
	constructor(
		readonly code: string,
		readonly recovery: 'reconnect' | 'retry' | 'configuration',
		message: string,
		cause?: unknown
	) {
		super(message, { cause });
		this.name = 'LinkedProviderCredentialError';
	}
}

export const credentialRefreshError = (error: unknown) => {
	if (error instanceof LinkedProviderCredentialError) return error;
	const message = error instanceof Error ? error.message : '';
	if (/\binvalid_grant\b/.test(message)) {
		return new LinkedProviderCredentialError(
			'invalid_grant',
			'reconnect',
			'Authorization has expired or was revoked. Reconnect your account.',
			error
		);
	}
	if (/\b(invalid_client|unauthorized_client)\b/.test(message)) {
		return new LinkedProviderCredentialError(
			'invalid_client',
			'configuration',
			'The provider connection is misconfigured. Contact support.',
			error
		);
	}

	return new LinkedProviderCredentialError(
		'refresh_failed',
		'retry',
		'The provider could not refresh the connection. Try again.',
		error
	);
};
