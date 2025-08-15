import { Elysia } from 'elysia';
import { SessionRecord, UnregisteredSessionRecord } from './types';

export const sessionStore = <UserType>() => {
	const initialSession: SessionRecord<UserType> = {};
	const initialUnregisteredSession: UnregisteredSessionRecord = {};

	return new Elysia({ name: 'sessionStore' }).state({
		session: initialSession,
		unregisteredSession: initialUnregisteredSession
	});
};
