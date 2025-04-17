import { Elysia } from 'elysia';
import { ClientProviders, OnCallback } from './types';
type CallbackProps<UserType> = {
    clientProviders: ClientProviders;
    callbackRoute?: string;
    onCallback?: OnCallback<UserType>;
};
export declare const callback: <UserType>({ clientProviders, callbackRoute, onCallback }: CallbackProps<UserType>) => Elysia<"", {
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
                500: `${string} - ${string}` | `Failed to validate authorization code: Unknown error: ${string}`;
                400: "Invalid callback request" | "Invalid state mismatch" | "Code verifier not found and is required";
                401: "Invalid provider" | "No auth provider found";
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
