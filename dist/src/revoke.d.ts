import { Elysia } from 'elysia';
import { ClientProviders } from './types';
type RevokeProps = {
    clientProviders: ClientProviders;
    revokeRoute?: string;
    onRevoke?: () => void;
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
                    200: Response;
                    401: "No auth provider found" | "No refresh token found";
                    501: "Provider does not support revocation";
                    500: `Failed to revoke token: ${string}`;
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
