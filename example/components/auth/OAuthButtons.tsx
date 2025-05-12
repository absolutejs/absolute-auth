import {
	oauthButtonContentStyle,
	oauthIconStyle,
	oauthButtonStyle,
	oauthButtonTextStyle
} from '../../styles/authModalStyles';

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
		<a href="/oauth2/google/authorization" style={oauthButtonStyle}>
			<div style={oauthButtonContentStyle}>
				<img
					src="/assets/svg/google.svg"
					alt="Google Icon"
					style={oauthIconStyle}
				/>
				<span style={oauthButtonTextStyle}>
					{mode === 'login'
						? 'Sign in with Google'
						: 'Sign up with Google'}
				</span>
			</div>
		</a>
		<a href="/oauth2/github/authorization" style={oauthButtonStyle}>
			<div style={oauthButtonContentStyle}>
				<img
					src="/assets/svg/GitHub_Invertocat_Dark.svg"
					alt="Github Icon"
					style={oauthIconStyle}
				/>
				<span style={oauthButtonTextStyle}>
					{mode === 'login'
						? 'Sign in with Github'
						: 'Sign up with Github'}
				</span>
			</div>
		</a>
	</nav>
);
