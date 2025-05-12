import { useState } from 'react';
import {
	authContainerStyle,
	buttonStyle,
	textButtonStyle
} from '../utils/styles';

export const AuthOptions = () => {
	const [showSignin, setShowSignin] = useState(true);

	const handleOAuthClick = async (provider: string) => {
		window.location.href = `/oauth2/${provider}/authorization`;
	};

	return (
		<nav style={authContainerStyle}>
			<button
				onClick={() => handleOAuthClick('google')}
				style={buttonStyle({
					backgroundColor: '#4285F4',
					width: '100%'
				})}
			>
				Sign {showSignin ? 'In' : 'Up'} with Google
			</button>
			<button
				onClick={() => handleOAuthClick('facebook')}
				style={buttonStyle({
					backgroundColor: '#4267B2',
					width: '100%'
				})}
			>
				Sign {showSignin ? 'In' : 'Up'} with Facebook
			</button>
			<button
				onClick={() => handleOAuthClick('twitter')}
				style={buttonStyle({
					backgroundColor: '#1DA1F2',
					width: '100%'
				})}
			>
				Sign {showSignin ? 'In' : 'Up'} with Twitter
			</button>
			<button
				onClick={() => handleOAuthClick('github')}
				style={buttonStyle({ backgroundColor: '#333', width: '100%' })}
			>
				Sign {showSignin ? 'In' : 'Up'} with GitHub
			</button>

			<p
				onClick={() => setShowSignin((prev) => !prev)}
				style={textButtonStyle}
			>
				{showSignin ? "Don't" : 'Already'} have an account?
			</p>
		</nav>
	);
};
