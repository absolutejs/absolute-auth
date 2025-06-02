import { animated } from '@react-spring/web';
import { User } from '../../db/schema';
import { buttonStyle, primaryColor } from '../../styles/styles';
import { ProfilePicture } from '../utils/ProfilePicture';

type HamburgerUserButtonsProps = {
	user: User | undefined;
	handleSignOut: () => Promise<void>;
	openModal: () => void;
};

export const HamburgerUserButtons = ({
	user,
	handleSignOut,
	openModal
}: HamburgerUserButtonsProps) => (
	<div
		style={{
			alignItems: 'center',
			display: 'flex',
			justifyContent: 'space-between',
			width: '100%'
		}}
	>
		{user !== undefined && (
			<div
				style={{
					alignItems: 'center',
					display: 'flex',
					flexDirection: 'row'
				}}
			>
				<animated.a href="/portal">
					<ProfilePicture
						userImage={
							typeof user.metadata?.picture === 'string'
								? user.metadata.picture
								: undefined
						}
						backupImage={'/assets/svg/default-account-icon.svg'}
						width="100%"
						height="100%"
					/>
				</animated.a>
				<span style={{ color: primaryColor, fontSize: '1.3rem' }}>
					{'User'}
					{/* TODO: Add the actual user info */}
				</span>
			</div>
		)}
		<button
			onClick={user ? () => handleSignOut() : openModal}
			style={buttonStyle({
				backgroundColor: primaryColor,
				color: 'white',
				width: '100%'
			})}
		>
			{user ? 'SignOut' : 'Login'}
		</button>
	</div>
);
