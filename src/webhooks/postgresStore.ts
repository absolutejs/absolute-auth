import { desc, eq } from 'drizzle-orm';
import { bigint, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type {
	WebhookDelivery,
	WebhookDeliveryStore,
	WebhookEvent
} from './types';

const ID_LENGTH = 255;
const URL_LENGTH = 2048;
const DEFAULT_LIST_LIMIT = 100;

export const webhookDeliveriesTable = pgTable('auth_webhook_deliveries', {
	attempts: bigint('attempts', { mode: 'number' }).notNull(),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	endpoint_url: varchar('endpoint_url', { length: URL_LENGTH }).notNull(),
	envelope_id: varchar('envelope_id', { length: ID_LENGTH }).primaryKey(),
	envelope_json: jsonb('envelope_json').$type<WebhookEvent>().notNull(),
	last_error: text('last_error'),
	last_status: bigint('last_status', { mode: 'number' })
});

type DeliveryRow = typeof webhookDeliveriesTable.$inferSelect;

const toDelivery = (row: DeliveryRow): WebhookDelivery => ({
	attempts: row.attempts,
	createdAt: row.created_at_ms,
	endpointUrl: row.endpoint_url,
	envelope: row.envelope_json,
	lastError: row.last_error ?? undefined,
	lastStatus: row.last_status ?? undefined
});

export const createNeonWebhookDeliveryStore = (databaseUrl: string) =>
	createPostgresWebhookDeliveryStore(createNeonDatabase(databaseUrl));

export const createPostgresWebhookDeliveryStore = <DB extends AnyPgDatabase>(
	db: DB
): WebhookDeliveryStore => ({
	listFailed: async (limit = DEFAULT_LIST_LIMIT) => {
		const rows = await db
			.select()
			.from(webhookDeliveriesTable)
			.orderBy(desc(webhookDeliveriesTable.created_at_ms))
			.limit(limit);

		return rows.map(toDelivery);
	},
	recordFailure: async (delivery) => {
		await db.insert(webhookDeliveriesTable).values({
			attempts: delivery.attempts,
			created_at_ms: delivery.createdAt,
			endpoint_url: delivery.endpointUrl,
			envelope_id: delivery.envelope.id,
			envelope_json: delivery.envelope,
			last_error: delivery.lastError ?? null,
			last_status: delivery.lastStatus ?? null
		});
	},
	removeFailure: async (envelopeId) => {
		await db
			.delete(webhookDeliveriesTable)
			.where(eq(webhookDeliveriesTable.envelope_id, envelopeId));
	}
});
