import type { OAuthClient, OAuthClientStore } from './types';

export const ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV =
	'ABSOLUTE_AUTH_NATIVE_CLIENTS' as const;

export type AbsoluteNativeAuthClient = {
	clientId: string;
	issuer: string;
	name: string;
	redirectUri: string;
	scopes: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const requireText = (value: unknown, field: string) => {
	if (typeof value !== 'string' || value.trim().length === 0)
		throw new TypeError(`${field} must be a non-empty string.`);

	return value.trim();
};

const requireUrl = (value: unknown, field: string) => {
	const text = requireText(value, field);
	let url: URL;
	try {
		url = new URL(text);
	} catch (cause) {
		throw new TypeError(`${field} must be an absolute URL.`, { cause });
	}
	if (url.username || url.password)
		throw new TypeError(`${field} cannot contain credentials.`);

	return url.href;
};

const parseClient = (value: unknown, index: number): AbsoluteNativeAuthClient => {
	if (!isRecord(value))
		throw new TypeError(
			`${ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV}[${index}] must be an object.`
		);
	const { scopes } = value;
	if (
		!Array.isArray(scopes) ||
		scopes.length === 0 ||
		scopes.some(
			(scope) => typeof scope !== 'string' || scope.trim().length === 0
		)
	)
		throw new TypeError(
			`${ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV}[${index}].scopes must contain non-empty strings.`
		);

	return {
		clientId: requireText(
			value.clientId,
			`${ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV}[${index}].clientId`
		),
		issuer: requireUrl(
			value.issuer,
			`${ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV}[${index}].issuer`
		).replace(/\/$/u, ''),
		name: requireText(
			value.name,
			`${ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV}[${index}].name`
		),
		redirectUri: requireUrl(
			value.redirectUri,
			`${ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV}[${index}].redirectUri`
		),
		scopes: [...new Set(scopes.map((scope) => scope.trim()))]
	};
};

export const parseAbsoluteNativeAuthClients = (
	source = process.env[ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV]
) => {
	if (source === undefined || source.trim().length === 0) return [];
	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch (cause) {
		throw new TypeError(
			`${ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV} must contain JSON.`,
			{ cause }
		);
	}
	if (!Array.isArray(value))
		throw new TypeError(
			`${ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV} must contain an array.`
		);
	const clients = value.map(parseClient);
	if (new Set(clients.map(({ clientId }) => clientId)).size !== clients.length)
		throw new TypeError(
			`${ABSOLUTE_NATIVE_AUTH_CLIENTS_ENV} contains duplicate clientId values.`
		);

	return clients;
};

export const withAbsoluteNativeAuthClients = (
	clientStore: OAuthClientStore,
	issuer: string,
	clients = parseAbsoluteNativeAuthClients()
): OAuthClientStore => {
	const normalizedIssuer = new URL(issuer).href.replace(/\/$/u, '');
	const provisioned = new Map<string, OAuthClient>(
		clients
			.filter((client) => client.issuer === normalizedIssuer)
			.map((client) => [
				client.clientId,
				{
					clientId: client.clientId,
					name: client.name,
					redirectUris: [client.redirectUri],
					scopes: client.scopes
				}
			])
	);

	return {
		...(clientStore.deleteClient
			? { deleteClient: clientStore.deleteClient.bind(clientStore) }
			: {}),
		findClient: async (clientId) =>
			(await clientStore.findClient(clientId)) ?? provisioned.get(clientId),
		...(clientStore.saveClient
			? { saveClient: clientStore.saveClient.bind(clientStore) }
			: {}),
		...(clientStore.updateClient
			? { updateClient: clientStore.updateClient.bind(clientStore) }
			: {})
	};
};
