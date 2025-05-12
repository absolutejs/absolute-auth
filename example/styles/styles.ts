import { CSSProperties } from 'react';

export const styleReset = `
    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        font-weight: inherit;
    }
`;

export const primaryColor = '#4A90E2';
export const secondaryColor = '#50E3C2';

export const bodyDefault: CSSProperties = {
	backgroundColor: '#f5f5f5',
	color: '#333',
	display: 'flex',
	flexDirection: 'column',
	fontFamily: 'Poppins, sans-serif',
	height: '100%',
	margin: 0
};

export const mainDefault: CSSProperties = {
	display: 'flex',
	flex: 1,
	flexDirection: 'column'
};

export const htmlDefault: CSSProperties = {
	height: '100%'
};

type ButtonStyleProps = {
	backgroundColor?: string;
	color?: string;
	width?: string;
};
export const buttonStyle = ({
	backgroundColor = 'none',
	color = 'white',
	width
}: ButtonStyleProps): CSSProperties => ({
	alignItems: 'center',
	backgroundColor,
	border: 'none',
	borderRadius: '0.3125rem',
	color,
	cursor: 'pointer',
	display: 'flex',
	fontSize: '1rem',
	fontWeight: 'bold',
	justifyContent: 'center',
	margin: '0.3125rem',
	padding: '0.625rem 1rem',
	textDecoration: 'none',
	textWrap: 'nowrap',
	width
});

export const authContainerStyle: CSSProperties = {
	alignItems: 'center',
	borderRadius: '0.625rem',
	display: 'flex',
	flexDirection: 'column',
	justifyContent: 'center',
	margin: 'auto',
	maxWidth: '21.875rem',
	padding: '1.25rem',
	width: '100%'
};

export const textButtonStyle: CSSProperties = {
	color: ' #222   ',
	cursor: 'pointer',
	fontSize: '1.25rem',
	marginTop: '1.25rem',
	textAlign: 'center',
	width: '100%'
};

export const contentStyle: CSSProperties = {
	alignItems: 'center',
	display: 'flex',
	flexDirection: 'column',
	height: '100%',
	justifyContent: 'center'
};
