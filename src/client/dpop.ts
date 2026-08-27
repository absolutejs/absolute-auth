const encoder = new TextEncoder();
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const MILLISECONDS_PER_SECOND = 1000;

const base64Url = (bytes: Uint8Array) => {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);

	return btoa(binary)
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/u, '');
};

const encodeJson = (value: unknown) =>
	base64Url(encoder.encode(JSON.stringify(value)));

const normalizeHtu = (input: string | URL) => {
	const url = new URL(input);
	if (url.username || url.password)
		throw new Error('DPoP request URLs cannot contain credentials');

	return `${url.origin}${url.pathname}`;
};

const accessTokenHash = async (accessToken: string) =>
	base64Url(
		new Uint8Array(
			await crypto.subtle.digest('SHA-256', encoder.encode(accessToken))
		)
	);

export type DpopKey = {
	privateKey: CryptoKey;
	publicJwk: JsonWebKey;
};

export type CreateDpopProofInput = {
	accessToken?: string;
	htm: string;
	htu: string | URL;
	jti?: string;
	key: DpopKey;
	nonce?: string;
	now?: number;
};

export type DpopRequestInit = RequestInit & {
	dpop?: {
		accessToken?: string;
		nonceScope?: string;
	};
};

export type DpopClient = {
	fetch: (
		input: RequestInfo | URL,
		init?: DpopRequestInit
	) => Promise<Response>;
	key: DpopKey;
};

export type DpopFetch = (
	input: RequestInfo | URL,
	init?: RequestInit
) => Promise<Response>;

const createDpopKey = async () => {
	const pair = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign', 'verify']
	);
	if (!('privateKey' in pair))
		throw new Error('WebCrypto did not produce a DPoP key pair');
	const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
	if (
		publicJwk.kty !== 'EC' ||
		publicJwk.crv !== 'P-256' ||
		!publicJwk.x ||
		!publicJwk.y ||
		publicJwk.d !== undefined
	)
		throw new Error('WebCrypto produced an invalid public DPoP key');

	return Object.freeze({ privateKey: pair.privateKey, publicJwk });
};

const createDpopProof = async ({
	accessToken,
	htm,
	htu,
	jti = crypto.randomUUID(),
	key,
	nonce,
	now = Date.now()
}: CreateDpopProofInput) => {
	const header = encodeJson({
		alg: 'ES256',
		jwk: key.publicJwk,
		typ: 'dpop+jwt'
	});
	const payload = encodeJson({
		...(accessToken === undefined
			? {}
			: { ath: await accessTokenHash(accessToken) }),
		htm: htm.toUpperCase(),
		htu: normalizeHtu(htu),
		iat: Math.floor(now / MILLISECONDS_PER_SECOND),
		jti,
		...(nonce === undefined ? {} : { nonce })
	});
	const signingInput = `${header}.${payload}`;
	const signature = await crypto.subtle.sign(
		{ hash: 'SHA-256', name: 'ECDSA' },
		key.privateKey,
		encoder.encode(signingInput)
	);

	return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
};

const createDpopClient = async (options?: {
	fetch?: DpopFetch;
	key?: DpopKey;
}) => {
	const requestFetch = options?.fetch ?? globalThis.fetch;
	const key = options?.key ?? (await createDpopKey());
	const nonces = new Map<string, string>();

	const client: DpopClient = Object.freeze({
		key,
		fetch: async (input: RequestInfo | URL, init: DpopRequestInit = {}) => {
			const { dpop, ...requestInit } = init;
			const template = new Request(input, requestInit);
			const htu = normalizeHtu(template.url);
			const nonceScope = dpop?.nonceScope ?? htu;
			const perform = async (nonce: string | undefined) => {
				const headers = new Headers(template.headers);
				headers.set(
					'DPoP',
					await createDpopProof({
						accessToken: dpop?.accessToken,
						htm: template.method,
						htu,
						key,
						nonce
					})
				);
				if (dpop?.accessToken)
					headers.set('Authorization', `DPoP ${dpop.accessToken}`);
				const response = await requestFetch(
					new Request(template.clone(), {
						headers,
						redirect: 'manual'
					})
				);
				const nextNonce =
					response.headers.get('dpop-nonce') ?? undefined;
				if (nextNonce) nonces.set(nonceScope, nextNonce);
				const challenged =
					response.status === HTTP_BAD_REQUEST ||
					response.status === HTTP_UNAUTHORIZED;

				return { challenged, nextNonce, response };
			};
			const firstNonce = nonces.get(nonceScope);
			const first = await perform(firstNonce);
			if (
				!first.challenged ||
				!first.nextNonce ||
				first.nextNonce === firstNonce
			)
				return first.response;

			return (await perform(first.nextNonce)).response;
		}
	});

	return client;
};

export { createDpopClient, createDpopKey, createDpopProof };
