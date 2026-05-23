import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Navbar } from '../components/navbar/Navbar';
import { Head } from '../components/page/Head';
import { AccountOverview } from '../components/protected/AccountOverview';
import { DeleteAccountSection } from '../components/protected/DeleteAccountSection';
import { LinkedAuthIdentitiesPanel } from '../components/protected/LinkedAuthIdentitiesPanel';
import { ProviderButtons } from '../components/protected/ProviderButtons';
import { SettingsNoticeToast } from '../components/protected/SettingsNoticeToast';
import { ToastProvider } from '../components/utils/ToastProvider';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { bodyDefault, htmlDefault, mainDefault } from '../styles/styles';

export const Settings = () => {
	const { user, handleSignOut } = useAuthStatus();
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						refetchOnWindowFocus: false
					}
				}
			})
	);

	return (
		<html lang="en" style={htmlDefault}>
			<Head />
			<body style={bodyDefault}>
				<Navbar user={user} handleSignOut={handleSignOut} />
				<main style={mainDefault}>
					<QueryClientProvider client={queryClient}>
						<AccountOverview user={user} />
						<ToastProvider>
							<SettingsNoticeToast />
							<ProviderButtons />
							<LinkedAuthIdentitiesPanel />
							<DeleteAccountSection onSignedOut={handleSignOut} />
						</ToastProvider>
					</QueryClientProvider>
				</main>
			</body>
		</html>
	);
};
