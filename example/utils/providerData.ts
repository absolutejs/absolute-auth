import { ProviderOption } from 'citra';

export type ProviderInfo = {
	name: string;
	logoUrl: string;
	primaryColor: string;
};

type ProviderData = Record<Lowercase<ProviderOption>, ProviderInfo>;

export const providerData: ProviderData = {
	'42': {
		logoUrl: '/assets/svg/42.svg',
		name: '42',
		primaryColor: '#000000'
	},
	amazoncognito: {
		logoUrl: '/assets/svg/amazoncognito.svg',
		name: 'Amazon Cognito',
		primaryColor: '#DD344C'
	},
	anilist: {
		logoUrl: '/assets/svg/anilist.svg',
		name: 'AniList',
		primaryColor: '#02A9FF'
	},
	apple: {
		logoUrl: '/assets/svg/apple.svg',
		name: 'Apple',
		primaryColor: '#000000'
	},
	atlassian: {
		logoUrl: '/assets/svg/atlassian.svg',
		name: 'Atlassian',
		primaryColor: '#0052CC'
	},
	auth0: {
		logoUrl: '/assets/svg/auth0.svg',
		name: 'Auth0',
		primaryColor: '#EB5424'
	},
	authentik: {
		logoUrl: '/assets/svg/authentik.svg',
		name: 'Authentik',
		primaryColor: '#FD4B2D'
	},
	autodesk: {
		logoUrl: '/assets/svg/autodesk.svg',
		name: 'Autodesk',
		primaryColor: '#000000'
	},
	battlenet: {
		logoUrl: '/assets/svg/battlenet.svg',
		name: 'Battle.net',
		primaryColor: '#4381C3'
	},
	bitbucket: {
		logoUrl: '/assets/svg/bitbucket.svg',
		name: 'Bitbucket',
		primaryColor: '#0052CC'
	},
	box: {
		logoUrl: '/assets/svg/box.svg',
		name: 'Box',
		primaryColor: '#0061D5'
	},
	bungie: {
		logoUrl: '/assets/svg/bungie.svg',
		name: 'Bungie',
		primaryColor: '#0075BB'
	},
	coinbase: {
		logoUrl: '/assets/svg/coinbase.svg',
		name: 'Coinbase',
		primaryColor: '#0052FF'
	},
	discord: {
		logoUrl: '/assets/svg/discord.svg',
		name: 'Discord',
		primaryColor: '#5865F2'
	},
	donationalerts: {
		logoUrl: '/assets/svg/donationalerts.svg',
		name: 'Donation Alerts',
		primaryColor: '#F57D07'
	},
	dribbble: {
		logoUrl: '/assets/svg/dribbble.svg',
		name: 'Dribbble',
		primaryColor: '#EA4C89'
	},
	dropbox: {
		logoUrl: '/assets/svg/dropbox.svg',
		name: 'Dropbox',
		primaryColor: '#0061FF'
	},
	epicgames: {
		logoUrl: '/assets/svg/epicgames.svg',
		name: 'Epic Games',
		primaryColor: '#313131'
	},
	etsy: {
		logoUrl: '/assets/svg/etsy.svg',
		name: 'Etsy',
		primaryColor: '#F16521'
	},
	facebook: {
		logoUrl: '/assets/svg/facebook.svg',
		name: 'Facebook',
		primaryColor: '#0866FF'
	},
	figma: {
		logoUrl: '/assets/svg/figma.svg',
		name: 'Figma',
		primaryColor: '#F24E1E'
	},
	gitea: {
		logoUrl: '/assets/svg/gitea.svg',
		name: 'Gitea',
		primaryColor: '#609926'
	},
	github: {
		logoUrl: '/assets/svg/GitHub_Invertocat_Dark.svg',
		name: 'GitHub',
		primaryColor: '#181717'
	},
	gitlab: {
		logoUrl: '/assets/svg/gitlab.svg',
		name: 'GitLab',
		primaryColor: '#FC6D26'
	},
	google: {
		logoUrl: '/assets/svg/google.svg',
		name: 'Google',
		primaryColor: '#4285F4'
	},
	intuit: {
		logoUrl: '/assets/svg/intuit.svg',
		name: 'Intuit',
		primaryColor: '#236CFF'
	},
	kakao: {
		logoUrl: '/assets/svg/kakao.svg',
		name: 'Kakao',
		primaryColor: '#FFCD00'
	},
	keycloak: {
		logoUrl: '/assets/svg/keycloak.svg',
		name: 'Keycloak',
		primaryColor: '#4D4D4D'
	},
	kick: {
		logoUrl: '/assets/svg/kick.svg',
		name: 'Kick',
		primaryColor: '#53FC19'
	},
	lichess: {
		logoUrl: '/assets/svg/lichess.svg',
		name: 'Lichess',
		primaryColor: '#000000'
	},
	line: {
		logoUrl: '/assets/svg/line.svg',
		name: 'LINE',
		primaryColor: '#00B900'
	},
	linear: {
		logoUrl: '/assets/svg/linear.svg',
		name: 'Linear',
		primaryColor: '#5E6AD2'
	},
	linkedin: {
		logoUrl: '/assets/svg/linkedin.svg',
		name: 'LinkedIn',
		primaryColor: '#0077B5'
	},
	mastodon: {
		logoUrl: '/assets/svg/mastodon.svg',
		name: 'Mastodon',
		primaryColor: '#6364FF'
	},
	mercadolibre: {
		logoUrl: '/assets/svg/mercadolibre.svg',
		name: 'Mercado Libre',
		primaryColor:'#FFD100'
	},
	mercadopago: {
		logoUrl: '/assets/svg/mercadopago.svg',
		name: 'Mercado Pago',
		primaryColor: '#00B1EA'
	},
	microsoftentraid: {
		logoUrl: '/assets/svg/microsoft.svg',
		name: 'Microsoft Entra ID',
		primaryColor: '#000000'
	},
	myanimelist: {
		logoUrl: '/assets/svg/myanimelist.svg',
		name: 'MyAnimeList',
		primaryColor: '#2E51A2'
	},
	naver: {
		logoUrl: '/assets/svg/naver.svg',
		name: 'Naver',
		primaryColor: '#03C75A'
	},
	notion: {
		logoUrl: '/assets/svg/notion.svg',
		name: 'Notion',
		primaryColor: '#000000'
	},
	okta: {
		logoUrl: '/assets/svg/okta.svg',
		name: 'Okta',
		primaryColor: '#007DC1'
	},
	osu: {
		logoUrl: '/assets/svg/osu.svg',
		name: 'osu!',
		primaryColor: '#FF66AA'
	},
	patreon: {
		logoUrl: '/assets/svg/patreon.svg',
		name: 'Patreon',
		primaryColor: '#000000'
	},
	polar: {
		logoUrl: '/assets/svg/polar.svg',
		name: 'Polar',
		primaryColor: '#000000'
	},
	polaraccesslink: {
		logoUrl: '/assets/svg/polar-access-link.svg',
		name: 'Polar Access Link',
		primaryColor: '#DF0827'
	},
	polarteampro: {
		logoUrl: '/assets/svg/polar-team-pro.svg',
		name: 'Polar Team Pro',
		primaryColor: '#DF0827'
	},
	reddit: {
		logoUrl: '/assets/svg/reddit.svg',
		name: 'Reddit',
		primaryColor: '#FF4500'
	},
	roblox: {
		logoUrl: '/assets/svg/roblox.svg',
		name: 'Roblox',
		primaryColor: '#000000'
	},
	salesforce: {
		logoUrl: '/assets/svg/salesforce.svg',
		name: 'Salesforce',
		primaryColor: '#00A1E0'
	},
	shikimori: {
		logoUrl: '/assets/svg/shikimori.svg',
		name: 'Shikimori',
		primaryColor: '#343434'
	},
	slack: {
		logoUrl: '/assets/svg/slack.svg',
		name: 'Slack',
		primaryColor: '#4A154B'
	},
	spotify: {
		logoUrl: '/assets/svg/spotify.svg',
		name: 'Spotify',
		primaryColor: '#1ED760'
	},
	startgg: {
		logoUrl: '/assets/svg/startgg.svg',
		name: 'Start.gg',
		primaryColor: '#2E75BA'
	},
	strava: {
		logoUrl: '/assets/svg/strava.svg',
		name: 'Strava',
		primaryColor: '#FC4C02'
	},
	synology: {
		logoUrl: '/assets/svg/synology.svg',
		name: 'Synology',
		primaryColor: '#B5B5B6'
	},
	tiktok: {
		logoUrl: '/assets/svg/tiktok.svg',
		name: 'TikTok',
		primaryColor: '#000000'
	},
	tiltify: {
		logoUrl: '/assets/svg/tiltify.svg',
		name: 'Tiltify',
		primaryColor: '#FF6D00'
	},
	tumblr: {
		logoUrl: '/assets/svg/tumblr.svg',
		name: 'Tumblr',
		primaryColor: '#36465D'
	},
	twitch: {
		logoUrl: '/assets/svg/twitch.svg',
		name: 'Twitch',
		primaryColor: '#9146FF'
	},
	twitter: {
		logoUrl: '/assets/svg/twitter.svg',
		name: 'Twitter / X',
		primaryColor: '#000000'
	},
	vk: {
		logoUrl: '/assets/svg/vk.svg',
		name: 'VK',
		primaryColor: '#0077FF'
	},
	workos: {
		logoUrl: '/assets/svg/workos.svg',
		name: 'WorkOS',
		primaryColor: '#6363F1'
	},
	yahoo: {
		logoUrl: '/assets/svg/yahoo.svg',
		name: 'Yahoo',
		primaryColor: '#5F01D1'
	},
	yandex: {
		logoUrl: '/assets/svg/yandex.svg',
		name: 'Yandex',
		primaryColor: '#5282FF'
	},
	zoom: {
		logoUrl: '/assets/svg/zoom.svg',
		name: 'Zoom',
		primaryColor: '#0B5CFF'
	}
};