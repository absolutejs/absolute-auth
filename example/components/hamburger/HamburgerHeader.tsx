import { FaTimes } from 'react-icons/fa';
import { primaryColor } from '../../styles/styles';

type HamburgerHeaderProps = {
	onClose: () => void;
};

export const HamburgerHeader = ({ onClose }: HamburgerHeaderProps) => (
	<div
		style={{
			alignItems: 'center',
			backgroundColor: primaryColor,
			boxShadow: `0px 4px 14px rgba(0, 0, 0, 0.1)`,
			display: 'flex',
			justifyContent: 'space-between',
			left: 0,
			maxHeight: '100px',
			padding: '1.1rem',
			position: 'absolute',
			top: 0,
			width: '100%'
		}}
	>
		<a href="/" style={{
			color: '#fff',
			fontSize: '1.5rem',
			fontWeight: 'bold',
			textDecoration: 'none'
		}}>
			Absolute Auth
		</a>
		<FaTimes
			style={{
				color: '#fff',
				cursor: 'pointer',
				fontSize: '34px'
			}}
			onClick={onClose}
		/>
	</div>
);
