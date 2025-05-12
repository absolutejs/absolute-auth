import {
	FaGamepad,
	FaGlobe,
	FaHandshake,
	FaPhone,
	FaQuestionCircle,
	FaTv,
	FaUsers
} from 'react-icons/fa';
import { optionIconStyle } from '../styles/navbarStyles';
import { NavbarElement } from './Types';

export const navbarData: NavbarElement[] = [
	{
		href: '/documentation',
		label: 'Documentation'
	},
	{
		href: '/protected',
		label: 'Protected'
	}
];
