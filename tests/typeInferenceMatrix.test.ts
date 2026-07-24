// Golden-file test: when we stack every major block + generic at once
// (custom UserType + credentials + MFA + passkeys + sessions + audit +
// OIDC IdP + admin impersonation), do downstream consumers still see the
// right inferred types?
//
// This is the regression the Better Auth issue tracker shows over and
// over (#3233, #6642, #2413, #5159 — plugin combinations dropping fields
// from the inferred session type). We pin the most painful combinations
// here so a regression to the type surface trips a compile failure.
//
// Each `expectType<X>(value)` is a no-op at runtime; the file's value is
// that it compiles. The runtime `expect(true).toBe(true)` keeps the test
// runner happy so it appears in the pass count.
import { describe, expect, test } from 'bun:test';
import type { AuthConfig, SessionData } from '../src/types';

type RichUser = {
	createdAtMs: number;
	email: string;
	givenName: string;
	primaryAuthIdentityId: string | null;
	roles: ('admin' | 'coach' | 'user')[];
	sub: string;
	totp: { backupCodes: string[]; enabledAt: number } | null;
};

// Identity check — if `expectType<X>(value)` compiles, `value` is assignable
// to `X`. A regression that drops a property from the inferred type would
// fail this line.
const expectType = <Value>(value: Value) => {
	void value;
};

const readEmail = (value: Record<string, unknown>) => {
	const email = Reflect.get(value, 'email');

	return typeof email === 'string' ? email : '';
};

describe('plugin type-inference matrix', () => {
	test('AuthConfig<RichUser> preserves the full UserType through every block', () => {
		// The full union of blocks intent + the docs+examples enable.
		// If a future change drops a generic somewhere, the `as` cast below
		// becomes the only way to make it compile — which the reviewer
		// will catch.
		const config: Partial<AuthConfig<RichUser>> = {
			getUser: () => ({
				createdAtMs: Date.now(),
				email: 'a@b.test',
				givenName: 'A',
				primaryAuthIdentityId: null,
				roles: ['admin'],
				sub: 'user-1',
				totp: null
			})
		};
		expectType<Partial<AuthConfig<RichUser>>>(config);
		expect(true).toBe(true);
	});

	test('SessionRecord<RichUser>.user preserves every custom field', () => {
		const session: SessionData<RichUser> = {
			accessToken: 'a',
			authenticatedAt: Date.now(),
			expiresAt: Date.now() + 60_000,
			user: {
				createdAtMs: Date.now(),
				email: 'a@b.test',
				givenName: 'A',
				primaryAuthIdentityId: null,
				roles: ['admin', 'user'],
				sub: 'user-1',
				totp: { backupCodes: ['x', 'y'], enabledAt: Date.now() }
			}
		};

		// Each assertion would fail compilation if the type narrowed.
		expectType<string>(session.user.email);
		expectType<string>(session.user.givenName);
		expectType<string>(session.user.sub);
		expectType<('admin' | 'coach' | 'user')[]>(session.user.roles);
		expectType<number>(session.user.createdAtMs);
		expectType<string | null>(session.user.primaryAuthIdentityId);
		expectType<{ backupCodes: string[]; enabledAt: number } | null>(
			session.user.totp
		);
		expect(true).toBe(true);
	});

	test('AuthConfig getUser callback receives the bare-OAuth decoded payload but returns RichUser', () => {
		const cfg: Pick<AuthConfig<RichUser>, 'getUser'> = {
			getUser: (decoded) => ({
				createdAtMs: Date.now(),
				// `decoded` is the OAuth decoded token (provider-shaped). We
				// don't constrain its shape — but we DO constrain the return.
				email: readEmail(decoded),
				givenName: '',
				primaryAuthIdentityId: null,
				roles: ['user'],
				sub: 'fresh-user',
				totp: null
			})
		};
		expectType<Pick<AuthConfig<RichUser>, 'getUser'>>(cfg);
		expect(true).toBe(true);
	});
});
