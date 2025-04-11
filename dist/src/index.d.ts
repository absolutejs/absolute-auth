import { OAuth2RequestError, ArcticFetchError } from 'arctic';
import { Elysia } from 'elysia';
import { AbsoluteAuthProps } from './types';
export declare const absoluteAuth: <UserType>({ config, authorizeRoute, callbackRoute, logoutRoute, statusRoute, refreshRoute, revokeRoute, onAuthorize, onCallback, onStatus, onRefresh, onLogout, onRevoke, createUser, getUser }: AbsoluteAuthProps<UserType>) => Elysia<"", {
    decorator: {};
    store: {
        session: import("./types").SessionRecord<UserType> & import("./types").SessionRecord<unknown>;
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
                401: "No auth provider found";
                500: `Failed to logout: ${string}`;
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
                    200: Response;
                    401: "No auth provider found" | "No refresh token found";
                    501: "Provider does not support revocation";
                    500: `Failed to revoke token: ${string}`;
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
                501: "Provider is not refreshable";
                500: `Error: ${string} - ${string}` | `Unknown Error: ${string}`;
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
                401: "No auth provider found" | "No refresh token found";
                501: "Provider is not refreshable";
                500: `Failed to refresh token: ${string}` | `Faile to refresh token: Unknown error: ${string}`;
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
} & {
    [x: string]: {
        get: {
            body: unknown;
            params: {};
            query: unknown;
            headers: unknown;
            response: {
                200: import("undici-types").Response;
                400: "Invalid callback request" | "Invalid state mismatch" | "Code verifier not found and is required";
                401: "Invalid provider" | "No auth provider found";
                500: "Invalid user schema" | `${string} - ${string}` | `Failed to validate authorization code: Unknown error: ${string}`;
            };
        };
    };
}, {
    derive: {
        readonly protectRoute: (handleAuth: () => Promise<Response>, handleAuthFail?: () => Promise<Response>) => Promise<Response | import("elysia/error").ElysiaCustomStatusResponse<"Unauthorized", "No session ID found", 401> | import("elysia/error").ElysiaCustomStatusResponse<"Unauthorized", "No session found", 401>>;
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
