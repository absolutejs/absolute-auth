import Elysia from 'elysia';
import { SessionRecord } from './types';

export const sessionStore = <UserType>() => {
	return new Elysia({ name: 'sessionStore' }).state({
		session: {} as SessionRecord<UserType>
	});
};
