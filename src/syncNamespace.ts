const base64Url = (value: Uint8Array) => {
	let binary = '';
	for (const byte of value) binary += String.fromCharCode(byte);

	return btoa(binary)
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/u, '');
};

/** Derive a non-reversible local Sync partition without persisting user PII. */
export const deriveAuthSyncNamespace = async ({
	clientId,
	digestSha256 = async (value) =>
		new Uint8Array(
			await crypto.subtle.digest('SHA-256', new Uint8Array(value))
		),
	issuer,
	partition,
	subject
}: {
	clientId: string;
	digestSha256?: (value: Uint8Array) => Promise<Uint8Array>;
	issuer: string;
	partition?: string;
	subject: string;
}) => {
	if (clientId.length === 0 || issuer.length === 0 || subject.length === 0)
		throw new TypeError(
			'Auth Sync namespace requires issuer, clientId, and subject.'
		);
	const digest = await digestSha256(
		new TextEncoder().encode(
			JSON.stringify([issuer, clientId, subject, partition ?? null])
		)
	);

	return `auth:v1:${base64Url(digest)}`;
};

export const readAuthSyncPartition = (user: unknown) => {
	if (typeof user !== 'object' || user === null) return undefined;
	const value = Reflect.get(user, 'absolutejs_sync_partition');

	return typeof value === 'string' && value.length > 0 ? value : undefined;
};
