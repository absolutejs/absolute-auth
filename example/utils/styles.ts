import { CSSProperties } from 'react';

export const styleReset = `
    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        font-weight: inherit;
    }
`;

export const bodyDefault: CSSProperties = {
	fontFamily: 'Poppins, sans-serif',
	backgroundColor: '#f5f5f5',
	color: '#333',
	height: '100%',
	margin: 0,
	display: 'flex',
	flexDirection: 'column'
};

export const mainDefault: CSSProperties = {
	flex: 1,
	display: 'flex',
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
	display: 'flex',
	alignItems: 'center',
	textDecoration: 'none',
	justifyContent: 'center',
	padding: '0.625rem 1rem',
	margin: '0.3125rem',
	border: 'none',
	borderRadius: '0.3125rem',
	color,
	width,
	backgroundColor,
	cursor: 'pointer',
	fontSize: '1rem',
	fontWeight: 'bold',
	textWrap: 'nowrap'
});

export const authContainerStyle: CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'center',
	justifyContent: 'center',
	width: '100%',
	maxWidth: '21.875rem',
	margin: 'auto',
	padding: '1.25rem',
	borderRadius: '0.625rem'
};

export const textButtonStyle: CSSProperties = {
	color: ' #222   ',
	fontSize: '1.25rem',
	textAlign: 'center',
	width: '100%',
	marginTop: '1.25rem',
	cursor: 'pointer'
};

export const contentStyle: CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'center',
	justifyContent: 'center',
	height: '100%'
}
