import { Elysia } from 'elysia';
import { ClientProviders, OAuthEventHandler } from './types';
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
                200: Response;
                401: "No auth provider found" | "No refresh token found";
                501: "Provider is not refreshable";
                500: `Failed to refresh token: ${string}` | `Faile to refresh token: Unknown error: ${string}`;
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
