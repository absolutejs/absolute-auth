import { useState, useEffect } from 'react';
import { User } from '../db/schema';

export const useAuthStatus = () => {
	const [user, setUser] = useState<User>();

	const checkAuthStatus = async () => {
		const response = await fetch('/oauth2/status');

		if (!response.ok && response.statusText === 'Unauthorized') {
			setUser(undefined);

			return;
		}

		if (!response.ok) {
			console.error('Failed to fetch user data');

			return;
		}

		const data = await response.json();

		if (!data.user) {
			return;
		}

		setUser({
			auth_sub: data.user.auth_sub ?? 'auth_sub',
			created_at: data.user.created_at ?? 'created_at',
			email: data.user.email ?? 'Email',
			family_name: data.user.family_name ?? 'Last name',
			given_name: data.user.given_name ?? 'First name',
			picture: data.user.picture ?? 'picture'
		});
	};

	const handleSignOut = async () => {
		const response = await fetch('/signout', { method: 'POST' });
		if (response.ok) {
			setUser(undefined);
			window.location.reload();
		} else {
			console.error('SignOut failed');
		}
	};

	useEffect(() => {
		checkAuthStatus();
	}, []);

	return {
		handleSignOut,
		setUser,
		user
	};
};
