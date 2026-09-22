import { createCredentialsApi } from '../src/credentials/api';
type Routes = ReturnType<
	typeof createCredentialsApi<{ id: string; email: string }>
>['~Routes'];
type Assert<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
export type KnownAuthPaths = Assert<
	Equal<
		keyof Routes['auth'],
		'login' | 'register' | 'verify-email' | 'reset-password'
	>
>;
export type LoginBody = Assert<
	Equal<
		Routes['auth']['login']['post']['body'],
		{ email: string; password: string }
	>
>;
export type VerificationBody = Assert<
	Equal<Routes['auth']['verify-email']['post']['body'], { token: string }>
>;
export type ResetBody = Assert<
	Equal<
		Routes['auth']['reset-password']['post']['body'],
		{ password: string; token: string }
	>
>;

import { createSignoutApi } from '../src/server';
type SessionRoutes = ReturnType<
	typeof createSignoutApi<{ id: string }>
>['~Routes'];
export type SignoutPath = Assert<
	Equal<keyof SessionRoutes['oauth2'], 'signout'>
>;
export type SignoutMethod = Assert<
	Equal<keyof SessionRoutes['oauth2']['signout'], 'delete'>
>;
