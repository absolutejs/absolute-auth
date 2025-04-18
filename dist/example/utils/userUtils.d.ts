import type { DatabaseFunctionProps, NewUser } from '../db/schema';
import { UserFunctionProps } from '../../src/types';
export declare const getDBUser: ({ authSub, db, schema }: DatabaseFunctionProps & {
    authSub: string;
}) => Promise<{
    given_name: string | null;
    family_name: string | null;
    email: string | null;
    created_at: Date;
    auth_sub: string;
    picture: string | null;
} | null>;
export declare const createDBUser: ({ auth_sub, given_name, family_name, email, picture, db, schema }: DatabaseFunctionProps & NewUser) => Promise<{
    given_name: string | null;
    family_name: string | null;
    email: string | null;
    created_at: Date;
    auth_sub: string;
    picture: string | null;
}>;
export declare const createUser: ({ userProfile, authProvider, db, schema }: UserFunctionProps & DatabaseFunctionProps) => Promise<{
    given_name: string | null;
    family_name: string | null;
    email: string | null;
    created_at: Date;
    auth_sub: string;
    picture: string | null;
}>;
export declare const getUser: ({ userProfile, authProvider, db, schema }: UserFunctionProps & DatabaseFunctionProps) => Promise<{
    given_name: string | null;
    family_name: string | null;
    email: string | null;
    created_at: Date;
    auth_sub: string;
    picture: string | null;
} | null>;
