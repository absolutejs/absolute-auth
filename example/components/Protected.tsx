import { useState } from 'react';
import { useAuthStatus } from '../hooks/useAuthStatus';

import {
	htmlDefault,
	bodyDefault,
	mainDefault,
	contentStyle
} from '../utils/styles';

import { Navbar } from './Navbar';
import { Head } from './Head';

export const Protected = () => {
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
						<h1>Protected Page</h1>
						<p>{user && user.given_name}</p>
						<p>{user && user.family_name}</p>
						<p>{user && user.email}</p>
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
