import { User } from '../../db/schema';
import { contentStyle } from '../../styles/styles';
import { HighlightedJson } from '../utils/HighlightedJson';

type UserInfoProps = {
	user: User | undefined;
};

export const UserInfo = ({ user }: UserInfoProps) => (
	<div style={contentStyle}>
		<h1>Protected Page</h1>
		<HighlightedJson data={user?.metadata} />
	</div>
);
