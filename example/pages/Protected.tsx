import { Head } from '../components/Head';
import { Navbar } from '../components/Navbar';
import { useAuthStatus } from '../hooks/useAuthStatus';

import {
	htmlDefault,
	bodyDefault,
	mainDefault,
	contentStyle
} from '../utils/styles';

export const Protected = () => {
	const { user, handleLogOut } = useAuthStatus();

	return (
		<html lang="en" style={htmlDefault}>
			<Head />
			<body style={bodyDefault}>
				<Navbar user={user} handleLogOut={handleLogOut} />
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
