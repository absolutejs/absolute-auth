export const isRecentAuthenticationRequired = (error: unknown) =>
	typeof error === 'object' &&
	error !== null &&
	Reflect.get(error, 'status') === 401 &&
	Reflect.get(error, 'code') === 'reauthentication_required';
/** Stable contract for step-up authentication; a valid session may still need verification. */
export const recentAuthenticationRequired = () => ({
	code: 'reauthentication_required' as const,
	message: 'Recent authentication required' as const
});
