import { Navbar } from '../components/navbar/Navbar';
import { Head } from '../components/page/Head';
import { UserInfo } from '../components/protected/UserInfo';
import { useAuthStatus } from '../hooks/useAuthStatus';

import { htmlDefault, bodyDefault, mainDefault, buttonStyle } from '../styles/styles';
import { ToastProvider, useToast } from '../components/utils/ToastProvider';
import { ProviderButtons } from '../components/protected/ProviderButtons';

export const Protected = () => {
	const { user, handleSignOut } = useAuthStatus();

	return (
		<html lang="en" style={htmlDefault}>
			<Head />
			<body style={bodyDefault}>
				<Navbar user={user} handleSignOut={handleSignOut} />
				<main style={mainDefault}>
					<UserInfo user={user} />
					<ToastProvider>
						<ProviderButtons user={user} />
					</ToastProvider>
				</main>
			</body>
		</html>
	);
};
