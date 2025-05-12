import { useState } from 'react';
import { Navbar } from '../components/navbar/Navbar';
import { Head } from '../components/page/Head';
import { useAuthStatus } from '../hooks/useAuthStatus';
import {
	htmlDefault,
	bodyDefault,
	mainDefault,
	contentStyle
} from '../styles/styles';

export const NotAuthorized = () => {
	const { user, handleSignOut } = useAuthStatus();

	return (
		<html lang="en" style={htmlDefault}>
			<Head />
			<body style={bodyDefault}>
				<Navbar user={user} handleSignOut={handleSignOut} />
				<main style={mainDefault}>
					<div style={contentStyle}>
						<h1>Not Authorized</h1>
						<p>You must be logged in to view this page.</p>
					</div>
				</main>
			</body>
		</html>
	);
};
