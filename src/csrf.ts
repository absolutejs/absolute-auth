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

// Report-only-capable origin gate for the credential routes. Returns true when
// the request may proceed. When the Origin is not trusted it calls
// `onUntrustedOrigin` (so the integrator can log/surface it) and then blocks the
// request ONLY when `enforce` is not false — pass `enforce: false` for a
// report-only rollout that observes real Origins without locking anyone out.
export const resolveOriginAllowed = async ({
	enforce = true,
	onUntrustedOrigin,
	request,
	trustedOrigins
}: {
	enforce?: boolean;
	onUntrustedOrigin?: (context: {
		origin: string | null;
		request: Request;
	}) => void | Promise<void>;
	request: Request;
	trustedOrigins?: readonly string[];
}) => {
	if (isTrustedOrigin(request, trustedOrigins)) return true;
	await onUntrustedOrigin?.({
		origin: request.headers.get('origin'),
		request
	});

	return enforce === false;
};
