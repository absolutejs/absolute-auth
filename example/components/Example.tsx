import { Navbar } from './Navbar';
import {
	htmlDefault,
	bodyDefault,
	mainDefault,
	buttonStyle,
	contentStyle
} from '../utils/styles';
import { Head } from '../utils/Head';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { useState } from 'react';

export const Example = () => {
	const { userIdentity, setUserIdentity } = useAuthStatus();
	const [modalOpen, setModalOpen] = useState(false);
	return (
		<html lang="en" style={htmlDefault}>
			<Head />
			<body style={bodyDefault}>
				<Navbar
					userIdentity={userIdentity}
					setUserIdentity={setUserIdentity}
					modalOpen={modalOpen}
					setModalOpen={setModalOpen}
				/>
				<main style={mainDefault}>
					<div style={contentStyle}>
						<h1>Welcome to Absolute Auth Example</h1>
						<p>Log in or sign up to test the authentication flow</p>
						<p>
							You can access the protected page after logging in
							to see the user data
						</p>
						{userIdentity ? (
							<a
								style={buttonStyle({
									backgroundColor: '#007bff'
								})}
								href="/protected"
							>
								Go To Profile
							</a>
						) : (
							<button
								style={buttonStyle({
									backgroundColor: '#007bff'
								})}
								onClick={() => setModalOpen(true)}
							>
								Log In To View
							</button>
						)}
					</div>
				</main>
			</body>
		</html>
	);
};
