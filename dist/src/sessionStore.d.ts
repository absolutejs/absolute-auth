import Elysia from 'elysia';
import type { SessionRecord } from './types';
export declare const sessionStore: <UserType>() => Elysia<"", {
    decorator: {};
    store: {
        session: SessionRecord<UserType>;
    };
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
}, {}, {
    derive: {};
    resolve: {};
    schema: {};
}, {
    derive: {};
    resolve: {};
    schema: {};
}>;
