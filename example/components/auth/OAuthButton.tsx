import { ProviderOption } from 'citra';
import {
	oauthButtonStyle,
	oauthButtonContentStyle,
	oauthIconStyle,
	oauthButtonTextStyle
} from '../../styles/authModalStyles';
import { providerData, ProviderInfo } from '../../utils/providerData';

type OAuthButtonProps = {
	mode: 'login' | 'signup';
	provider?: Lowercase<ProviderOption>;
};

export const OAuthButton = ({ mode, provider }: OAuthButtonProps) => {
	const defaultData: ProviderInfo = {
		iconUrl: '/assets/svg/todo-put-file.svg',
		name: 'other provider',
		primaryColor: 'lightgray'
	};

	const { iconUrl, name, primaryColor } =
		provider && providerData[provider]
			? providerData[provider]
			: defaultData;

	return (
		<a
			href={provider ? `/oauth2/${provider}/authorization` : undefined}
			style={oauthButtonStyle}
		>
			<div style={oauthButtonContentStyle}>
				<img
					src={iconUrl}
					alt={`${name} Icon`}
					style={oauthIconStyle}
				/>
				<span style={oauthButtonTextStyle}>
					{mode === 'login'
						? `Sign in with ${name}`
						: `Sign up with ${name}`}
				</span>
			</div>
		</a>
	);
};
