/** Stable purposes let providers apply separate templates, limits, and audit policy. */
export type VerificationPurpose =
	| 'account_recovery'
	| 'mfa_challenge'
	| 'mfa_enrollment'
	| 'phone_change'
	| 'phone_signup'
	| 'step_up';

export type VerificationChannel = 'call' | 'sms' | 'whatsapp';

export type VerificationStartInput = {
	channel: VerificationChannel;
	/** Optional BCP-47 locale used for provider-managed message copy. */
	locale?: string;
	purpose: VerificationPurpose;
	/** Provider-specific, non-secret rate-limit buckets (for example an IP hash). */
	rateLimits?: Readonly<Record<string, string>>;
	/** Stable application subject. Providers must not include it in message text. */
	subject: string;
	/** E.164 destination. */
	to: string;
	/** Stable tenant key used only for provider/service routing. */
	tenant?: string;
};

export type VerificationStartResult = {
	/** Provider reference safe for audit correlation (for example, a Twilio VE SID). */
	reference: string;
	/** Provider-authoritative expiry. Auth rejects checks after this time. */
	expiresAt: number;
};

export type VerificationCheckStatus =
	| 'approved'
	| 'canceled'
	| 'expired'
	| 'failed'
	| 'max_attempts_reached'
	| 'pending';

export type VerificationCheckInput = VerificationStartInput & {
	code: string;
	/** Exact challenge reference returned by start(). */
	reference: string;
};

export type VerificationCancelInput = VerificationStartInput & {
	reference: string;
};

export type VerificationCheckResult = {
	reference?: string;
	status: VerificationCheckStatus;
};

export type VerificationProviderErrorKind =
	| 'invalid_destination'
	| 'rate_limited'
	| 'unavailable';

/** Normalized operational failures that auth routes can map safely to HTTP. */
export class VerificationProviderError extends Error {
	readonly kind: VerificationProviderErrorKind;
	readonly provider: string;

	constructor(input: {
		cause?: unknown;
		kind: VerificationProviderErrorKind;
		message: string;
		provider: string;
	}) {
		super(input.message, { cause: input.cause });
		this.name = 'VerificationProviderError';
		this.kind = input.kind;
		this.provider = input.provider;
	}
}

/**
 * Provider-owned out-of-band challenge lifecycle. Implementations generate,
 * deliver, rate-limit, and check codes; auth owns enrollment and session policy.
 */
export type VerificationProvider = {
	readonly name: string;
	cancel: (input: VerificationCancelInput) => Promise<void>;
	check: (input: VerificationCheckInput) => Promise<VerificationCheckResult>;
	start: (input: VerificationStartInput) => Promise<VerificationStartResult>;
};
