import { Navbar } from '../components/navbar/Navbar';
import { Head } from '../components/page/Head';
import { useAuthStatus } from '../hooks/useAuthStatus';
import {
	htmlDefault,
	bodyDefault,
	mainDefault,
	contentStyle
} from '../styles/styles';

export const Home = () => {
	const { user, handleSignOut } = useAuthStatus();

	return (
		<html lang="en" style={htmlDefault}>
			<Head />
			<body style={bodyDefault}>
				<Navbar user={user} handleSignOut={handleSignOut} />
				<main style={mainDefault}>
					<div style={contentStyle}>
						<h1>Welcome to Absolute Auth Example</h1>
						<p>Log in or sign up to test the authentication flow</p>
						<p>
							You can access the protected page after logging in
							to see the user data
						</p>
					</div>
				</main>
			</body>
		</html>
	);
};
