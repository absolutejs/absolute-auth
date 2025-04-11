import Elysia from 'elysia';
import { OAuth2RequestError, ArcticFetchError } from 'arctic';
import type { AbsoluteAuthProps } from './types';
export declare const absoluteAuth: <UserType>({ config, authorizeRoute, callbackRoute, logoutRoute, statusRoute, refreshRoute, revokeRoute, onAuthorize, onCallback, onStatus, onRefresh, onLogout, onRevoke, createUser, getUser }: AbsoluteAuthProps) => Elysia<"", {
    decorator: {};
    store: {
        session: import("./types").SessionRecord<UserType>;
    };
    derive: {};
    resolve: {};
}, {
    error: {
        OAUTH2_REQUEST_ERROR: OAuth2RequestError;
        ARCTIC_FETCH_ERROR: ArcticFetchError;
    };
    typebox: import("@sinclair/typebox").TModule<{}, {}>;
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
                500: "Internal Server Error";
                401: "No auth provider found";
            };
        };
    };
} & {
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
} & {
    [x: string]: {
        get: {
            body: unknown;
            params: {};
            query: unknown;
            headers: unknown;
            response: {
                200: Response;
                500: "Internal Server Error";
            };
        };
    };
} & {
    [x: string]: {
        post: {
            body: unknown;
            params: {};
            query: unknown;
            headers: unknown;
            response: {
                200: Response;
                500: "Internal Server Error";
                401: "No auth provider found" | "No refresh token found" | "Provider is not refreshable";
            };
        };
    };
} & {
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
                    500: "Internal Server Error";
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
} & {
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
    derive: {
        readonly protectRoute: (onAuth: () => Promise<Response>, onAuthFail?: (() => Promise<Response>) | undefined) => Promise<Response | import("elysia/error").ElysiaCustomStatusResponse<401, "No session ID found", 401> | import("elysia/error").ElysiaCustomStatusResponse<401, "No session found", 401>>;
    };
    resolve: {};
    schema: import("elysia").MergeSchema<{
        body: unknown;
        headers: unknown;
        query: unknown;
        params: {};
        cookie: unknown;
        response: {};
    }, {}, "">;
}, {
    derive: {};
    resolve: {};
    schema: {};
}>;
