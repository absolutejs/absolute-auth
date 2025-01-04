import Elysia from 'elysia';
import type { OAuthEventHandler } from './types';
type StatusProps = {
    statusRoute?: string;
    onStatus?: OAuthEventHandler;
};
export declare const status: <UserType>({ statusRoute, onStatus }: StatusProps) => Elysia<"", {
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
}, {
    [x: string]: {
        get: {
            body: unknown;
            params: {};
            query: unknown;
            headers: unknown;
            response: {
                200: import("undici-types").Response;
                500: "Internal Server Error";
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
