import Elysia from 'elysia';
export declare const protectRoute: <UserType>() => Elysia<"", {
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
}, {}, {
    derive: {
        readonly protectRoute: (onAuth: () => Promise<Response>, onAuthFail?: () => Promise<Response>) => Promise<Response | import("elysia/error").ElysiaCustomStatusResponse<401, "No session ID found", 401> | import("elysia/error").ElysiaCustomStatusResponse<401, "No session found", 401>>;
    };
    resolve: {};
    schema: import("elysia").MergeSchema<{}, {}, "">;
}, {
    derive: {};
    resolve: {};
    schema: {};
}>;
