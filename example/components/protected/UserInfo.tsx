import { User } from '../../db/schema';
import { contentStyle } from '../../styles/styles';
import { HighlightedJson } from '../utils/HighlightedJson';

type UserInfoProps = {
	user: User | undefined;
	heading?: string;
};

export const UserInfo = ({
	user,
	heading = 'Protected Page'
}: UserInfoProps) => (
	<div style={contentStyle}>
		<h1>{heading}</h1>
		<HighlightedJson data={user} />
	</div>
);
