// An ordered, composable pipeline over the auth lifecycle — Auth0 Actions / Better Auth
// plugins, but built from the same callable primitives as everything else in this package.
// Each action targets one or more events; the pipeline runs the matching actions in order
// and short-circuits on the first deny/redirect. Wire it into the consumer-supplied lifecycle
// hooks (e.g. `onCredentialsLoginSuccess`, `onCallbackSuccess`) — the action handler can
// mutate context, deny, redirect, or pass through.

export type AuthEventName =
	| 'postLogin'
	| 'postLogout'
	| 'postMfa'
	| 'postOauthCallback'
	| 'postRegister'
	| 'preLogin'
	| 'preRegister';

export type AuthActionContext<UserType> = {
	email?: string;
	event: AuthEventName;
	ip?: string;
	metadata?: Record<string, unknown>;
	user?: UserType;
	userAgent?: string;
};

export type AuthActionResult =
	| { kind: 'deny'; reason: string }
	| { kind: 'pass' }
	| { kind: 'redirect'; url: string };

export type AuthAction<UserType> = {
	// Which event(s) this action runs on. A single event or a list (so one action can target
	// multiple lifecycle points, e.g. ['postLogin', 'postOauthCallback']).
	event: AuthEventName | AuthEventName[];
	handler: (
		context: AuthActionContext<UserType>
	) => AuthActionResult | Promise<AuthActionResult>;
	// Free-form label for debugging / audit metadata.
	name: string;
};

export type AuthPipeline<UserType> = {
	run: (
		event: AuthEventName,
		context: Omit<AuthActionContext<UserType>, 'event'>
	) => Promise<AuthActionResult>;
};

const matches = <UserType>(
	action: AuthAction<UserType>,
	event: AuthEventName
) =>
	Array.isArray(action.event)
		? action.event.includes(event)
		: action.event === event;

export const createActionPipeline = <UserType>(
	actions: AuthAction<UserType>[]
): AuthPipeline<UserType> => ({
	run: async (event, context) => {
		const fullContext: AuthActionContext<UserType> = { ...context, event };
		for (const action of actions) {
			if (!matches(action, event)) continue;
			const result = await action.handler(fullContext);
			if (result.kind !== 'pass') return result;
		}
		const pass: AuthActionResult = { kind: 'pass' };

		return pass;
	}
});
