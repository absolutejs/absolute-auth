import { useSpring } from '@react-spring/web';
import { useRef } from 'react';
import { User } from '../../db/schema';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import {
	navbarContainerStyle,
	hamburgerButtonStyle,
	hamburgerBarStyle
} from '../../styles/navbarStyles';
import { navbarData } from '../../utils/navbarData';
import { HamburgerMenu } from '../hamburger/HamburgerMenu';
import { NavbarLinks } from './NavbarLinks';
import { NavbarUserButtons } from './NavbarUserButtons';

type NavbarProps = {
	user: User | undefined;
	handleSignOut: () => Promise<void>;
};

export const Navbar = ({ user, handleSignOut }: NavbarProps) => {
	const breakpoint = useMediaQuery();
	const isMobile = breakpoint === 'xs' || breakpoint === 'sm';

	const navRef = useRef<HTMLDivElement>(null);

	const [hamburgerMenuSpring, hamburgerMenuApi] = useSpring(() => ({
		config: { friction: 40, tension: 275 },
		transform: 'translateX(100%)',
		onRest: () => {
			if (hamburgerMenuSpring.transform.get() === 'translateX(100%)') {
				document.body.style.overflow = '';
			}
		},
		onStart: () => {
			document.body.style.overflow = 'hidden';
		}
	}));

	const toggleHamburgerMenu = () => {
		const isOpen =
			hamburgerMenuSpring.transform.get() === 'translateX(100%)';
		void hamburgerMenuApi.start({
			transform: isOpen ? 'translateX(0%)' : 'translateX(100%)'
		});
	};

	return (
		<header ref={navRef} style={navbarContainerStyle}>
			<a
				href="/"
				style={{
					color: '#000',
					fontSize: '1.5rem',
					fontWeight: 'bold',
					textDecoration: 'none'
				}}
			>
				Absolute Auth
			</a>

			<div
				style={{
					alignItems: 'center',
					display: 'flex'
				}}
			>
				{!isMobile && <NavbarLinks navbarData={navbarData} />}

				<NavbarUserButtons user={user} handleSignOut={handleSignOut} />

				{isMobile === true && (
					<button
						style={hamburgerButtonStyle}
						onClick={toggleHamburgerMenu}
					>
						<div style={hamburgerBarStyle} />
						<div style={hamburgerBarStyle} />
						<div style={hamburgerBarStyle} />
					</button>
				)}
			</div>

			<HamburgerMenu
				spring={hamburgerMenuSpring}
				springApi={hamburgerMenuApi}
				user={user}
				handleSignOut={handleSignOut}
			/>
		</header>
	);
};
