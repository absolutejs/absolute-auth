import type { AuthClientTransport } from './createAuthClient';

type AuthTransportInstallation = { transport: AuthClientTransport };
type AuthTransportRegistry = { installations: AuthTransportInstallation[] };

const AUTH_TRANSPORT_REGISTRY = Symbol.for(
	'@absolutejs/auth/client-runtime-transport'
);
const isRegistry = (value: unknown): value is AuthTransportRegistry =>
	typeof value === 'object' &&
	value !== null &&
	Array.isArray(Reflect.get(value, 'installations'));

const createRegistry = () => {
	const existing = Reflect.get(globalThis, AUTH_TRANSPORT_REGISTRY);
	if (isRegistry(existing)) return existing;
	const created: AuthTransportRegistry = { installations: [] };
	Object.defineProperty(globalThis, AUTH_TRANSPORT_REGISTRY, {
		configurable: false,
		enumerable: false,
		value: created,
		writable: false
	});

	return created;
};

const registry = createRegistry();

export const getAuthClientRuntimeTransport = () =>
	registry.installations.at(-1)?.transport;

export const installAuthClientRuntimeTransport = (
	transport: AuthClientTransport
) => {
	const installation: AuthTransportInstallation = { transport };
	registry.installations.push(installation);

	return () => {
		const index = registry.installations.indexOf(installation);
		if (index >= 0) registry.installations.splice(index, 1);
	};
};
