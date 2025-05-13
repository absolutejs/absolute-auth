import { animated, useSpring } from '@react-spring/web';
import { ReactNode, useRef } from 'react';
import { FaChevronDown } from 'react-icons/fa';
import { labelStyle } from '../../styles/authModalStyles';
import {
	dropdownStyle,
	getNavbarDropdownListStyle
} from '../../styles/navbarStyles';
import { NavbarLink as NavbarLinkType } from '../../utils/types';
import { NavbarLink } from './NavbarLink';

type NavbarDropdownProps = {
	label: string;
	href: string;
	links: NavbarLinkType[];
	icon?: ReactNode;
};

const AnimatedFaChevronDown = animated(FaChevronDown);

export const NavbarDropdown = ({ label, href, links }: NavbarDropdownProps) => {
	const dropdownRef = useRef<HTMLUListElement>(null);

	const [dropdownSpring, dropdownApi] = useSpring(() => ({
		config: { friction: 30, tension: 250 },
		height: 0,
		opacity: 0,
		transform: 'rotate(-180deg)'
	}));

	const openDropdown = () => {
		if (!dropdownRef.current) return;

		void dropdownApi.start({
			height: dropdownRef.current.scrollHeight,
			opacity: 1,
			transform: 'rotate(0deg)'
		});
	};

	const closeDropdown = () => {
		void dropdownApi.start({
			height: 0,
			opacity: 0,
			transform: 'rotate(-180deg)'
		});
	};

	return (
		<div style={dropdownStyle}>
			<div
				style={{
					alignItems: 'center',
					display: 'flex',
					flexDirection: 'row',
					height: '110px',
					justifyContent: 'center',
					left: 0,
					margin: '0 15px',
					position: 'relative',
					top: '100%',
					width: '100%',
					zIndex: 999
				}}
				onMouseEnter={openDropdown}
				onMouseLeave={closeDropdown}
			>
				<a href={href} style={labelStyle}>
					{label}
				</a>

				<AnimatedFaChevronDown
					style={{
						color: '#000',
						fontSize: '1.5rem',
						marginLeft: '10px',
						transform: dropdownSpring.transform,
						transformOrigin: 'center'
					}}
				/>
			</div>

			<animated.nav
				ref={dropdownRef}
				style={getNavbarDropdownListStyle(dropdownSpring)}
				onMouseEnter={openDropdown}
				onMouseLeave={closeDropdown}
			>
				{links.map((link, index) => (
					<NavbarLink
						key={index}
						icon={link.icon}
						href={link.href}
						label={link.label}
					/>
				))}
			</animated.nav>
		</div>
	);
};
