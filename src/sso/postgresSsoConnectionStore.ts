import { and, desc, eq } from 'drizzle-orm';
import { bigint, boolean, jsonb, pgTable, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type {
	OidcConnection,
	OidcConnectionConfig,
	SamlConnection,
	SamlConnectionConfig,
	SSOConnection,
	SSOConnectionStore,
	SSOConnectionType
} from './types';

const ID_LENGTH = 255;
const TYPE_LENGTH = 16;

export const ssoConnectionsTable = pgTable('auth_sso_connections', {
	config: jsonb('config')
		.$type<OidcConnectionConfig | SamlConnectionConfig>()
		.notNull(),
	connection_id: varchar('connection_id', { length: ID_LENGTH }).primaryKey(),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	enabled: boolean('enabled').notNull().default(true),
	organization_id: varchar('organization_id', {
		length: ID_LENGTH
	}).notNull(),
	type: varchar('type', { length: TYPE_LENGTH })
		.$type<SSOConnectionType>()
		.notNull(),
	updated_at_ms: bigint('updated_at_ms', { mode: 'number' }).notNull()
});

type SsoRow = typeof ssoConnectionsTable.$inferSelect;
type SsoInsert = typeof ssoConnectionsTable.$inferInsert;

const toStringArray = (value: unknown) =>
	Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: [];

// Validate the jsonb payload back into the typed config — never trust the column blindly
// (and never `as`-cast it). Returns undefined for a malformed row.
const toOidcConfig = (value: object): OidcConnectionConfig | undefined => {
	const clientId = Reflect.get(value, 'clientId');
	const clientSecret = Reflect.get(value, 'clientSecret');
	const issuer = Reflect.get(value, 'issuer');
	const redirectUri = Reflect.get(value, 'redirectUri');
	if (
		typeof clientId !== 'string' ||
		typeof clientSecret !== 'string' ||
		typeof issuer !== 'string' ||
		typeof redirectUri !== 'string'
	) {
		return undefined;
	}

	return {
		clientId,
		clientSecret,
		issuer,
		redirectUri,
		scopes: toStringArray(Reflect.get(value, 'scopes'))
	};
};

const toSamlConfig = (value: object): SamlConnectionConfig | undefined => {
	const idpEntityId = Reflect.get(value, 'idpEntityId');
	const idpSsoUrl = Reflect.get(value, 'idpSsoUrl');
	const idpX509Cert = Reflect.get(value, 'idpX509Cert');
	if (
		typeof idpEntityId !== 'string' ||
		typeof idpSsoUrl !== 'string' ||
		typeof idpX509Cert !== 'string'
	) {
		return undefined;
	}

	const idpSloUrl = Reflect.get(value, 'idpSloUrl');

	return {
		idpEntityId,
		idpSloUrl: typeof idpSloUrl === 'string' ? idpSloUrl : undefined,
		idpSsoUrl,
		idpX509Cert
	};
};

const toConnection = (row: SsoRow) => {
	if (row.type === 'oidc') {
		const config = toOidcConfig(row.config);
		if (config === undefined) return undefined;

		const connection: OidcConnection = {
			config,
			connectionId: row.connection_id,
			createdAt: row.created_at_ms,
			enabled: row.enabled,
			organizationId: row.organization_id,
			type: 'oidc',
			updatedAt: row.updated_at_ms
		};

		return connection;
	}

	const config = toSamlConfig(row.config);
	if (config === undefined) return undefined;

	const connection: SamlConnection = {
		config,
		connectionId: row.connection_id,
		createdAt: row.created_at_ms,
		enabled: row.enabled,
		organizationId: row.organization_id,
		type: 'saml',
		updatedAt: row.updated_at_ms
	};

	return connection;
};

const toValues = (connection: SSOConnection): SsoInsert => ({
	config: connection.config,
	connection_id: connection.connectionId,
	created_at_ms: connection.createdAt,
	enabled: connection.enabled,
	organization_id: connection.organizationId,
	type: connection.type,
	updated_at_ms: connection.updatedAt
});

export const createNeonSsoConnectionStore = (databaseUrl: string) =>
	createPostgresSsoConnectionStore(createNeonDatabase(databaseUrl));

export const createPostgresSsoConnectionStore = (
	db: AnyPgDatabase
): SSOConnectionStore => ({
	deleteConnection: async (connectionId) => {
		await db
			.delete(ssoConnectionsTable)
			.where(eq(ssoConnectionsTable.connection_id, connectionId));
	},
	getConnection: async (connectionId) => {
		const [row] = await db
			.select()
			.from(ssoConnectionsTable)
			.where(eq(ssoConnectionsTable.connection_id, connectionId))
			.limit(1);

		return row ? toConnection(row) : undefined;
	},
	getConnectionByOrganization: async (organizationId, type) => {
		const [row] = await db
			.select()
			.from(ssoConnectionsTable)
			.where(
				and(
					eq(ssoConnectionsTable.organization_id, organizationId),
					eq(ssoConnectionsTable.enabled, true),
					type === undefined
						? undefined
						: eq(ssoConnectionsTable.type, type)
				)
			)
			.orderBy(desc(ssoConnectionsTable.updated_at_ms))
			.limit(1);

		return row ? toConnection(row) : undefined;
	},
	listConnectionsByOrganization: async (organizationId) => {
		const rows = await db
			.select()
			.from(ssoConnectionsTable)
			.where(eq(ssoConnectionsTable.organization_id, organizationId))
			.orderBy(desc(ssoConnectionsTable.updated_at_ms));

		return rows.flatMap((row) => {
			const connection = toConnection(row);

			return connection === undefined ? [] : [connection];
		});
	},
	saveConnection: async (connection) => {
		const values = toValues(connection);
		await db.insert(ssoConnectionsTable).values(values).onConflictDoUpdate({
			set: values,
			target: ssoConnectionsTable.connection_id
		});
	}
});
