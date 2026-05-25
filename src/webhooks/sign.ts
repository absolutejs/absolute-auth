import { constantTimeEqual } from '../crypto';

const textEncoder = new TextEncoder();

const importHmacKey = (secret: string) =>
	crypto.subtle.importKey(
		'raw',
		textEncoder.encode(secret),
		{ hash: 'SHA-256', name: 'HMAC' },
		false,
		['sign']
	);

// Standard Webhooks (standardwebhooks.com) signature over `${id}.${timestamp}.${payload}`,
// base64-encoded and prefixed `v1,`. The same scheme Svix and others use, so receivers can verify
// with any compatible library.
export const signWebhook = async ({
	id,
	payload,
	secret,
	timestamp
}: {
	id: string;
	payload: string;
	secret: string;
	timestamp: string;
}) => {
	const key = await importHmacKey(secret);
	const signature = await crypto.subtle.sign(
		'HMAC',
		key,
		textEncoder.encode(`${id}.${timestamp}.${payload}`)
	);

	return `v1,${Buffer.from(new Uint8Array(signature)).toString('base64')}`;
};

// Verify a received webhook from its `webhook-id` / `webhook-timestamp` / `webhook-signature`
// headers (the signature header may carry several space-separated values during secret rotation).
export const verifyWebhookSignature = async ({
	headers,
	payload,
	secret
}: {
	headers: Record<string, string | undefined>;
	payload: string;
	secret: string;
}) => {
	const id = headers['webhook-id'];
	const timestamp = headers['webhook-timestamp'];
	const header = headers['webhook-signature'];
	if (id === undefined || timestamp === undefined || header === undefined) {
		return false;
	}

	const expected = await signWebhook({ id, payload, secret, timestamp });
	const matches = await Promise.all(
		header
			.split(' ')
			.map((candidate) => constantTimeEqual(candidate, expected))
	);

	return matches.includes(true);
};
