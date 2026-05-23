import { Navbar } from '../components/navbar/Navbar';
import { Head } from '../components/page/Head';
import { LinkedProvidersPanel } from '../components/protected/LinkedProvidersPanel';
import { ToastProvider } from '../components/utils/ToastProvider';
import { useAuthStatus } from '../hooks/useAuthStatus';
import {
	bodyDefault,
	buttonStyle,
	htmlDefault,
	mainDefault
} from '../styles/styles';

const connectorSectionStyle = {
	backgroundColor: '#ffffff',
	borderRadius: '0.75rem',
	boxShadow: '0 10px 30px rgba(0, 0, 0, 0.08)',
	display: 'flex',
	flexDirection: 'column' as const,
	gap: '1rem',
	margin: '2rem auto 1rem',
	maxWidth: '52rem',
	padding: '2rem',
	width: '100%'
};

const connectorButtonRowStyle = {
	display: 'flex',
	flexWrap: 'wrap' as const,
	gap: '0.75rem'
};

const helperCardStyle = {
	backgroundColor: '#ffffff',
	borderRadius: '0.75rem',
	boxShadow: '0 10px 30px rgba(0, 0, 0, 0.08)',
	margin: '0 auto 2rem',
	maxWidth: '52rem',
	padding: '1.25rem 2rem',
	width: '100%'
};

export const Connectors = () => {
	const { user, handleSignOut } = useAuthStatus();

	return (
		<html lang="en" style={htmlDefault}>
			<Head />
			<body style={bodyDefault}>
				<Navbar user={user} handleSignOut={handleSignOut} />
				<main style={mainDefault}>
					<ToastProvider>
						<section style={connectorSectionStyle}>
							<div>
								<h1>Connectors</h1>
								<p>
									Link external data sources here. App login
									stays on the regular auth flow. Connector
									linking uses the connector client when a
									provider needs one.
								</p>
							</div>
							<div style={connectorButtonRowStyle}>
								<a
									href="/oauth2/google/authorization?client=connector"
									style={buttonStyle({
										backgroundColor: '#4285F4',
										color: 'white'
									})}
								>
									Link Google / Gmail
								</a>
								<a
									href="/oauth2/facebook/authorization?client=connector"
									style={buttonStyle({
										backgroundColor: '#0866FF',
										color: 'white'
									})}
								>
									Link Meta Connector
								</a>
							</div>
							<p>
								Google and Meta both use connector-specific auth
								configs here so login scopes stay minimal.
							</p>
						</section>
						{user ? (
							<LinkedProvidersPanel />
						) : (
							<section style={helperCardStyle}>
								<h2>Active Connectors</h2>
								<p>
									Sign in to see your active linked connectors
									and manage grant and binding state.
								</p>
							</section>
						)}
					</ToastProvider>
				</main>
			</body>
		</html>
	);
};
