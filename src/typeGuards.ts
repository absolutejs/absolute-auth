import { AuthIntent, StatusReturn, UserSessionId } from './types';

export const isValidUser = <UserType>(user: unknown): user is UserType => {
	void user;

	return true;
};

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isAuthIntent = (value: unknown): value is AuthIntent =>
	value === 'login' ||
	value === 'link_identity' ||
	value === 'link_connector';
export const isNonEmptyString = (
	str: string | null | undefined
): str is string => str !== null && str !== undefined && str.trim() !== '';
export const isStatusResponse = (value: unknown): value is StatusReturn =>
	typeof value === 'object' &&
	value !== null &&
	'status' in value &&
	typeof Reflect.get(value, 'status') === 'number';
export const isUserSessionId = (key: string): key is UserSessionId =>
	UUID_PATTERN.test(key);
