import { ProviderOption } from 'citra';

export type ProviderInfo = {
	name: string;
	logoUrl: string;
	primaryColor: string;
};

type ProviderData = Record<Lowercase<ProviderOption>, ProviderInfo>;

export const providerData: ProviderData = {
	'42': {
		logoUrl: '/assets/svg/42-logo.svg',
		name: '42',
		primaryColor: '#000000'
	},
	amazoncognito: {
		logoUrl: '/assets/svg/amazoncognito-logo.svg',
		name: 'Amazon Cognito',
		primaryColor: '#DD344C'
	},
	anilist: {
		logoUrl: '/assets/svg/anilist-logo.svg',
		name: 'AniList',
		primaryColor: '#02A9FF'
	},
	apple: {
		logoUrl: '/assets/svg/apple-logo.svg',
		name: 'Apple',
		primaryColor: '#000000'
	},
	atlassian: {
		logoUrl: '/assets/svg/atlassian-logo.svg',
		name: 'Atlassian',
		primaryColor: '#0052CC'
	},
	auth0: {
		logoUrl: '/assets/svg/auth0-logo.svg',
		name: 'Auth0',
		primaryColor: '#EB5424'
	},
	authentik: {
		logoUrl: '/assets/svg/authentik-logo.svg',
		name: 'Authentik',
		primaryColor: '#FD4B2D'
	},
	autodesk: {
		logoUrl: '/assets/svg/autodesk-logo.svg',
		name: 'Autodesk',
		primaryColor: '#000000'
	},
	battlenet: {
		logoUrl: '/assets/svg/battlenet-logo.svg',
		name: 'Battle.net',
		primaryColor: '#4381C3'
	},
	bitbucket: {
		logoUrl: '/assets/svg/bitbucket-logo.svg',
		name: 'Bitbucket',
		primaryColor: '#0052CC'
	},
	box: {
		logoUrl: '/assets/svg/box-logo.svg',
		name: 'Box',
		primaryColor: '#0061D5'
	},
	bungie: {
		logoUrl: '/assets/svg/bungie-logo.svg',
		name: 'Bungie',
		primaryColor: '#0075BB'
	},
	coinbase: {
		logoUrl: '/assets/svg/coinbase-logo.svg',
		name: 'Coinbase',
		primaryColor: '#0052FF'
	},
	discord: {
		logoUrl: '/assets/svg/discord-logo.svg',
		name: 'Discord',
		primaryColor: '#5865F2'
	},
	donationalerts: {
		logoUrl: '/assets/svg/DA_Alert_Color-Logo.svg',
		name: 'Donation Alerts',
		primaryColor: '#F57D07'
	},
	dribbble: {
		logoUrl: '/assets/svg/dribbble-logo.svg',
		name: 'Dribbble',
		primaryColor: '#EA4C89'
	},
	dropbox: {
		logoUrl: '/assets/svg/dropbox-logo.svg',
		name: 'Dropbox',
		primaryColor: '#0061FF'
	},
	epicgames: {
		logoUrl: '/assets/svg/epicgames-logo.svg',
		name: 'Epic Games',
		primaryColor: '#313131'
	},
	etsy: {
		logoUrl: '/assets/svg/etsy-logo.svg',
		name: 'Etsy',
		primaryColor: '#F16521'
	},
	facebook: {
		logoUrl: '/assets/png/Facebook_Logo_Primary.png',
		name: 'Facebook',
		primaryColor: '#0866FF'
	},
	figma: {
		logoUrl: '/assets/svg/Figma-Icon-(Full-color).svg',
		name: 'Figma',
		primaryColor: '#F24E1E'
	},
	gitea: {
		logoUrl: '/assets/svg/gitea-logo.svg',
		name: 'Gitea',
		primaryColor: '#609926'
	},
	github: {
		logoUrl: '/assets/svg/GitHub_Invertocat_Dark.svg',
		name: 'GitHub',
		primaryColor: '#181717'
	},
	gitlab: {
		logoUrl: '/assets/svg/gitlab-logo.svg',
		name: 'GitLab',
		primaryColor: '#FC6D26'
	},
	google: {
		logoUrl: '/assets/svg/google-logo.svg',
		name: 'Google',
		primaryColor: '#4285F4'
	},
	intuit: {
		logoUrl: '/assets/svg/intuit-logo.svg',
		name: 'Intuit',
		primaryColor: '#236CFF'
	},
	kakao: {
		logoUrl: '/assets/svg/kakao-logo.svg',
		name: 'Kakao',
		primaryColor: '#FFCD00'
	},
	keycloak: {
		logoUrl: '/assets/svg/keycloak-logo.svg',
		name: 'Keycloak',
		primaryColor: '#4D4D4D'
	},
	kick: {
		logoUrl: '/assets/svg/kick-logo.svg',
		name: 'Kick',
		primaryColor: '#53FC19'
	},
	lichess: {
		logoUrl: '/assets/svg/lichess-logo.svg',
		name: 'Lichess',
		primaryColor: '#000000'
	},
	line: {
		logoUrl: '/assets/png/LINE_Brand_icon.png',
		name: 'LINE',
		primaryColor: '#00B900'
	},
	linear: {
		logoUrl: '/assets/svg/linear-logo.svg',
		name: 'Linear',
		primaryColor: '#5E6AD2'
	},
	linkedin: {
		logoUrl: '/assets/png/LI-In-Bug.png',
		name: 'LinkedIn',
		primaryColor: '#0077B5'
	},
	mastodon: {
		logoUrl: '/assets/svg/mastadon-logo-purple.svg',
		name: 'Mastodon',
		primaryColor: '#6364FF'
	},
	mercadolibre: {
		logoUrl: '/assets/jpeg/mercadolibre-logo.jpeg',
		name: 'Mercado Libre',
		primaryColor: '#FFD100'
	},
	mercadopago: {
		logoUrl: '/assets/svg/mercadopago-logo.svg',
		name: 'Mercado Pago',
		primaryColor: '#00B1EA'
	},
	microsoftentraid: {
		logoUrl: '/assets/svg/Microsoft-Entra-ID-color-icon.svg',
		name: 'Microsoft Entra ID',
		primaryColor: '#000000'
	},
	myanimelist: {
		logoUrl: '/assets/svg/myanimelist-logo.svg',
		name: 'MyAnimeList',
		primaryColor: '#2E51A2'
	},
	naver: {
		logoUrl: '/assets/png/naver-btnG_icon_circle.png',
		name: 'Naver',
		primaryColor: '#03C75A'
	},
	notion: {
		logoUrl: '/assets/svg/notion-logo.svg',
		name: 'Notion',
		primaryColor: '#000000'
	},
	okta: {
		logoUrl: '/assets/png/Okta_Wordmark_Black_S.png',
		name: 'Okta',
		primaryColor: '#007DC1'
	},
	osu: {
		logoUrl: '/assets/png/osu!logo.png',
		name: 'osu!',
		primaryColor: '#FF66AA'
	},
	patreon: {
		logoUrl: '/assets/svg/PATREON_SYMBOL_1_BLACK_RGB.svg',
		name: 'Patreon',
		primaryColor: '#000000'
	},
	polar: {
		logoUrl: '/assets/svg/polar-logo.svg',
		name: 'Polar',
		primaryColor: '#000000'
	},
	polaraccesslink: {
		logoUrl: '/assets/png/Polar_logo_black_web.png',
		name: 'Polar Access Link',
		primaryColor: '#DF0827'
	},
	polarteampro: {
		logoUrl: '/assets/png/Polar_logo_black_web.png',
		name: 'Polar Team Pro',
		primaryColor: '#DF0827'
	},
	reddit: {
		logoUrl: '/assets/svg/Reddit_Icon_FullColor.svg',
		name: 'Reddit',
		primaryColor: '#FF4500'
	},
	roblox: {
		logoUrl: '/assets/svg/roblox-logo.svg',
		name: 'Roblox',
		primaryColor: '#000000'
	},
	salesforce: {
		logoUrl: '/assets/svg/salesforce-logo.svg',
		name: 'Salesforce',
		primaryColor: '#00A1E0'
	},
	shikimori: {
		logoUrl: '/assets/svg/shikimori-logo.svg',
		name: 'Shikimori',
		primaryColor: '#343434'
	},
	slack: {
		logoUrl: '/assets/png/SLA-Slack-from-Salesforce-logo.png',
		name: 'Slack',
		primaryColor: '#4A154B'
	},
	spotify: {
		logoUrl: '/assets/svg/spotify-Primary_Logo_Green_RGB.svg',
		name: 'Spotify',
		primaryColor: '#1ED760'
	},
	startgg: {
		logoUrl: '/assets/svg/start.gg_Icon_RGB.svg',
		name: 'Start.gg',
		primaryColor: '#2E75BA'
	},
	strava: {
		logoUrl: '/assets/svg/strava-logo.svg',
		name: 'Strava',
		primaryColor: '#FC4C02'
	},
	synology: {
		logoUrl: '/assets/png/Synology_logo_Standard.png',
		name: 'Synology',
		primaryColor: '#B5B5B6'
	},
	tiktok: {
		logoUrl: '/assets/svg/tiktok-logo.svg',
		name: 'TikTok',
		primaryColor: '#000000'
	},
	tiltify: {
		logoUrl: '/assets/svg/rgb-tiltify22_mark_blue.svg',
		name: 'Tiltify',
		primaryColor: '#143DF4'
	},
	tumblr: {
		logoUrl: '/assets/svg/tumblr.svg', // TODO: add logo
		name: 'Tumblr',
		primaryColor: '#36465D'
	},
	twitch: {
		logoUrl: '/assets/svg/twitch-glitch_flat_purple.svg',
		name: 'Twitch',
		primaryColor: '#9146FF'
	},
	twitter: {
		logoUrl: '/assets/png/twitter-logo-black.png',
		name: 'Twitter / X',
		primaryColor: '#000000'
	},
	vk: {
		logoUrl: '/assets/svg/vk-logo.svg',
		name: 'VK',
		primaryColor: '#0077FF'
	},
	workos: {
		logoUrl: '/assets/svg/workos-logo-color.svg',
		name: 'WorkOS',
		primaryColor: '#6363F1'
	},
	yahoo: {
		logoUrl: '/assets/jpeg/yahoo-Icon.jpeg',
		name: 'Yahoo',
		primaryColor: '#5F01D1'
	},
	yandex: {
		logoUrl: '/assets/svg/yandex-icon_grad_circ.svg',
		name: 'Yandex',
		primaryColor: '#5282FF'
	},
	zoom: {
		logoUrl: '/assets/png/Zoom_Logo_Bloom_RGB.png',
		name: 'Zoom',
		primaryColor: '#0B5CFF'
	}
};
