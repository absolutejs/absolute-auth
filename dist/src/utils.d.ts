import { AbsoluteAuthProps, InsantiateUserSessionProps } from './types';
export declare const instantiateUserSession: <UserType>({ user_session_id, session, getUser, createUser }: InsantiateUserSessionProps<UserType>) => Promise<void>;
export declare const createAuthConfig: <UserType>(props: AbsoluteAuthProps<UserType>) => AbsoluteAuthProps<UserType>;
