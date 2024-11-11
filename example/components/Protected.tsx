import { useState } from 'react';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { Head } from '../utils/Head';
import {
	htmlDefault,
	bodyDefault,
	mainDefault,
	contentStyle
} from '../utils/styles';

import { Navbar } from './Navbar';

export const Protected = () => {
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
						<h1>Protected Page</h1>
						<p>{userIdentity && userIdentity.given_name}</p>
						<p>{userIdentity && userIdentity.family_name}</p>
						<p>{userIdentity && userIdentity.email}</p>
						<img
							src={userIdentity?.picture ?? ''}
							alt="Profile Picture"
							style={{ borderRadius: '50%', width: '100px' }}
						/>
					</div>
				</main>
			</body>
		</html>
	);
};
