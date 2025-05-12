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
		<a href="/" style={{ alignItems: 'center', display: 'flex' }}>
			<img
				src="/assets/svg/eg-logo-no-text.svg"
				alt="EventGames.io Logo"
				style={{ height: 'auto', width: '4rem' }}
			/>
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
