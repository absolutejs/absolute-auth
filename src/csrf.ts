// Origin-based CSRF check for state-changing requests (login, register, etc.).
// Returns true when the request's Origin header is in `trustedOrigins`. With no
// configured origins the check is a no-op (returns true) so it stays opt-in —
// pass `trustedOrigins` to enforce it. A missing Origin header on a configured
// route is treated as untrusted (returns false), since browsers send Origin on
// cross-site and same-origin POSTs.
export const isTrustedOrigin = (
	request: Request,
	trustedOrigins?: readonly string[]
) => {
	if (trustedOrigins === undefined || trustedOrigins.length === 0) {
		return true;
	}
	const origin = request.headers.get('origin');

	return origin !== null && trustedOrigins.includes(origin);
};
