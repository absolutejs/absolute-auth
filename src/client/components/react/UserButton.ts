// Drop-in current-user button for React. The component that Clerk's
// `<UserButton />` was sticky for: shows the signed-in user's email +
// avatar, expands to a menu on click, exposes sign-out + a
// customizable list of links.
//
// Usage:
//
//   <UserButton
//     client={authClient}
//     user={user}            // your AuthUser-shaped record
//     items={[
//       { label: 'Settings', href: '/settings' },
//       { label: 'API keys', href: '/settings/api' }
//     ]}
//     onSignOut={() => router.push('/')}
//   />
//
// The component owns NO data fetching — the consumer passes `user` from
// wherever they keep session state. Sign-out goes through the package's
// /oauth2/signout (universal across credential + OAuth sessions since
// 0.32.0).
import { createElement, useState } from 'react';
import type { AuthClient } from '../../createAuthClient';
import { useSignOut } from '../../react';

export type UserButtonUser = {
	avatarUrl?: string;
	email?: string;
	givenName?: string;
};

export type UserButtonItem = {
	href: string;
	label: string;
};

export type UserButtonProps = {
	client: AuthClient;
	classNames?: {
		avatar?: string;
		container?: string;
		email?: string;
		menu?: string;
		menuItem?: string;
		signOut?: string;
		toggle?: string;
	};
	items?: UserButtonItem[];
	onSignOut?: () => void;
	signedOutHref?: string;
	signOutLabel?: string;
	user: UserButtonUser | null;
};

const initial = (user: UserButtonUser) => {
	const source = user.givenName ?? user.email ?? '?';

	return source.slice(0, 1).toUpperCase();
};

export const UserButton = ({
	client,
	classNames,
	items,
	onSignOut,
	signedOutHref = '/',
	signOutLabel = 'Sign out',
	user
}: UserButtonProps) => {
	const [open, setOpen] = useState(false);
	const { mutate } = useSignOut(client);

	if (user === null) {
		return createElement(
			'a',
			{
				className: classNames?.toggle,
				'data-abs-auth': 'signed-out',
				href: signedOutHref
			},
			'Sign in'
		);
	}

	const menu = open
		? createElement(
				'div',
				{
					className: classNames?.menu,
					'data-abs-auth': 'menu'
				},
				...((items ?? []).map((item) =>
					createElement(
						'a',
						{
							className: classNames?.menuItem,
							'data-abs-auth-menu-item': item.label,
							href: item.href,
							key: item.href
						},
						item.label
					)
				) as ReturnType<typeof createElement>[]),
				createElement(
					'button',
					{
						className: classNames?.signOut,
						'data-abs-auth': 'sign-out',
						onClick: async () => {
							await mutate(undefined);
							setOpen(false);
							onSignOut?.();
						},
						type: 'button'
					},
					signOutLabel
				)
			)
		: null;

	const avatar =
		user.avatarUrl === undefined
			? createElement(
					'span',
					{
						className: classNames?.avatar,
						'data-abs-auth': 'avatar-initial'
					},
					initial(user)
				)
			: createElement('img', {
					alt: '',
					className: classNames?.avatar,
					'data-abs-auth': 'avatar',
					src: user.avatarUrl
				});

	return createElement(
		'div',
		{
			className: classNames?.container,
			'data-abs-auth': 'user-button',
			'data-abs-auth-open': open ? 'true' : 'false'
		},
		createElement(
			'button',
			{
				'aria-expanded': open,
				className: classNames?.toggle,
				'data-abs-auth': 'user-toggle',
				onClick: () => setOpen((prev) => !prev),
				type: 'button'
			},
			avatar,
			createElement(
				'span',
				{ className: classNames?.email, 'data-abs-auth': 'user-email' },
				user.givenName ?? user.email ?? 'Account'
			)
		),
		menu
	);
};
