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
			sub: data.user.sub,
			first_name: data.user.first_name ?? null,
			last_name: data.user.last_name ?? null,
			email: data.user.email ?? null,
			created_at: data.user.created_at,
			primary_auth_identity_id: data.user.primary_auth_identity_id ?? null
		});
	};

	const handleSignOut = async () => {
		const response = await fetch('/oauth2/signout', { method: 'DELETE' });
		if (response.ok) {
			setUser(undefined);
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
