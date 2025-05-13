import { ProviderOption } from 'citra';

export type ProviderInfo = {
	name: string;
	iconUrl: string;
	primaryColor: string;
};

type ProviderData = Record<Lowercase<ProviderOption>, ProviderInfo>;

export const providerData: ProviderData = {
	'42': {
		iconUrl: '/assets/svg/42.svg',
		name: '42',
		primaryColor: '#000000'
	},
	amazoncognito: {
		iconUrl: '/assets/svg/amazoncognito.svg',
		name: 'Amazon Cognito',
		primaryColor: '#DD344C'
	},
	anilist: {
		iconUrl: '/assets/svg/anilist.svg',
		name: 'AniList',
		primaryColor: '#02A9FF'
	},
	apple: {
		iconUrl: '/assets/svg/apple.svg',
		name: 'Apple',
		primaryColor: '#000000'
	},
	atlassian: {
		iconUrl: '/assets/svg/atlassian.svg',
		name: 'Atlassian',
		primaryColor: '#0052CC'
	},
	auth0: {
		iconUrl: '/assets/svg/auth0.svg',
		name: 'Auth0',
		primaryColor: '#EB5424'
	},
	authentik: {
		iconUrl: '/assets/svg/authentik.svg',
		name: 'Authentik',
		primaryColor: '#FD4B2D'
	},
	autodesk: {
		iconUrl: '/assets/svg/autodesk.svg',
		name: 'Autodesk',
		primaryColor: '#000000'
	},
	battlenet: {
		iconUrl: '/assets/svg/battlenet.svg',
		name: 'Battle.net',
		primaryColor: '#4381C3'
	},
	bitbucket: {
		iconUrl: '/assets/svg/bitbucket.svg',
		name: 'Bitbucket',
		primaryColor: '#0052CC'
	},
	box: {
		iconUrl: '/assets/svg/box.svg',
		name: 'Box',
		primaryColor: '#0061D5'
	},
	bungie: {
		iconUrl: '/assets/svg/bungie.svg',
		name: 'Bungie',
		primaryColor: '#0075BB'
	},
	coinbase: {
		iconUrl: '/assets/svg/coinbase.svg',
		name: 'Coinbase',
		primaryColor: '#0052FF'
	},
	discord: {
		iconUrl: '/assets/svg/discord.svg',
		name: 'Discord',
		primaryColor: '#5865F2'
	},
	donationalerts: {
		iconUrl: '/assets/svg/donationalerts.svg',
		name: 'Donation Alerts',
		primaryColor: '#F57D07'
	},
	dribbble: {
		iconUrl: '/assets/svg/dribbble.svg',
		name: 'Dribbble',
		primaryColor: '#EA4C89'
	},
	dropbox: {
		iconUrl: '/assets/svg/dropbox.svg',
		name: 'Dropbox',
		primaryColor: '#0061FF'
	},
	epicgames: {
		iconUrl: '/assets/svg/epicgames.svg',
		name: 'Epic Games',
		primaryColor: '#313131'
	},
	etsy: {
		iconUrl: '/assets/svg/etsy.svg',
		name: 'Etsy',
		primaryColor: '#F16521'
	},
	facebook: {
		iconUrl: '/assets/svg/facebook.svg',
		name: 'Facebook',
		primaryColor: '#0866FF'
	},
	figma: {
		iconUrl: '/assets/svg/figma.svg',
		name: 'Figma',
		primaryColor: '#F24E1E'
	},
	gitea: {
		iconUrl: '/assets/svg/gitea.svg',
		name: 'Gitea',
		primaryColor: '#609926'
	},
	github: {
		iconUrl: '/assets/svg/GitHub_Invertocat_Dark.svg',
		name: 'GitHub',
		primaryColor: '#181717'
	},
	gitlab: {
		iconUrl: '/assets/svg/gitlab.svg',
		name: 'GitLab',
		primaryColor: '#FC6D26'
	},
	google: {
		iconUrl: '/assets/svg/google.svg',
		name: 'Google',
		primaryColor: '#4285F4'
	},
	intuit: {
		iconUrl: '/assets/svg/intuit.svg',
		name: 'Intuit',
		primaryColor: '#236CFF'
	},
	kakao: {
		iconUrl: '/assets/svg/kakao.svg',
		name: 'Kakao',
		primaryColor: '#FFCD00'
	},
	keycloak: {
		iconUrl: '/assets/svg/keycloak.svg',
		name: 'Keycloak',
		primaryColor: '#4D4D4D'
	},
	kick: {
		iconUrl: '/assets/svg/kick.svg',
		name: 'Kick',
		primaryColor: '#53FC19'
	},
	lichess: {
		iconUrl: '/assets/svg/lichess.svg',
		name: 'Lichess',
		primaryColor: '#000000'
	},
	line: {
		iconUrl: '/assets/svg/line.svg',
		name: 'LINE',
		primaryColor: '#00B900'
	},
	linear: {
		iconUrl: '/assets/svg/linear.svg',
		name: 'Linear',
		primaryColor: '#5E6AD2'
	},
	linkedin: {
		iconUrl: '/assets/svg/linkedin.svg',
		name: 'LinkedIn',
		primaryColor: '#0077B5'
	},
	mastodon: {
		iconUrl: '/assets/svg/mastodon.svg',
		name: 'Mastodon',
		primaryColor: '#6364FF'
	},
	mercadolibre: {
		iconUrl: '/assets/svg/mercadolibre.svg',
		name: 'Mercado Libre',
		primaryColor:'#FFD100'
	},
	mercadopago: {
		iconUrl: '/assets/svg/mercadopago.svg',
		name: 'Mercado Pago',
		primaryColor: '#00B1EA'
	},
	microsoftentraid: {
		iconUrl: '/assets/svg/microsoft.svg',
		name: 'Microsoft Entra ID',
		primaryColor: '#000000'
	},
	myanimelist: {
		iconUrl: '/assets/svg/myanimelist.svg',
		name: 'MyAnimeList',
		primaryColor: '#2E51A2'
	},
	naver: {
		iconUrl: '/assets/svg/naver.svg',
		name: 'Naver',
		primaryColor: '#03C75A'
	},
	notion: {
		iconUrl: '/assets/svg/notion.svg',
		name: 'Notion',
		primaryColor: '#000000'
	},
	okta: {
		iconUrl: '/assets/svg/okta.svg',
		name: 'Okta',
		primaryColor: '#007DC1'
	},
	osu: {
		iconUrl: '/assets/svg/osu.svg',
		name: 'osu!',
		primaryColor: '#FF66AA'
	},
	patreon: {
		iconUrl: '/assets/svg/patreon.svg',
		name: 'Patreon',
		primaryColor: '#000000'
	},
	polar: {
		iconUrl: '/assets/svg/polar.svg',
		name: 'Polar',
		primaryColor: '#000000'
	},
	polaraccesslink: {
		iconUrl: '/assets/svg/polar-access-link.svg',
		name: 'Polar Access Link',
		primaryColor: '#DF0827'
	},
	polarteampro: {
		iconUrl: '/assets/svg/polar-team-pro.svg',
		name: 'Polar Team Pro',
		primaryColor: '#DF0827'
	},
	reddit: {
		iconUrl: '/assets/svg/reddit.svg',
		name: 'Reddit',
		primaryColor: '#FF4500'
	},
	roblox: {
		iconUrl: '/assets/svg/roblox.svg',
		name: 'Roblox',
		primaryColor: '#000000'
	},
	salesforce: {
		iconUrl: '/assets/svg/salesforce.svg',
		name: 'Salesforce',
		primaryColor: '#00A1E0'
	},
	shikimori: {
		iconUrl: '/assets/svg/shikimori.svg',
		name: 'Shikimori',
		primaryColor: '#343434'
	},
	slack: {
		iconUrl: '/assets/svg/slack.svg',
		name: 'Slack',
		primaryColor: '#4A154B'
	},
	spotify: {
		iconUrl: '/assets/svg/spotify.svg',
		name: 'Spotify',
		primaryColor: '#1ED760'
	},
	startgg: {
		iconUrl: '/assets/svg/startgg.svg',
		name: 'Start.gg',
		primaryColor: '#2E75BA'
	},
	strava: {
		iconUrl: '/assets/svg/strava.svg',
		name: 'Strava',
		primaryColor: '#FC4C02'
	},
	synology: {
		iconUrl: '/assets/svg/synology.svg',
		name: 'Synology',
		primaryColor: '#B5B5B6'
	},
	tiktok: {
		iconUrl: '/assets/svg/tiktok.svg',
		name: 'TikTok',
		primaryColor: '#000000'
	},
	tiltify: {
		iconUrl: '/assets/svg/tiltify.svg',
		name: 'Tiltify',
		primaryColor: '#FF6D00'
	},
	tumblr: {
		iconUrl: '/assets/svg/tumblr.svg',
		name: 'Tumblr',
		primaryColor: '#36465D'
	},
	twitch: {
		iconUrl: '/assets/svg/twitch.svg',
		name: 'Twitch',
		primaryColor: '#9146FF'
	},
	twitter: {
		iconUrl: '/assets/svg/twitter.svg',
		name: 'Twitter / X',
		primaryColor: '#000000'
	},
	vk: {
		iconUrl: '/assets/svg/vk.svg',
		name: 'VK',
		primaryColor: '#0077FF'
	},
	workos: {
		iconUrl: '/assets/svg/workos.svg',
		name: 'WorkOS',
		primaryColor: '#6363F1'
	},
	yahoo: {
		iconUrl: '/assets/svg/yahoo.svg',
		name: 'Yahoo',
		primaryColor: '#5F01D1'
	},
	yandex: {
		iconUrl: '/assets/svg/yandex.svg',
		name: 'Yandex',
		primaryColor: '#5282FF'
	},
	zoom: {
		iconUrl: '/assets/svg/zoom.svg',
		name: 'Zoom',
		primaryColor: '#0B5CFF'
	}
};