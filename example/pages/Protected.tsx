import { Navbar } from '../components/navbar/Navbar';
import { Head } from '../components/page/Head';
import { UserInfo } from '../components/protected/UserInfo';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { bodyDefault, htmlDefault, mainDefault } from '../styles/styles';

export const Protected = () => {
	const { user, handleSignOut } = useAuthStatus();

	return (
		<html lang="en" style={htmlDefault}>
			<Head />
			<body style={bodyDefault}>
				<Navbar user={user} handleSignOut={handleSignOut} />
				<main style={mainDefault}>
					<UserInfo user={user} />
				</main>
			</body>
		</html>
	);
};
