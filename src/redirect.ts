// A value is a safe SAME-ORIGIN redirect target iff it begins with a single
// '/' that is NOT followed by '/' or '\'. Browsers normalize backslashes to
// forward slashes, so '/\evil.com' (and '/\\evil.com') resolve to the
// protocol-relative '//evil.com' — an open redirect. Absolute URLs,
// protocol-relative '//…', and backslash-prefixed paths are all rejected.
export const isSafeLocalPath = (value: string) => /^\/(?![/\\])/.test(value);

// Reduce an untrusted post-login redirect target to a safe same-origin path,
// falling back to `fallback` (default '/') when it is not one.
export const toSafeLocalPath = (value: string | undefined, fallback = '/') =>
	value !== undefined && isSafeLocalPath(value) ? value : fallback;
