const SESSION_COOKIE_NAME = 'user_session_id';

// Anchored to a real cookie boundary (start-of-header or after a "; "
// separator) so a decoy cookie like `xuser_session_id=FORGED` cannot shadow the
// genuine `user_session_id`. An unanchored `user_session_id=([^;]+)` would match
// that substring and hand back the forged value.
const SESSION_COOKIE_PATTERN = new RegExp(
	`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]*)`
);

/**
 * Read the raw `user_session_id` cookie value from a request's Cookie header.
 * Returns the (URL-decoded) value, or null when absent. Anchored so decoy
 * cookies cannot shadow the real one. Validate the result with `isUserSessionId`
 * before trusting it — this only parses, it does not vouch for the format.
 *
 * Use this instead of hand-rolling a Cookie-header regex in each consumer, so
 * the anchoring lives in exactly one place.
 */
export const readSessionCookie = (request: Request) => {
	const header = request.headers.get('cookie');
	if (header === null) return null;
	const match = header.match(SESSION_COOKIE_PATTERN);
	const value = match?.[1];
	if (value === undefined) return null;
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};
