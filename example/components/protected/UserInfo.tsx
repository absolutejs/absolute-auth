import { User } from '../../db/schema';
import { contentStyle } from '../../styles/styles';

type UserInfoProps = {
	user: User | undefined;
};

export const UserInfo = ({ user }: UserInfoProps) => (
	<div style={contentStyle}>
		<h1>Protected Page</h1>
		<p>{user !== undefined && user.given_name}</p>
		<p>{user !== undefined && user.family_name}</p>
		<p>{user !== undefined && user.email}</p>
		<img
			src={user?.picture ?? 'https://via.placeholder.com/150'}
			alt="Profile Picture"
			style={{ borderRadius: '50%', width: '100px' }}
		/>
	</div>
);
