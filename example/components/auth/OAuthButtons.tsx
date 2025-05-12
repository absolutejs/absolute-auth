import {
	googleButtonStyle,
	googleButtonContentStyle,
	googleIconStyle,
	googleButtonTextStyle
} from '../../styles/authModalStyles';

type OAuthButtonsProps = {
	mode: 'login' | 'signup';
};

export const OAuthButtons = ({ mode }: OAuthButtonsProps) => (
	<nav>
		<a href="/oauth2/google/authorization" style={googleButtonStyle}>
			<div style={googleButtonContentStyle}>
				<img
					src="/assets/svg/google.svg"
					alt="Google Icon"
					style={googleIconStyle}
				/>
				<span style={googleButtonTextStyle}>
					{mode === 'login'
						? 'Sign in with Google'
						: 'Sign up with Google'}
				</span>
			</div>
		</a>
		<a href="/oauth2/github/authorization" style={googleButtonStyle}>
			<div style={googleButtonContentStyle}>
				<img
					src="/assets/svg/github.svg"
					alt="Github Icon"
					style={googleIconStyle}
				/>
				<span style={googleButtonTextStyle}>
					{mode === 'login'
						? 'Sign in with Github'
						: 'Sign up with Github'}
				</span>
			</div>
		</a>
	</nav>
);
