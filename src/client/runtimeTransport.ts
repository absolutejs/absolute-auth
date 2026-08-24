import type { AuthClientTransport } from './createAuthClient';

type AuthTransportInstallation = { transport: AuthClientTransport };
type AuthTransportRegistry = { installations: AuthTransportInstallation[] };

const AUTH_TRANSPORT_REGISTRY = Symbol.for(
	'@absolutejs/auth/client-runtime-transport'
);
const host = globalThis as { [key: symbol]: unknown };
const isRegistry = (value: unknown): value is AuthTransportRegistry =>
	typeof value === 'object' &&
	value !== null &&
	Array.isArray(Reflect.get(value, 'installations'));

const registry = (() => {
	const existing = host[AUTH_TRANSPORT_REGISTRY];
	if (isRegistry(existing)) return existing;
	const created: AuthTransportRegistry = { installations: [] };
	Object.defineProperty(host, AUTH_TRANSPORT_REGISTRY, {
		configurable: false,
		enumerable: false,
		value: created,
		writable: false
	});

	return created;
})();

export const getAuthClientRuntimeTransport = () =>
	registry.installations.at(-1)?.transport;

export const installAuthClientRuntimeTransport = (
	transport: AuthClientTransport
) => {
	const installation = { transport };
	registry.installations.push(installation);

	return () => {
		const index = registry.installations.indexOf(installation);
		if (index >= 0) registry.installations.splice(index, 1);
	};
};
