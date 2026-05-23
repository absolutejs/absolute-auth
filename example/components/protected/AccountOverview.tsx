import { User } from '../../db/schema';
import { useAuthIdentityPayload } from '../../hooks/useAuthIdentityPayload';
import { contentStyle } from '../../styles/styles';

type AccountOverviewProps = {
	user: User | undefined;
};

const cardStyle = {
	background: '#fff',
	border: '1px solid #d9e2ec',
	borderRadius: '0.75rem',
	boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
	padding: '1rem',
	width: 'min(960px, 92vw)'
} as const;

export const AccountOverview = ({ user }: AccountOverviewProps) => {
	const { payload } = useAuthIdentityPayload();

	return (
		<div
			style={{
				...contentStyle,
				gap: '1rem',
				justifyContent: 'flex-start'
			}}
		>
			<div style={cardStyle}>
				<h1>Account Settings</h1>
				<p>
					This page distinguishes the canonical AbsoluteJS account
					from linked auth identities. The user row stores clean
					extracted fields instead of a raw provider metadata blob.
				</p>
			</div>
			<div style={cardStyle}>
				<h2>Canonical Account Record</h2>
				<p>
					<strong>sub:</strong> {user?.sub ?? 'n/a'}
				</p>
				<p>
					<strong>First name:</strong> {user?.first_name ?? 'n/a'}
				</p>
				<p>
					<strong>Last name:</strong> {user?.last_name ?? 'n/a'}
				</p>
				<p>
					<strong>Email:</strong> {user?.email ?? 'n/a'}
				</p>
				<p>
					<strong>Created:</strong>{' '}
					{user?.created_at
						? new Date(user.created_at).toLocaleString()
						: 'n/a'}
				</p>
				<p>
					<strong>Primary identity id:</strong>{' '}
					{payload?.primaryIdentityId ??
						user?.primary_auth_identity_id ??
						'n/a'}
				</p>
				<p>
					These fields are synced from the current primary linked
					identity when the account is created or the primary identity
					changes.
				</p>
			</div>
		</div>
	);
};
