import { CSSProperties } from 'react';
import { primaryColor } from './styles';

export const confirmInputStyle: CSSProperties = {
	border: '1px solid #ccc',
	borderRadius: '4px',
	marginBottom: '20px',
	padding: '10px',
	width: '100%'
};
export const containerStyle: CSSProperties = {
	alignItems: 'center',
	display: 'flex',
	flex: 1,
	flexDirection: 'column',
	justifyContent: 'center',
	margin: '0 auto',
	minWidth: '400px',
	padding: '20px'
};

export const oauthButtonContentStyle: CSSProperties = {
	alignItems: 'center',
	display: 'flex',
	justifyContent: 'center',
	paddingLeft: '12px',
	paddingRight: '12px',
	width: '100%'
};

type OAuthButtonStyleProps = {
	providerPrimaryColor?: string;
	isProviderSelected: boolean;
};

export const oauthButtonStyle = ({
	providerPrimaryColor = '#747775',
	isProviderSelected
}: OAuthButtonStyleProps): CSSProperties => ({
	alignItems: 'center',
	backgroundColor: '#FFFFFF',
	border: `1px solid ${providerPrimaryColor}`,
	borderRadius: '4px',
	boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1)',
	color: '#1f1f1f',
	cursor: isProviderSelected ? 'pointer' : 'not-allowed',
	display: 'flex',
	fontSize: '14px',
	justifyContent: 'center',
	marginBottom: '10px',
	padding: '10px',
	textDecoration: 'none',
	width: '100%'
});

export const oauthButtonTextStyle: CSSProperties = {
	overflow: 'hidden',
	textAlign: 'center',
	textOverflow: 'ellipsis'
};
export const oauthIconStyle: CSSProperties = {
	height: '24px',
	marginRight: '10px',
	objectFit: 'contain',
	width: '24px'
};
export const headingStyle: CSSProperties = {
	fontSize: '1.5rem',
	marginBottom: '20px',
	textAlign: 'center'
};

export const labelStyle: CSSProperties = {
	color: '#333',
	fontSize: '14px',
	marginBottom: '-2px',
	textAlign: 'left'
};

export const loginLinkTextStyle: CSSProperties = {
	backgroundColor: 'transparent',
	border: 'none',
	color: primaryColor,
	cursor: 'pointer',
	fontSize: '14px',
	fontWeight: 'bold',
	textAlign: 'center'
};
export const loginTextStyle: CSSProperties = {
	color: '#151414',
	textAlign: 'center'
};

export const separatorStyle: CSSProperties = {
	alignItems: 'center',
	display: 'flex',
	justifyContent: 'center',
	margin: '20px 0',
	width: '100%'
};
export const separatorTextStyle: CSSProperties = {
	color: '#747775',
	fontSize: '14px',
	padding: '0 10px'
};

export const separatorLineStyle = ({
	color = '#DDDDDD',
	height = '1px'
} = {}): CSSProperties => ({
	backgroundColor: color,
	flexGrow: 1,
	height: height
});
