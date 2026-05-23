import { ProviderOption } from 'citra';
import { useState } from 'react';
import {
	containerStyle,
	headingStyle,
	loginLinkTextStyle,
	loginTextStyle
} from '../../styles/authModalStyles';
import { Divider } from '../utils/Divider';
import { ProviderDropdown } from '../utils/ProviderDropdown';
import { OAuthButton } from './OAuthButton';
import { OAuthButtons } from './OAuthButtons';

export const AuthContainer = () => {
	const [currentProvider, setCurrentProvider] =
		useState<Lowercase<ProviderOption>>();
	const [action, setAction] = useState<'login' | 'signup'>('login');
	const switchAction = () => {
		setAction((prev) => (prev === 'login' ? 'signup' : 'login'));
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
				{action === 'login'
					? 'Sign in to your Account'
					: 'Create an account'}
			</h1>

			<OAuthButtons action={action} />

			<Divider text="or" />

			<ProviderDropdown setCurrentProvider={setCurrentProvider} />

			<OAuthButton action={action} provider={currentProvider} />

			<p style={loginTextStyle}>
				{action === 'login' ? 'Need an account? ' : 'Have an account? '}
				<button style={loginLinkTextStyle} onClick={switchAction}>
					{action === 'login' ? 'Sign Up' : 'Sign In'}
				</button>
			</p>
		</div>
	);
};
