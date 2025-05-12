import { SpringValue } from '@react-spring/web';
import { CSSProperties } from 'react';
import { AnimatedCSSProperties } from '../utils/Types';
import { primaryColor, secondaryColor } from './styles';

export const buttonStyle: CSSProperties = {
	backgroundColor: primaryColor,
	border: 'none',
	borderRadius: '0.5rem',
	color: '#fff',
	cursor: 'pointer',
	fontSize: '1.3rem',
	margin: '0 10px',
	padding: '10px'
};
export const dropdownStyle: CSSProperties = {
	alignItems: 'center',
	cursor: 'pointer',
	display: 'inline-flex',
	position: 'relative',
	zIndex: 1000
};
export const hamburgerBarStyle: CSSProperties = {
	backgroundColor: primaryColor,
	borderRadius: '5px',
	height: '7px',
	width: '100%'
};
export const hamburgerButtonStyle: CSSProperties = {
	alignItems: 'center',
	background: 'transparent',
	border: 'none',
	cursor: 'pointer',
	display: 'flex',
	flexDirection: 'column',
	gap: '8px',
	height: '3.5rem',
	justifyContent: 'center',
	marginLeft: '0.5rem',
	padding: '0',
	width: '2.5rem'
};
export const imgStyle: CSSProperties = {
	height: '15rem',
	width: 'auto'
};
export const labelStyle: CSSProperties = {
	alignItems: 'center',
	color: '#000',
	display: 'flex',
	fontSize: '1.5rem',
	fontWeight: '500',
	textDecoration: 'none'
};
export const logoStyle: CSSProperties = {
	alignItems: 'center',
	display: 'flex'
};
export const navbarContainerStyle: CSSProperties = {
	alignItems: 'center',
	background: '#fff',
	boxShadow: `0px 4px 14px rgba(0, 0, 0, 0.1)`,
	display: 'flex',
	justifyContent: 'space-between',
	left: 0,
	maxHeight: '100px',
	padding: '1.1rem',
	position: 'relative',
	top: 0,
	width: '100%'
};
export const navbarDrowdownLinkStyle: CSSProperties = {
	alignItems: 'center',
	background: 'none',
	border: 'none',
	color: '#000',
	display: 'flex',
	fontSize: '1.5rem'
};
export const optionIconStyle: CSSProperties = {
	alignItems: 'center',
	color: secondaryColor,
	height: '2.3rem',
	justifyContent: 'center',
	marginRight: '15px',
	width: 'auto'
};
export const optionStyle: CSSProperties = {
	alignItems: 'center',
	cursor: 'pointer',
	display: 'flex',
	textDecoration: 'none',
	whiteSpace: 'nowrap'
};
export const getNavbarDropdownListStyle = (dropdownSpring: {
	height: SpringValue<number>;
	opacity: SpringValue<number>;
	transform: SpringValue<string>;
}): AnimatedCSSProperties => ({
	backgroundColor: '#fff',
	border: '1px solid #ddd',
	borderRadius: '10px',
	boxShadow: `0 4px 8px rgba(0, 0, 0, 0.1)`,
	height: dropdownSpring.height,
	left: 0,
	maxWidth: '250px',
	opacity: dropdownSpring.opacity,
	overflow: 'hidden',
	padding: '15px 0',
	pointerEvents: dropdownSpring.opacity.to((opacity) =>
		opacity > 0 ? 'auto' : 'none'
	),
	position: 'absolute',
	top: '100%',
	whiteSpace: 'nowrap',
	width: 'auto'
});
export const profileButtonStyle = {
	alignItems: 'center',
	border: 'none',
	borderRadius: '5px',
	cursor: 'pointer',
	display: 'flex',
	height: 'clamp(3.6rem, 3.7vw, 4rem)',
	justifyContent: 'center',
	margin: '0 clamp(0.4rem, 0.6vw, 0.6rem)',
	overflow: 'hidden',
	padding: '0',
	width: 'clamp(3.6rem, 3.7vw, 4rem)'
};
