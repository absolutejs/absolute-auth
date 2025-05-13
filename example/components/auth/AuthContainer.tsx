import { useState } from 'react';
import {
	containerStyle,
	headingStyle,
	loginTextStyle,
	loginLinkTextStyle,
	oauthButtonStyle
} from '../../styles/authModalStyles';
import { Divider } from '../utils/Divider';
import { OAuthButtons } from './OAuthButtons';
import { ProviderDropdown } from '../utils/ProviderDropdown';
import { ProviderOption, providerOptions } from 'citra';

export const AuthContainer = () => {
	const [currentProvider, setCurrentProvider] = useState<ProviderOption>();
	const [mode, setMode] = useState<'login' | 'signup'>('login');
	const switchMode = () => {
		setMode((prev) => (prev === 'login' ? 'signup' : 'login'));
	};

	return (
		<div style={containerStyle}>
			<a
				href="/"
				style={{
					color: 'black',
					fontSize: '1.5rem',
					fontWeight: 'bold',
					textDecoration: 'none'
				}}
			>
				Absolute Auth
			</a>
			<h1 style={headingStyle}>
				{mode === 'login'
					? 'Sign in to your Account'
					: 'Create an account'}
			</h1>

			<OAuthButtons mode={mode} />

			<Divider text="or" />

			<ProviderDropdown
				setCurrentProvider={setCurrentProvider}
				providerOptions={providerOptions}
			/>

			<button
				style={oauthButtonStyle}
				onClick={() => {
					alert('Sign in with ' + currentProvider);
				}}
			>
				{mode === 'login' ? 'Sign in' : 'Sign up'} with{' '}
				{currentProvider ?? 'other provider'}
			</button>

			<p style={loginTextStyle}>
				{mode === 'login' ? 'Need an account? ' : 'Have an account? '}
				<button style={loginLinkTextStyle} onClick={switchMode}>
					{mode === 'login' ? 'Sign Up' : 'Sign In'}
				</button>
			</p>
		</div>
	);
};
