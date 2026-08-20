import { Elysia } from 'elysia';
import type { SessionRecord, UnregisteredSessionRecord } from '../types';

export const sessionStore = <UserType>(
	initialSession: SessionRecord<UserType> = {},
	initialUnregisteredSession: UnregisteredSessionRecord = {}
) =>
	new Elysia({ name: 'sessionStore' }).state({
		session: initialSession,
		unregisteredSession: initialUnregisteredSession
	});
