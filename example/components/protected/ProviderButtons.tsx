import { isRefreshableProviderOption } from 'citra';
import { User } from '../../db/schema';
import { buttonStyle } from '../../styles/styles';
import { useToast } from '../utils/ToastProvider';

type ProviderButtonsProps = {
	user: User | undefined;
};

export const ProviderButtons = ({ user }: ProviderButtonsProps) => {
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

	return (
		<nav>
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
		</nav>
	);
};
