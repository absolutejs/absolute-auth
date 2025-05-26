import { ReactNode } from 'react';
import {
	optionStyle,
	navbarDrowdownLinkStyle
} from '../../styles/navbarStyles';

type NavbarLinkProps = {
	icon?: ReactNode;
	href: string;
	label: string;
};

export const NavbarLink = ({ icon, href, label }: NavbarLinkProps) => (
	<a href={href} style={optionStyle}>
		{icon}
		<span style={navbarDrowdownLinkStyle}>{label}</span>
	</a>
);
