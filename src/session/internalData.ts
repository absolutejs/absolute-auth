export type InternalUserSessionId =
	`${string}-${string}-${string}-${string}-${string}`;

type InternalImpersonator = {
	actorEmail?: string;
	actorId: string;
	readOnly?: boolean;
	reason: string;
	returnToSessionId?: InternalUserSessionId;
	startedAt: number;
	suppressSideEffects?: boolean;
};

type InternalSessionData<UserType> = {
	accessToken?: string;
	anonymous?: boolean;
	authenticatedAt?: number;
	expiresAt: number;
	impersonator?: InternalImpersonator;
	refreshToken?: string;
	samlLogout?: {
		connectionId: string;
		nameId: string;
		sessionIndex?: string;
	};
	user: UserType;
};

export type InternalSessionRecord<UserType> = Record<
	InternalUserSessionId,
	InternalSessionData<UserType>
>;

type InternalUnregisteredSessionData = {
	accessToken?: string;
	expiresAt: number;
	refreshToken?: string;
	sessionInformation?: Record<string, unknown>;
	userIdentity?: Record<string, unknown>;
};

export type InternalUnregisteredSessionRecord = Record<
	InternalUserSessionId,
	InternalUnregisteredSessionData
>;
