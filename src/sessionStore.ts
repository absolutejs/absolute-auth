import { Elysia } from 'elysia';
import { SessionRecord } from './types';

export const sessionStore = <UserType>() => {
	const initialSession: SessionRecord<UserType> = {};

	return new Elysia({ name: 'sessionStore' }).state({
		session: initialSession
	});
};
