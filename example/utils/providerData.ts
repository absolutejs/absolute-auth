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
		iconUrl: '/assets/svg/amazon-cognito.svg',
		name: 'Amazon Cognito',
		primaryColor: '#FF9900'
	},
	anilist: {
		iconUrl: '/assets/svg/anilist.svg',
		name: 'AniList',
		primaryColor: '#FF4F00'
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
		primaryColor: '#E94E77'
	},
	authentik: {
		iconUrl: '/assets/svg/authentik.svg',
		name: 'Authentik',
		primaryColor: '#FF4F00'
	},
	autodesk: {
		iconUrl: '/assets/svg/autodesk.svg',
		name: 'Autodesk',
		primaryColor: '#FF4F00'
	},
	battlenet: {
		iconUrl: '/assets/svg/battlenet.svg',
		name: 'Battle.net',
		primaryColor: '#00A3E0'
	},
	bitbucket: {
		iconUrl: '/assets/svg/bitbucket.svg',
		name: 'Bitbucket',
		primaryColor: '#0052CC'
	},
	box: {
		iconUrl: '/assets/svg/box.svg',
		name: 'Box',
		primaryColor: '#0061FF'
	},
	bungie: {
		iconUrl: '/assets/svg/bungie.svg',
		name: 'Bungie',
		primaryColor: '#FF4F00'
	},
	coinbase: {
		iconUrl: '/assets/svg/coinbase.svg',
		name: 'Coinbase',
		primaryColor: '#0052CC'
	},
	discord: {
		iconUrl: '/assets/svg/discord.svg',
		name: 'Discord',
		primaryColor: '#7289DA'
	},
	donationalerts: {
		iconUrl: '/assets/svg/donationalerts.svg',
		name: 'Donation Alerts',
		primaryColor: '#FF4F00'
	},
	dribbble: {
		iconUrl: '/assets/svg/dribbble.svg',
		name: 'Dribbble',
		primaryColor: '#EA4C39'
	},
	dropbox: {
		iconUrl: '/assets/svg/dropbox.svg',
		name: 'Dropbox',
		primaryColor: '#007EE5'
	},
	epicgames: {
		iconUrl: '/assets/svg/epicgames.svg',
		name: 'Epic Games',
		primaryColor: '#313131'
	},
	etsy: {
		iconUrl: '/assets/svg/etsy.svg',
		name: 'Etsy',
		primaryColor: '#E03C31'
	},
	facebook: {
		iconUrl: '/assets/svg/facebook.svg',
		name: 'Facebook',
		primaryColor: '#1877F2'
	},
	figma: {
		iconUrl: '/assets/svg/figma.svg',
		name: 'Figma',
		primaryColor: '#F24E1E'
	},
	gitea: {
		iconUrl: '/assets/svg/gitea.svg',
		name: 'Gitea',
		primaryColor: '#00A84D'
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
		primaryColor: '#FF4F00'
	},
	kakao: {
		iconUrl: '/assets/svg/kakao.svg',
		name: 'Kakao',
		primaryColor: '#FF4F00'
	},
	keycloak: {
		iconUrl: '/assets/svg/keycloak.svg',
		name: 'Keycloak',
		primaryColor: '#000000'
	},
	kick: {
		iconUrl: '/assets/svg/kick.svg',
		name: 'Kick',
		primaryColor: '#FF4F00'
	},
	lichess: {
		iconUrl: '/assets/svg/lichess.svg',
		name: 'Lichess',
		primaryColor: '#FF4F00'
	},
	line: {
		iconUrl: '/assets/svg/line.svg',
		name: 'LINE',
		primaryColor: '#00B900'
	},
	linear: {
		iconUrl: '/assets/svg/linear.svg',
		name: 'Linear',
		primaryColor: '#FF4F00'
	},
	linkedin: {
		iconUrl: '/assets/svg/linkedin.svg',
		name: 'LinkedIn',
		primaryColor: '#0077B5'
	},
	mastodon: {
		iconUrl: '/assets/svg/mastodon.svg',
		name: 'Mastodon',
		primaryColor: '#000000'
	},
	mercadolibre: {
		iconUrl: '/assets/svg/mercadolibre.svg',
		name: 'Mercado Libre',
		primaryColor: '#FF4F00'
	},
	mercadopago: {
		iconUrl: '/assets/svg/mercadopago.svg',
		name: 'Mercado Pago',
		primaryColor: '#FF4F00'
	},
	microsoftentraid: {
		iconUrl: '/assets/svg/microsoft.svg',
		name: 'Microsoft Entra ID',
		primaryColor: '#FF4F00'
	},
	myanimelist: {
		iconUrl: '/assets/svg/myanimelist.svg',
		name: 'MyAnimeList',
		primaryColor: '#FF4F00'
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
		primaryColor: '#00B2E2'
	},
	osu: {
		iconUrl: '/assets/svg/osu.svg',
		name: 'osu!',
		primaryColor: '#FF4F00'
	},
	patreon: {
		iconUrl: '/assets/svg/patreon.svg',
		name: 'Patreon',
		primaryColor: '#FF4F00'
	},
	polar: {
		iconUrl: '/assets/svg/polar.svg',
		name: 'Polar',
		primaryColor: '#FF4F00'
	},
	polaraccesslink: {
		iconUrl: '/assets/svg/polar-access-link.svg',
		name: 'Polar Access Link',
		primaryColor: '#FF4F00'
	},
	polarteampro: {
		iconUrl: '/assets/svg/polar-team-pro.svg',
		name: 'Polar Team Pro',
		primaryColor: '#FF4F00'
	},
	reddit: {
		iconUrl: '/assets/svg/reddit.svg',
		name: 'Reddit',
		primaryColor: '#FF4500'
	},
	roblox: {
		iconUrl: '/assets/svg/roblox.svg',
		name: 'Roblox',
		primaryColor: '#FF4F00'
	},
	salesforce: {
		iconUrl: '/assets/svg/salesforce.svg',
		name: 'Salesforce',
		primaryColor: '#00A1E0'
	},
	shikimori: {
		iconUrl: '/assets/svg/shikimori.svg',
		name: 'Shikimori',
		primaryColor: '#FF4F00'
	},
	slack: {
		iconUrl: '/assets/svg/slack.svg',
		name: 'Slack',
		primaryColor: '#4A154B'
	},
	spotify: {
		iconUrl: '/assets/svg/spotify.svg',
		name: 'Spotify',
		primaryColor: '#1DB954'
	},
	startgg: {
		iconUrl: '/assets/svg/startgg.svg',
		name: 'Start.gg',
		primaryColor: '#FF4F00'
	},
	strava: {
		iconUrl: '/assets/svg/strava.svg',
		name: 'Strava',
		primaryColor: '#FF4F00'
	},
	synology: {
		iconUrl: '/assets/svg/synology.svg',
		name: 'Synology',
		primaryColor: '#FF4F00'
	},
	tiktok: {
		iconUrl: '/assets/svg/tiktok.svg',
		name: 'TikTok',
		primaryColor: '#000000'
	},
	tiltify: {
		iconUrl: '/assets/svg/tiltify.svg',
		name: 'Tiltify',
		primaryColor: '#FF4F00'
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
		name: 'Twitter',
		primaryColor: '#1DA1F2'
	},
	vk: {
		iconUrl: '/assets/svg/vk.svg',
		name: 'VK',
		primaryColor: '#4680C2'
	},
	workos: {
		iconUrl: '/assets/svg/workos.svg',
		name: 'WorkOS',
		primaryColor: '#FF4F00'
	},
	yahoo: {
		iconUrl: '/assets/svg/yahoo.svg',
		name: 'Yahoo',
		primaryColor: '#720E9E'
	},
	yandex: {
		iconUrl: '/assets/svg/yandex.svg',
		name: 'Yandex',
		primaryColor: '#FF4F00'
	},
	zoom: {
		iconUrl: '/assets/svg/zoom.svg',
		name: 'Zoom',
		primaryColor: '#2D8CFF'
	}
};
