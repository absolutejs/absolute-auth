// Drop-in sign-up component for React. Mirrors SignIn but calls
// useSignUp + advertises the 12-character minimum-length we enforce
// at the package level. See SignIn for the design rationale + the
// data-abs-auth attribute hook system.
import { createElement, type FormEvent } from 'react';
import { useState } from 'react';
import type { AuthClient, AuthClientError } from '../../createAuthClient';
import { useSignUp } from '../../react';

type SignUpSuccess =
	| { status: 'authenticated' }
	| { status: 'verification_required' };

export type SignUpProps = {
	client: AuthClient;
	classNames?: {
		button?: string;
		container?: string;
		error?: string;
		field?: string;
		input?: string;
		label?: string;
	};
	emailLabel?: string;
	onError?: (error: AuthClientError) => void;
	onSuccess?: (result: SignUpSuccess) => void;
	passwordLabel?: string;
	submitLabel?: string;
};

export const SignUp = ({
	client,
	classNames,
	emailLabel = 'Email',
	onError,
	onSuccess,
	passwordLabel = 'Password (12+ characters)',
	submitLabel = 'Create account'
}: SignUpProps) => {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const { error, isPending, mutate } = useSignUp(client);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const result = await mutate({ email, password });
		if (result.error !== null) {
			onError?.(result.error);

			return;
		}
		if (result.data !== null) onSuccess?.(result.data);
	};

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
			'data-abs-auth': 'sign-up',
			onSubmit: handleSubmit
		},
		createElement(
			'label',
			{ className: classNames?.field, 'data-abs-auth': 'email-field' },
			createElement('span', { className: classNames?.label }, emailLabel),
			createElement('input', {
				autoComplete: 'email',
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
				autoComplete: 'new-password',
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
			isPending ? 'Creating account…' : submitLabel
		)
	);
};
