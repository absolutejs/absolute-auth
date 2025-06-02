import { animated, useSpring } from '@react-spring/web';
import { useRef, useState } from 'react';
import { User } from '../../db/schema';
import { profileButtonStyle } from '../../styles/navbarStyles';
import { buttonStyle } from '../../styles/styles';
import { AuthContainer } from '../auth/AuthContainer';
import { ProfilePicture } from '../utils/ProfilePicture';
import { DropdownContainer } from './DropdownContainer';

type NavbarUserButtonsProps = {
	user: User | undefined;
	handleSignOut: () => Promise<void>;
};

export const NavbarUserButtons = ({
	user,
	handleSignOut
}: NavbarUserButtonsProps) => {
	const [isDropdownOpen, setIsDropdownOpen] = useState(false);

	const openDropdown = () => {
		setIsDropdownOpen(true);
		void loginDropdownApi.start({ opacity: 1, scale: 1 });
	};

	const closeDropdown = () => {
		setIsDropdownOpen(false);
		void loginDropdownApi.start({ opacity: 0, scale: 0 });
	};

	const handleLoginClick = () => {
		if (isDropdownOpen) {
			closeDropdown();
		} else {
			openDropdown();
		}
	};

	const [loginDropdownSpring, loginDropdownApi] = useSpring(() => ({
		config: { friction: 20, tension: 250 },
		opacity: 0,
		scale: 0
	}));

	const userButtonRef = useRef<HTMLButtonElement>(null);

	return (
		<div
			style={{
				display: 'flex',
				position: 'relative'
			}}
		>
			<button
				ref={userButtonRef}
				onClick={user ? () => handleSignOut() : handleLoginClick}
				style={buttonStyle({
					backgroundColor: '#000',
					color: '#fff'
				})}
			>
				{user ? 'Sign Out' : 'Login'}
			</button>
			{user !== undefined && (
				<animated.a style={profileButtonStyle} href="/protected">
					<ProfilePicture
						userImage={
							typeof user.metadata?.picture === 'string'
								? user.metadata.picture
								: undefined
						}
						backupImage={'/assets/svg/default-account-icon.svg'}
						width="100%"
						height="100%"
					/>
				</animated.a>
			)}
			{isDropdownOpen === true && (
				<DropdownContainer
					spring={loginDropdownSpring}
					springApi={loginDropdownApi}
					onClose={closeDropdown}
					ignoredElements={[userButtonRef]}
				>
					<AuthContainer />
				</DropdownContainer>
			)}
		</div>
	);
};
