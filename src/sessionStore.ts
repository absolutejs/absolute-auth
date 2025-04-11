import { Elysia } from 'elysia';
import { SessionRecord } from './types';

export const sessionStore = <UserType>() => {
	const initialSession: SessionRecord<UserType> = {};

	return new Elysia({ name: 'sessionStore' }).state({
		session: initialSession
	});
};

// TODO: Im pretty sure theres a way to give the type to the session store without setting an initial state
