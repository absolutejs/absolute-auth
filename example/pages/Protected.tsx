import { Navbar } from '../components/navbar/Navbar';
import { Head } from '../components/page/Head';
import { useAuthStatus } from '../hooks/useAuthStatus';

import {
	htmlDefault,
	bodyDefault,
	mainDefault,
	contentStyle
} from '../styles/styles';

export const Protected = () => {
	const { user, handleSignOut } = useAuthStatus();

	return (
		<html lang="en" style={htmlDefault}>
			<Head />
			<body style={bodyDefault}>
				<Navbar user={user} handleSignOut={handleSignOut} />
				<main style={mainDefault}>
					<div style={contentStyle}>
						<h1>Protected Page</h1>
						<p>{user !== undefined && user.given_name}</p>
						<p>{user !== undefined && user.family_name}</p>
						<p>{user !== undefined && user.email}</p>
						<img
							src={
								user?.picture ??
								'https://via.placeholder.com/150'
							}
							alt="Profile Picture"
							style={{ borderRadius: '50%', width: '100px' }}
						/>
					</div>
				</main>
			</body>
		</html>
	);
};
