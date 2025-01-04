import Elysia from 'elysia';
import type { ClientProviders, OAuthEventHandler } from './types';
type RevokeProps = {
    clientProviders: ClientProviders;
    revokeRoute?: string;
    onRevoke?: OAuthEventHandler;
};
export declare const revoke: ({ clientProviders, revokeRoute, onRevoke }: RevokeProps) => Elysia<"", {
    decorator: {};
    store: {};
    derive: {};
    resolve: {};
}, {
    typebox: import("@sinclair/typebox").TModule<{}>;
    error: {};
}, {
    schema: {};
    macro: {};
    macroFn: {};
    parser: {};
}, {
    [x: string]: {
        "access-token": {
            post: {
                body: unknown;
                params: {};
                query: unknown;
                headers: unknown;
                response: {
                    200: undefined;
                    400: "Invalid provider";
                    401: "No auth provider found" | "No refresh token found";
                };
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
