import Elysia from 'elysia';
import type { SessionRecord } from './types';

export const sessionStore = <UserType>() => {
	return new Elysia({ name: 'sessionStore' }).state({
		session: {} as SessionRecord<UserType>
	});
};
