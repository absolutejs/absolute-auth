export const isValidUser = <UserType>(user: unknown): user is UserType => true;

export const isNonEmptyString = (
	str: string | null | undefined
): str is string => str !== null && str !== undefined && str.trim() !== '';
