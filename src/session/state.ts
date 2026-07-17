import { Elysia } from 'elysia';
import type {
	InternalSessionRecord,
	InternalUnregisteredSessionRecord
} from './internalData';

export const sessionStore = <UserType>() => {
	const initialSession: InternalSessionRecord<UserType> = {};
	const initialUnregisteredSession: InternalUnregisteredSessionRecord = {};

	return new Elysia({ name: 'sessionStore' }).state({
		session: initialSession,
		unregisteredSession: initialUnregisteredSession
	});
};
