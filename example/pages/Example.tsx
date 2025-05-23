import { useState } from 'react';
import { Head } from '../components/Head';
import { Navbar } from '../components/Navbar';
import { useAuthStatus } from '../hooks/useAuthStatus';
import {
	htmlDefault,
	bodyDefault,
	mainDefault,
	buttonStyle,
	contentStyle
} from '../utils/styles';

export const Example = () => {
	const { user, handleLogOut } = useAuthStatus();
	const [modalOpen, setModalOpen] = useState(false);

	return (
		<html lang="en" style={htmlDefault}>
			<Head />
			<body style={bodyDefault}>
				<Navbar
					user={user}
					handleLogOut={handleLogOut}
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
						{user ? (
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
