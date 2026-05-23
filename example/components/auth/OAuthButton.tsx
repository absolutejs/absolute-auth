import { ProviderOption } from 'citra';
import { FiUser } from 'react-icons/fi';
import {
	oauthButtonContentStyle,
	oauthButtonStyle,
	oauthButtonTextStyle,
	oauthIconStyle
} from '../../styles/authModalStyles';
import { providerData, ProviderInfo } from '../../utils/providerData';

type OAuthButtonProps = {
	action?: 'login' | 'signup' | 'link';
	provider: Lowercase<ProviderOption> | undefined;
};

const providersRequiringLoginClient = new Set<Lowercase<ProviderOption>>([
	'facebook',
	'google'
]);

const buildAuthorizationHref = (
	provider: Lowercase<ProviderOption> | undefined
) => {
	if (!provider) return undefined;
	if (providersRequiringLoginClient.has(provider)) {
		return `/oauth2/${provider}/authorization?client=login`;
	}

	return `/oauth2/${provider}/authorization`;
};

const buildButtonText = (
	action: 'login' | 'signup' | 'link',
	providerName: string
) => {
	switch (action) {
		case 'signup':
			return `Sign up with ${providerName}`;
		case 'link':
			return `Link ${providerName}`;
		case 'login':
		default:
			return `Sign in with ${providerName}`;
	}
};

export const OAuthButton = ({
	action = 'login',
	provider
}: OAuthButtonProps) => {
	const defaultData: ProviderInfo = {
		logoUrl: '/assets/svg/todo-put-file.svg',
		name: 'other provider',
		primaryColor: 'lightgray'
	};

	const { logoUrl, name, primaryColor } =
		provider && providerData[provider]
			? providerData[provider]
			: defaultData;

	const isProviderSelected = provider !== undefined;

	return (
		<a
			href={buildAuthorizationHref(provider)}
			style={oauthButtonStyle({
				isProviderSelected,
				providerPrimaryColor: isProviderSelected
					? primaryColor
					: '#999999'
			})}
		>
			<div style={oauthButtonContentStyle}>
				{provider ? (
					<img
						src={logoUrl}
						alt={`${name} logo`}
						style={oauthIconStyle}
					/>
				) : (
					<FiUser style={oauthIconStyle} />
				)}
				<span style={oauthButtonTextStyle}>
					{buildButtonText(action, name)}
				</span>
			</div>
		</a>
	);
};
