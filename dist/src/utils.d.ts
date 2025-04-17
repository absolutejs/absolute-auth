import { Cookie } from 'elysia';
import { AbsoluteAuthProps, SessionRecord } from './types';
type InsantiateUserSessionProps<UserType> = {
    authProvider: string;
    decodedIdToken: {
        [key: string]: string | undefined;
    };
    session: SessionRecord<UserType>;
    user_session_id: Cookie<string | undefined>;
    createUser: () => UserType | Promise<UserType>;
    getUser: () => UserType | Promise<UserType | null>;
};
export declare const instantiateUserSession: <UserType>({ user_session_id, session, getUser, createUser }: InsantiateUserSessionProps<UserType>) => Promise<void>;
export declare const createAuthConfig: <UserType>(props: AbsoluteAuthProps<UserType>) => AbsoluteAuthProps<UserType>;
export {};
