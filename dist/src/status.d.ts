import { Elysia } from 'elysia';
import { ClientProviders } from './types';
type StatusProps = {
    clientProviders: ClientProviders;
    statusRoute?: string;
    onStatus?: () => void;
};
export declare const status: <UserType>({ clientProviders, statusRoute, onStatus }: StatusProps) => Elysia<"", {
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
}, {
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
