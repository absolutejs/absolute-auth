/** Shared browser/server policy values; this module has no runtime dependencies. */
export const MAX_IMPERSONATION_REASON_LENGTH = 500;
export const MIN_IMPERSONATION_REASON_LENGTH = 10;
export type ImpersonationMode = 'ghost' | 'sandbox' | 'live';
