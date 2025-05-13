import { isRefreshableProviderOption, isRevocableProviderOption } from 'citra';
import { User } from '../../db/schema';
import { buttonStyle } from '../../styles/styles';
import { useToast } from '../utils/ToastProvider';

type ProviderButtonsProps = {
	user: User | undefined;
	handleSignOut: () => Promise<void>;
};

export const ProviderButtons = ({
	user,
	handleSignOut
}: ProviderButtonsProps) => {
	const { addToast } = useToast();
	const provider = user?.auth_sub?.split('|')[0];

	const handleRefresh = async () => {
		const response = await fetch('/oauth2/tokens', {
			method: 'POST'
		});

		if (!response.ok) {
			const errorText = await response.text();
			addToast({
				duration: 0,
				message: `${errorText}`,
				style: { background: '#f8d7da', color: '#721c24' }
			});

			return;
		}
		addToast({
			message: 'Refreshed profile successfully!',
			style: { background: '#d4edda', color: '#155724' }
		});
	};

	const handleRevocation = async () => {
		const response = await fetch('/oauth2/revocation', {
			method: 'POST'
		});
		if (!response.ok) {
			const errorText = await response.text();
			addToast({
				duration: 0,
				message: `${errorText}`,
				style: { background: '#f8d7da', color: '#721c24' }
			});

			return;
		}
		addToast({
			message: 'Revoked profile successfully!',
			style: { background: '#d4edda', color: '#155724' }
		});
		await handleSignOut();
	};

	const handleProfile = async () => {
		const response = await fetch('/oauth2/profile', {
			method: 'GET'
		});
		if (!response.ok) {
			const errorText = await response.text();
			addToast({
				duration: 0,
				message: `${errorText}`,
				style: { background: '#f8d7da', color: '#721c24' }
			});

			return;
		}
		addToast({
			message: 'Profile fetched successfully!',
			style: { background: '#d4edda', color: '#155724' }
		});
	};

	return (
		<nav
			style={{
				display: 'flex',
				flexDirection: 'column',
				gap: '1rem',
				marginTop: '1rem'
			}}
		>
			{isRefreshableProviderOption(provider ?? '') === true && (
				<button
					style={buttonStyle({
						backgroundColor: 'blue',
						color: 'white'
					})}
					onClick={handleRefresh}
				>
					Refresh
				</button>
			)}
			{provider !== undefined && (
				<button
					style={buttonStyle({
						backgroundColor: 'green',
						color: 'white'
					})}
					onClick={handleProfile}
				>
					Profile
				</button>
			)}
			{isRevocableProviderOption(provider ?? '') === true && (
				<button
					style={buttonStyle({
						backgroundColor: 'red',
						color: 'white'
					})}
					onClick={handleRevocation}
				>
					Revoke
				</button>
			)}
		</nav>
	);
};
