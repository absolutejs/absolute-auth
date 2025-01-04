import Elysia from 'elysia';
import type { ClientProviders, OAuthEventHandler } from './types';
type RefreshProps = {
    clientProviders: ClientProviders;
    refreshRoute?: string;
    onRefresh?: OAuthEventHandler;
};
export declare const refresh: ({ clientProviders, refreshRoute, onRefresh }: RefreshProps) => Elysia<"", {
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
        post: {
            body: unknown;
            params: {};
            query: unknown;
            headers: unknown;
            response: {
                200: import("undici-types").Response;
                500: "Internal Server Error";
                401: "No auth provider found" | "No refresh token found" | "Provider is not refreshable";
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
