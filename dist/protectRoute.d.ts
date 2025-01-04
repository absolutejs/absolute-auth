import Elysia from 'elysia';
export declare const protectRoute: <UserType>() => Elysia<"", {
    decorator: {};
    store: {
        session: import("./types").SessionRecord<UserType_1>;
    };
    derive: {};
    resolve: {};
}, {
    error: {};
    typebox: import("elysia/dist/types").MergeTypeModule<import("@sinclair/typebox").TModule<{}, {}>, import("@sinclair/typebox").TModule<{}, {}>>;
}, {
    schema: {};
    macro: {};
    macroFn: {};
    parser: {};
}, {}, {
    derive: {
        readonly protectRoute: (onAuth: () => Promise<Response>, onAuthFail?: () => Promise<Response>) => Promise<Response | import("elysia/dist/error").ElysiaCustomStatusResponse<401, "No session ID found", 401> | import("elysia/dist/error").ElysiaCustomStatusResponse<401, "No session found", 401>>;
    };
    resolve: {};
    schema: import("elysia").MergeSchema<{}, {}, "">;
}, {
    derive: {};
    resolve: {};
    schema: {};
}>;
