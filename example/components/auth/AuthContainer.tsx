import { useState } from 'react';
import {
	containerStyle,
	egLogoStyle,
	headingStyle,
	loginTextStyle,
	loginLinkTextStyle
} from '../../styles/authModalStyles';
import { Divider } from '../utils/Divider';
import { OAuthButtons } from './OAuthButtons';

export const AuthContainer = () => {
	const [mode, setMode] = useState<'login' | 'signup'>('login');
	const switchMode = () => {
		setMode((prev) => (prev === 'login' ? 'signup' : 'login'));
	};

	return (
		<div style={containerStyle}>
			<a href="/">
				<img
					src="/assets/svg/eg-logo-no-text.svg"
					alt="Absolute Auth Logo"
					style={egLogoStyle}
				/>
			</a>
			<h1 style={headingStyle}>
				{mode === 'login'
					? 'Sign in to your Account'
					: 'Create an account'}
			</h1>

			<Divider text="or" />

			<OAuthButtons mode={mode} />

			<p style={loginTextStyle}>
				{mode === 'login' ? 'Need an account? ' : 'Have an account? '}
				<button style={loginLinkTextStyle} onClick={switchMode}>
					{mode === 'login' ? 'Sign Up' : 'Sign In'}
				</button>
			</p>
		</div>
	);
};
