import Elysia from 'elysia';
import type { ClientProviders, CreateUser, GetUser, OAuthEventHandler } from './types';
type CallbackProps<UserType> = {
    clientProviders: ClientProviders;
    callbackRoute?: string;
    onCallback?: OAuthEventHandler;
    getUser?: GetUser<UserType>;
    createUser?: CreateUser<UserType>;
};
export declare const callback: <UserType>({ clientProviders, callbackRoute, onCallback, getUser, createUser }: CallbackProps<UserType>) => Elysia<"", {
    decorator: {};
    store: {
        session: import("./types").SessionRecord<UserType>;
    };
    derive: {};
    resolve: {};
}, {
    error: {};
    typebox: import("@sinclair/typebox").TModule<{}, {}>;
}, {
    schema: {};
    macro: {};
    macroFn: {};
    parser: {};
}, {
    [x: string]: {
        get: {
            body: unknown;
            params: {};
            query: unknown;
            headers: unknown;
            response: {
                200: import("undici-types").Response;
                400: "Invalid provider" | "Invalid callback request" | "Invalid state mismatch" | "Code verifier not found and is required";
                500: "Internal Server Error" | "Invalid user schema";
                401: "No auth provider found";
            };
        };
    };
}, {
    derive: {};
    resolve: {};
    schema: {};
}, {
    derive: {};
    resolve: {};
    schema: {};
}>;
export {};
