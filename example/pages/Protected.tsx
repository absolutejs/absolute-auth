import { Navbar } from '../components/navbar/Navbar';
import { Head } from '../components/page/Head';
import { ProviderButtons } from '../components/protected/ProviderButtons';
import { UserInfo } from '../components/protected/UserInfo';
import { ToastProvider } from '../components/utils/ToastProvider';
import { useAuthStatus } from '../hooks/useAuthStatus';

import { htmlDefault, bodyDefault, mainDefault } from '../styles/styles';

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
						<ProviderButtons
							user={user}
							handleSignOut={handleSignOut}
						/>
					</ToastProvider>
				</main>
			</body>
		</html>
	);
};
