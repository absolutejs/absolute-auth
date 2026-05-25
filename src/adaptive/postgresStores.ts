import { and, desc, eq } from 'drizzle-orm';
import {
	bigint,
	boolean,
	doublePrecision,
	pgTable,
	primaryKey,
	varchar
} from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type {
	KnownDevice,
	KnownDeviceStore,
	LoginAttempt,
	LoginHistoryStore
} from './types';

const ID_LENGTH = 255;

export const knownDevicesTable = pgTable(
	'auth_known_devices',
	{
		device_id: varchar('device_id', { length: ID_LENGTH }).notNull(),
		first_seen_at_ms: bigint('first_seen_at_ms', {
			mode: 'number'
		}).notNull(),
		label: varchar('label', { length: ID_LENGTH }),
		last_seen_at_ms: bigint('last_seen_at_ms', { mode: 'number' }).notNull(),
		trusted: boolean('trusted').notNull().default(false),
		user_id: varchar('user_id', { length: ID_LENGTH }).notNull()
	},
	(table) => [primaryKey({ columns: [table.user_id, table.device_id] })]
);

export const loginHistoryTable = pgTable('auth_login_history', {
	attempt_id: varchar('attempt_id', { length: ID_LENGTH }).primaryKey(),
	country: varchar('country', { length: ID_LENGTH }),
	device_id: varchar('device_id', { length: ID_LENGTH }).notNull(),
	ip_address: varchar('ip_address', { length: ID_LENGTH }),
	latitude: doublePrecision('latitude'),
	longitude: doublePrecision('longitude'),
	outcome: varchar('outcome', { length: ID_LENGTH }).notNull(),
	timestamp_ms: bigint('timestamp_ms', { mode: 'number' }).notNull(),
	user_id: varchar('user_id', { length: ID_LENGTH }).notNull()
});

type KnownDeviceRow = typeof knownDevicesTable.$inferSelect;
type LoginAttemptRow = typeof loginHistoryTable.$inferSelect;

const toRiskAction = (value: string) => {
	if (value === 'deny') return 'deny';
	if (value === 'step_up') return 'step_up';

	return 'allow';
};

const toDevice = (row: KnownDeviceRow): KnownDevice => ({
	deviceId: row.device_id,
	firstSeenAt: row.first_seen_at_ms,
	label: row.label ?? undefined,
	lastSeenAt: row.last_seen_at_ms,
	trusted: row.trusted,
	userId: row.user_id
});

const toDeviceValues = (
	device: KnownDevice
): typeof knownDevicesTable.$inferInsert => ({
	device_id: device.deviceId,
	first_seen_at_ms: device.firstSeenAt,
	label: device.label ?? null,
	last_seen_at_ms: device.lastSeenAt,
	trusted: device.trusted,
	user_id: device.userId
});

const toAttempt = (row: LoginAttemptRow): LoginAttempt => ({
	attemptId: row.attempt_id,
	country: row.country ?? undefined,
	deviceId: row.device_id,
	ipAddress: row.ip_address ?? undefined,
	latitude: row.latitude ?? undefined,
	longitude: row.longitude ?? undefined,
	outcome: toRiskAction(row.outcome),
	timestamp: row.timestamp_ms,
	userId: row.user_id
});

const toAttemptValues = (
	attempt: LoginAttempt
): typeof loginHistoryTable.$inferInsert => ({
	attempt_id: attempt.attemptId,
	country: attempt.country ?? null,
	device_id: attempt.deviceId,
	ip_address: attempt.ipAddress ?? null,
	latitude: attempt.latitude ?? null,
	longitude: attempt.longitude ?? null,
	outcome: attempt.outcome,
	timestamp_ms: attempt.timestamp,
	user_id: attempt.userId
});

export const createNeonKnownDeviceStore = (databaseUrl: string) =>
	createPostgresKnownDeviceStore(createNeonDatabase(databaseUrl));
export const createNeonLoginHistoryStore = (databaseUrl: string) =>
	createPostgresLoginHistoryStore(createNeonDatabase(databaseUrl));
export const createPostgresKnownDeviceStore = (
	db: AnyPgDatabase
): KnownDeviceStore => ({
	findDevice: async (userId, deviceId) => {
		const [row] = await db
			.select()
			.from(knownDevicesTable)
			.where(
				and(
					eq(knownDevicesTable.user_id, userId),
					eq(knownDevicesTable.device_id, deviceId)
				)
			)
			.limit(1);

		return row ? toDevice(row) : undefined;
	},
	listDevices: async (userId) => {
		const rows = await db
			.select()
			.from(knownDevicesTable)
			.where(eq(knownDevicesTable.user_id, userId))
			.orderBy(desc(knownDevicesTable.last_seen_at_ms));

		return rows.map(toDevice);
	},
	saveDevice: async (device) => {
		const values = toDeviceValues(device);
		await db
			.insert(knownDevicesTable)
			.values(values)
			.onConflictDoUpdate({
				set: values,
				target: [knownDevicesTable.user_id, knownDevicesTable.device_id]
			});
	}
});
export const createPostgresLoginHistoryStore = (
	db: AnyPgDatabase
): LoginHistoryStore => ({
	listRecent: async (userId, limit) => {
		const rows = await db
			.select()
			.from(loginHistoryTable)
			.where(eq(loginHistoryTable.user_id, userId))
			.orderBy(desc(loginHistoryTable.timestamp_ms))
			.limit(limit);

		return rows.map(toAttempt);
	},
	recordAttempt: async (attempt) => {
		await db.insert(loginHistoryTable).values(toAttemptValues(attempt));
	}
});
