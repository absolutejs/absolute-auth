import { Elysia } from 'elysia';
import { ClientProviders, OAuthEventHandler } from './types';
type AuthorizeProps = {
    clientProviders: ClientProviders;
    authorizeRoute?: string;
    onAuthorize?: OAuthEventHandler;
};
export declare const authorize: ({ clientProviders, authorizeRoute, onAuthorize }: AuthorizeProps) => Elysia<"", {
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
        ":provider": {
            get: {
                body: unknown;
                params: {
                    provider: string;
                };
                query: unknown;
                headers: unknown;
                response: {
                    200: import("undici-types").Response;
                    400: "Provider is required" | "Invalid provider";
                    500: `Failed to authorize: ${string}` | `Unknown error: ${string}`;
                    422: {
                        type: "validation";
                        on: string;
                        summary?: string;
                        message?: string;
                        found?: unknown;
                        property?: string;
                        expected?: string;
                    };
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
