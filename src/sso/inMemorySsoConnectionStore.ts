import type { SSOConnection, SSOConnectionStore } from './types';

const cloneConnection = (value: SSOConnection) =>
	value.type === 'oidc'
		? {
				...value,
				config: { ...value.config, scopes: [...value.config.scopes] }
			}
		: { ...value, config: { ...value.config } };

export const createInMemorySsoConnectionStore = (): SSOConnectionStore => {
	const connections = new Map<string, SSOConnection>();

	return {
		deleteConnection: async (connectionId) => {
			connections.delete(connectionId);
		},
		getConnection: async (connectionId) => {
			const connection = connections.get(connectionId);

			return connection ? cloneConnection(connection) : undefined;
		},
		getConnectionByOrganization: async (organizationId, type) => {
			const match = Array.from(connections.values()).find(
				(connection) =>
					connection.organizationId === organizationId &&
					connection.enabled &&
					(type === undefined || connection.type === type)
			);

			return match ? cloneConnection(match) : undefined;
		},
		listConnectionsByOrganization: async (organizationId) =>
			Array.from(connections.values())
				.filter(
					(connection) => connection.organizationId === organizationId
				)
				.sort((left, right) => right.updatedAt - left.updatedAt)
				.map(cloneConnection),
		saveConnection: async (connection) => {
			connections.set(
				connection.connectionId,
				cloneConnection(connection)
			);
		}
	};
};
