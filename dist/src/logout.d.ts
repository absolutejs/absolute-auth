import { Elysia } from 'elysia';
type LogoutProps = {
    logoutRoute?: string;
    onLogout?: () => void;
};
export declare const logout: ({ logoutRoute, onLogout }: LogoutProps) => Elysia<"", {
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
                401: "No auth provider found";
                500: `Failed to logout: ${string}`;
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
