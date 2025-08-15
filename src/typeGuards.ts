import { StatusReturn } from './types';

export const isValidUser = <UserType>(user: unknown): user is UserType => true;

export const isNonEmptyString = (
	str: string | null | undefined
): str is string => str !== null && str !== undefined && str.trim() !== '';

export const isStatusResponse = (value: unknown): value is StatusReturn =>
	typeof value === 'object' &&
	value !== null &&
	'status' in value &&
	typeof Reflect.get(value, 'status') === 'number';
