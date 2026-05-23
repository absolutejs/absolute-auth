import { OAuthButton } from './OAuthButton';

type OAuthButtonsProps = {
	action?: 'login' | 'signup';
};

export const OAuthButtons = ({ action = 'login' }: OAuthButtonsProps) => (
	<nav
		style={{
			display: 'flex',
			flexDirection: 'column',
			width: '100%'
		}}
	>
		<OAuthButton action={action} provider="google" />
		<OAuthButton action={action} provider="github" />
	</nav>
);
