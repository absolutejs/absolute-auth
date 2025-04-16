import { Cookie } from 'elysia';
import { AbsoluteAuthProps, CreateUser, GetUser, SessionRecord } from './types';
type InsantiateUserSessionProps<UserType> = {
    authProvider: string;
    decodedIdToken: {
        [key: string]: string | undefined;
    };
    session: SessionRecord<UserType>;
    user_session_id: Cookie<string | undefined>;
    createUser?: CreateUser<UserType>;
    getUser?: GetUser<UserType>;
};
export declare const instantiateUserSession: <UserType>({ authProvider, decodedIdToken, user_session_id, session, getUser, createUser }: InsantiateUserSessionProps<UserType>) => Promise<void>;
export declare const createAuthConfig: <UserType>(props: AbsoluteAuthProps<UserType>) => AbsoluteAuthProps<UserType>;
export {};
