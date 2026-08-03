import { describe, expect, test } from 'bun:test';
import { readSessionCookie } from '../src/session/cookieReader';

const req = (cookie?: string) =>
	new Request(
		'http://localhost/',
		cookie === undefined ? {} : { headers: { cookie } }
	);

describe('readSessionCookie is anchored (no decoy shadowing)', () => {
	test('reads the real cookie at start or after a separator', () => {
		expect(readSessionCookie(req('user_session_id=real'))).toBe('real');
		expect(readSessionCookie(req('foo=bar; user_session_id=real'))).toBe(
			'real'
		);
		expect(readSessionCookie(req('foo=bar;user_session_id=real'))).toBe(
			'real'
		);
	});

	test('a decoy cookie cannot shadow the real one', () => {
		// The exact bug an unanchored /user_session_id=([^;]+)/ has:
		expect(readSessionCookie(req('xuser_session_id=FORGED'))).toBeNull();
		expect(
			readSessionCookie(
				req('xuser_session_id=FORGED; user_session_id=real')
			)
		).toBe('real');
		// The name appearing inside another cookie's value must not match.
		expect(readSessionCookie(req('foo=user_session_id=bar'))).toBeNull();
	});

	test('absent cookie → null', () => {
		expect(readSessionCookie(req())).toBeNull();
		expect(readSessionCookie(req('other=1'))).toBeNull();
	});

	test('URL-decodes the value', () => {
		expect(readSessionCookie(req('user_session_id=a%20b'))).toBe('a b');
	});
});
