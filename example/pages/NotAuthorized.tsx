import { useState } from 'react';
import { Head } from '../components/Head';
import { Navbar } from '../components/Navbar';
import { useAuthStatus } from '../hooks/useAuthStatus';
import {
	htmlDefault,
	bodyDefault,
	mainDefault,
	contentStyle
} from '../utils/styles';

export const NotAuthorized = () => {
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
						<h1>Not Authorized</h1>
						<p>You must be logged in to view this page.</p>
						<button onClick={() => setModalOpen(true)}>
							Log In
						</button>
					</div>
				</main>
			</body>
		</html>
	);
};
