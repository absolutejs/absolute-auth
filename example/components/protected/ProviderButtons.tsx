import { ProviderOption, providerOptions } from 'citra';
import { useState } from 'react';
import { containerStyle, headingStyle } from '../../styles/authModalStyles';
import { OAuthButton } from '../auth/OAuthButton';
import { ProviderDropdown } from '../utils/ProviderDropdown';

const cardStyle = {
	background: '#fff',
	border: '1px solid #d9e2ec',
	borderRadius: '0.75rem',
	boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
	padding: '1rem',
	width: 'min(960px, 92vw)'
} as const;

export const ProviderButtons = () => {
	const [currentProvider, setCurrentProvider] =
		useState<Lowercase<ProviderOption>>();

	return (
		<div
			style={{
				...containerStyle,
				gap: '1rem',
				minWidth: 'min(960px, 92vw)',
				padding: '0'
			}}
		>
			<div style={cardStyle}>
				<h2 style={{ ...headingStyle, marginBottom: '1rem' }}>
					Link Login Provider
				</h2>
				<p style={{ marginBottom: '1rem', textAlign: 'center' }}>
					Choose any configured provider and attach it to the current
					account.
				</p>
				<ProviderDropdown
					providers={providerOptions}
					setCurrentProvider={setCurrentProvider}
				/>
				<OAuthButton action="link" provider={currentProvider} />
			</div>
		</div>
	);
};
