import { useState, useEffect } from 'react';
import type { User } from '../dbSchema';

export const useAuthStatus = () => {
	const [userIdentity, setUserIdentity] = useState<User | null>(null);

	const checkAuthStatus = async () => {
		try {
			const response = await fetch('/auth-status');

			if (response.ok) {
				const data = await response.json();

				if (data.user) {
					setUserIdentity({
						email: data.user.email ?? 'email',
						given_name: data.user.given_name ?? 'given_name',
						family_name: data.user.family_name ?? 'family_name',
						picture: data.user.picture ?? 'picture',
						auth_sub: data.user.auth_sub ?? 'auth_sub',
						created_at: data.user.created_at ?? 'created_at'
					});
				}
			}
		} catch (error) {
			console.error('Error checking auth status:', error);
		}
	};

	useEffect(() => {
		checkAuthStatus();
	}, []);

	return {
		userIdentity,
		setUserIdentity
	};
};
