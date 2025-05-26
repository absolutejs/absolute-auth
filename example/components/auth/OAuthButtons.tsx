import { OAuthButton } from './OAuthButton';

type OAuthButtonsProps = {
	mode: 'login' | 'signup';
};

export const OAuthButtons = ({ mode }: OAuthButtonsProps) => (
	<nav
		style={{
			display: 'flex',
			flexDirection: 'column',
			width: '100%'
		}}
	>
		<OAuthButton mode={mode} provider="google" />
		<OAuthButton mode={mode} provider="github" />
	</nav>
);
