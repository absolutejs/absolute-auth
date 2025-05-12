import { isRefreshableProviderOption } from 'citra';
import { Navbar } from '../components/navbar/Navbar';
import { Head } from '../components/page/Head';
import { UserInfo } from '../components/protected/UserInfo';
import { useAuthStatus } from '../hooks/useAuthStatus';

import { htmlDefault, bodyDefault, mainDefault } from '../styles/styles';

export const Protected = () => {
	const { user, handleSignOut } = useAuthStatus();

	const provider = user?.auth_sub?.split('|')[0];

	return (
		<html lang="en" style={htmlDefault}>
			<Head />
			<body style={bodyDefault}>
				<Navbar user={user} handleSignOut={handleSignOut} />
				<main style={mainDefault}>
					<UserInfo user={user} />
					{isRefreshableProviderOption(provider ?? '') === true && (
						<button>
							<a href="/oauth2/provider/tokens">Refresh</a>
						</button>
					)}
				</main>
			</body>
		</html>
	);
};
