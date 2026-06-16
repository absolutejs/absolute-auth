// Drop-in sign-in component for React. Headless — minimal default
// markup, every element has a stable `data-abs-auth` attribute the
// consumer can target from their own CSS. Doesn't bundle styles;
// consumers bring their own (Tailwind class lists, CSS-in-JS,
// vanilla CSS, whatever).
//
// Usage:
//
//   import { SignIn } from '@absolutejs/auth/react';
//
//   <SignIn
//     client={authClient}
//     onSuccess={() => router.push('/dashboard')}
//     providers={['google', 'github']}
//   />
//
// The component renders an email/password form, calls the package's
// useSignIn hook on submit, and emits onSuccess/onError. OAuth provider
// buttons (when `providers` is set) are real anchor links to
// `/oauth2/authorize?provider=…` — the consumer's existing OAuth
// roundtrip + onCallbackSuccess hook is what handles the rest.
import { createElement, type FormEvent } from 'react';
import { useState } from 'react';
import type { AuthClient, AuthClientError } from '../../createAuthClient';
import { useSignIn } from '../../react';

type AuthnSuccess = {
	passwordCompromised?: boolean;
	status: 'authenticated' | 'mfa_required';
};

export type SignInProps = {
	client: AuthClient;
	classNames?: {
		button?: string;
		container?: string;
		divider?: string;
		error?: string;
		field?: string;
		input?: string;
		label?: string;
		oauthButton?: string;
		oauthGrid?: string;
	};
	emailLabel?: string;
	onError?: (error: AuthClientError) => void;
	onSuccess?: (result: AuthnSuccess) => void;
	passwordLabel?: string;
	// OAuth provider keys (lowercase, matching your auth() config) to render
	// as buttons above the email/password form. e.g. ['google', 'github'].
	providers?: string[];
	submitLabel?: string;
};

export const SignIn = ({
	client,
	classNames,
	emailLabel = 'Email',
	onError,
	onSuccess,
	passwordLabel = 'Password',
	providers,
	submitLabel = 'Sign in'
}: SignInProps) => {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const { error, isPending, mutate } = useSignIn(client);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const result = await mutate({ email, password });
		if (result.error !== null) {
			onError?.(result.error);

			return;
		}
		if (result.data !== null) onSuccess?.(result.data);
	};

	const oauthButtons =
		providers === undefined || providers.length === 0
			? null
			: createElement(
					'div',
					{
						className: classNames?.oauthGrid,
						'data-abs-auth': 'oauth-grid'
					},
					...providers.map((provider) =>
						createElement(
							'a',
							{
								className: classNames?.oauthButton,
								'data-abs-auth-provider': provider,
								href: `/oauth2/authorize?provider=${provider}`,
								key: provider
							},
							`Continue with ${provider}`
						)
					),
					createElement(
						'div',
						{
							className: classNames?.divider,
							'data-abs-auth': 'divider'
						},
						'or'
					)
				);

	const errorBanner =
		error === null
			? null
			: createElement(
					'p',
					{
						className: classNames?.error,
						'data-abs-auth': 'error',
						role: 'alert'
					},
					error.message
				);

	return createElement(
		'form',
		{
			className: classNames?.container,
			'data-abs-auth': 'sign-in',
			onSubmit: handleSubmit
		},
		oauthButtons,
		createElement(
			'label',
			{ className: classNames?.field, 'data-abs-auth': 'email-field' },
			createElement('span', { className: classNames?.label }, emailLabel),
			createElement('input', {
				autoComplete: 'username webauthn',
				className: classNames?.input,
				name: 'email',
				onChange: (event: { currentTarget: HTMLInputElement }) =>
					setEmail(event.currentTarget.value),
				required: true,
				type: 'email',
				value: email
			})
		),
		createElement(
			'label',
			{ className: classNames?.field, 'data-abs-auth': 'password-field' },
			createElement(
				'span',
				{ className: classNames?.label },
				passwordLabel
			),
			createElement('input', {
				autoComplete: 'current-password',
				className: classNames?.input,
				minLength: 12,
				name: 'password',
				onChange: (event: { currentTarget: HTMLInputElement }) =>
					setPassword(event.currentTarget.value),
				required: true,
				type: 'password',
				value: password
			})
		),
		errorBanner,
		createElement(
			'button',
			{
				className: classNames?.button,
				'data-abs-auth': 'submit',
				disabled: isPending,
				type: 'submit'
			},
			isPending ? 'Signing in…' : submitLabel
		)
	);
};
