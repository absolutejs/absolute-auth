import { useEffect } from 'react';
import { useToast } from '../utils/ToastProvider';

export const SettingsNoticeToast = () => {
	const { addToast } = useToast();

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}

		const url = new URL(window.location.href);
		const notice = url.searchParams.get('notice');
		if (notice !== 'identity-already-linked') {
			return;
		}

		addToast({
			message: 'That login is already linked to this account.',
			style: { background: '#fff3cd', color: '#856404' }
		});

		url.searchParams.delete('notice');
		const nextSearch = url.searchParams.toString();
		window.history.replaceState(
			{},
			'',
			`${url.pathname}${nextSearch.length > 0 ? `?${nextSearch}` : ''}${url.hash}`
		);
	}, [addToast]);

	return null;
};
