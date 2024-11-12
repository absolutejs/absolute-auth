import {
	AmazonCognito,
	AniList,
	Apple,
	Atlassian,
	Auth0,
	Authentik,
	Bitbucket,
	Box,
	Coinbase,
	Discord,
	Dribbble,
	Dropbox,
	Facebook,
	Figma,
	Intuit,
	GitHub,
	GitLab,
	Google,
	Kakao,
	KeyCloak,
	Lichess,
	Line,
	Linear,
	LinkedIn,
	MicrosoftEntraId,
	MyAnimeList,
	Notion,
	Okta,
	Osu,
	Patreon,
	Reddit,
	Roblox,
	Salesforce,
	Shikimori,
	Slack,
	Spotify,
	Strava,
	Tiltify,
	Tumblr,
	Twitch,
	Twitter,
	VK,
	WorkOS,
	Yahoo,
	Yandex,
	Zoom,
	FortyTwo
} from 'arctic';

export type ProvidersMap = {
	AmazonCognito: typeof AmazonCognito;
	AniList: typeof AniList;
	Apple: typeof Apple;
	Atlassian: typeof Atlassian;
	Auth0: typeof Auth0;
	Authentik: typeof Authentik;
	Bitbucket: typeof Bitbucket;
	Box: typeof Box;
	Coinbase: typeof Coinbase;
	Discord: typeof Discord;
	Dribbble: typeof Dribbble;
	Dropbox: typeof Dropbox;
	Facebook: typeof Facebook;
	Figma: typeof Figma;
	FortyTwo: typeof FortyTwo;
	GitHub: typeof GitHub;
	GitLab: typeof GitLab;
	Google: typeof Google;
	Intuit: typeof Intuit;
	Kakao: typeof Kakao;
	KeyCloak: typeof KeyCloak;
	Lichess: typeof Lichess;
	Line: typeof Line;
	Linear: typeof Linear;
	LinkedIn: typeof LinkedIn;
	MicrosoftEntraId: typeof MicrosoftEntraId;
	MyAnimeList: typeof MyAnimeList;
	Notion: typeof Notion;
	Okta: typeof Okta;
	Osu: typeof Osu;
	Patreon: typeof Patreon;
	Reddit: typeof Reddit;
	Roblox: typeof Roblox;
	Salesforce: typeof Salesforce;
	Shikimori: typeof Shikimori;
	Slack: typeof Slack;
	Spotify: typeof Spotify;
	Strava: typeof Strava;
	Tiltify: typeof Tiltify;
	Tumblr: typeof Tumblr;
	Twitch: typeof Twitch;
	Twitter: typeof Twitter;
	VK: typeof VK;
	WorkOS: typeof WorkOS;
	Yahoo: typeof Yahoo;
	Yandex: typeof Yandex;
	Zoom: typeof Zoom;
};

export const providers: ProvidersMap = {
	AmazonCognito,
	AniList,
	Apple,
	Atlassian,
	Auth0,
	Authentik,
	Bitbucket,
	Box,
	Coinbase,
	Discord,
	Dribbble,
	Dropbox,
	Facebook,
	Figma,
	Intuit,
	GitHub,
	GitLab,
	Google,
	Kakao,
	KeyCloak,
	Lichess,
	Line,
	Linear,
	LinkedIn,
	MicrosoftEntraId,
	MyAnimeList,
	Notion,
	Okta,
	Osu,
	Patreon,
	Reddit,
	Roblox,
	Salesforce,
	Shikimori,
	Slack,
	Spotify,
	Strava,
	Tiltify,
	Tumblr,
	Twitch,
	Twitter,
	VK,
	WorkOS,
	Yahoo,
	Yandex,
	Zoom,
	FortyTwo
};

export const normalizedProviderKeys = Object.keys(providers).reduce(
	(map, key) => {
		map[key.toLowerCase()] = key;
		return map;
	},
	{} as Record<string, string>
);

export const userInfoURLs: Record<string, string> = {
	AmazonCognito: 
		'https://{region}.amazonaws.com/{userPoolId}/.well-known/openid-configuration'
	, // Replace {region} and {userPoolId}
	AniList: 'https://graphql.anilist.co', // User info available via GraphQL
	Apple: 'https://appleid.apple.com/auth/token', // Apple doesn't provide a dedicated userinfo endpoint, but tokens can be used to get data
	Atlassian: 'https://api.atlassian.com/me',
	Auth0: 'https://{your_domain}/userinfo', // Replace {your_domain}
	Authentik: 'https://{your_domain}/api/v1/user/me', // Replace with your domain
	Bitbucket: 'https://api.bitbucket.org/2.0/user',
	Box: 'https://api.box.com/2.0/users/me',
	Coinbase: 'https://api.coinbase.com/v2/user',
	Discord: 'https://discord.com/api/users/@me',
	Dribbble: 'https://api.dribbble.com/v2/user',
	Dropbox: 'https://api.dropboxapi.com/2/users/get_current_account',
	Facebook: 'https://graph.facebook.com/me',
	Figma: 'https://api.figma.com/v1/me',
	Intuit: 
		'https://accounts.platform.intuit.com/v1/openid_connect/userinfo'
	,
	GitHub: 'https://api.github.com/user',
	GitLab: 'https://gitlab.com/api/v4/user',
	Google: 'https://www.googleapis.com/userinfo/v2/me',
	Kakao: 'https://kapi.kakao.com/v2/user/me',
	KeyCloak: 
		'https://{your_domain}/auth/realms/{realm}/protocol/openid-connect/userinfo'
	, // Replace {your_domain} and {realm}
	Lichess: 'https://lichess.org/api/account',
	Line: 'https://api.line.me/v2/profile',
	Linear: 'https://api.linear.app/v1/me',
	LinkedIn: 'https://api.linkedin.com/v2/me',
	MicrosoftEntraId: 'https://graph.microsoft.com/v1.0/me',
	MyAnimeList: 'https://myanimelist.net/v1/users/@me',
	Notion: 'https://api.notion.com/v1/users/me',
	Okta: 'https://{yourOktaDomain}/oauth2/v1/userinfo', // Replace {yourOktaDomain}
	Osu: 'https://osu.ppy.sh/api/v2/me',
	Patreon: 'https://www.patreon.com/api/oauth2/v2/identity',
	Reddit: 'https://oauth.reddit.com/api/v1/me',
	Roblox: 'https://apis.roblox.com/users/v1/users/me',
	Salesforce: 
		'https://login.salesforce.com/services/oauth2/userinfo'
	,
	Shikimori: 'https://shikimori.one/api/users/whoami',
	Slack: 'https://slack.com/api/users.identity',
	Spotify: 'https://api.spotify.com/v1/me',
	Strava: 'https://www.strava.com/api/v3/athlete',
	Tiltify: 'https://tiltify.com/api/v3/user',
	Tumblr: 'https://api.tumblr.com/v2/user/info',
	Twitch: 'https://api.twitch.tv/helix/users',
	Twitter: 'https://api.twitter.com/2/users/me',
	VK: 'https://api.vk.com/method/users.get',
	WorkOS: 'https://api.workos.com/sso/profile',
	Yahoo: 'https://api.login.yahoo.com/openid/v1/userinfo',
	Yandex: 'https://login.yandex.ru/info',
	Zoom: 'https://api.zoom.us/v2/users/me',
	FortyTwo: 'https://api.intra.42.fr/v2/me'
};

export const issuerURLs: Record<string, string> = {
	AmazonCognito: 
		'https://cognito-idp.{region}.amazonaws.com/{userPoolId}'
	, // {region} and {userPoolId} need to be replaced
	AniList: 'https://anilist.co/api/v2/oauth/authorize',
	Apple: 'https://appleid.apple.com',
	Atlassian: 'https://auth.atlassian.com',
	Auth0: 'https://{your_domain}.auth0.com', // Replace {your_domain}
	Authentik: 'https://{your_domain}', // Replace with your domain
	Bitbucket: 'https://bitbucket.org/site/oauth2/authorize',
	Box: 'https://account.box.com/api/oauth2/authorize',
	Coinbase: 'https://www.coinbase.com/oauth/authorize',
	Discord: 'https://discord.com/api/oauth2/authorize',
	Dribbble: 'https://dribbble.com/oauth/authorize',
	Dropbox: 'https://www.dropbox.com/oauth2/authorize',
	Facebook: 'https://www.facebook.com/v12.0/dialog/oauth',
	Figma: 'https://www.figma.com/oauth',
	Intuit: 'https://appcenter.intuit.com/connect/oauth2',
	GitHub: 'https://github.com/login/oauth/authorize',
	GitLab: 'https://gitlab.com/oauth/authorize',
	Google: 'https://accounts.google.com',
	Kakao: 'https://kauth.kakao.com/oauth/authorize',
	KeyCloak: 'https://{your_domain}/auth', // Replace {your_domain}
	Lichess: 'https://lichess.org/oauth/authorize',
	Line: 'https://access.line.me/oauth2/v2.1/authorize',
	Linear: 'https://linear.app/oauth/authorize',
	LinkedIn: 'https://www.linkedin.com/oauth/v2/authorization',
	MicrosoftEntraId: 
		'https://login.microsoftonline.com/{tenant}/v2.0'
	, // Replace {tenant} if needed
	MyAnimeList: 'https://myanimelist.net/v1/oauth2/authorize',
	Notion: 'https://api.notion.com/v1/oauth/authorize',
	Okta: 'https://{yourOktaDomain}/oauth2/default/v1/authorize', // Replace {yourOktaDomain}
	Osu: 'https://osu.ppy.sh/oauth/authorize',
	Patreon: 'https://www.patreon.com/oauth2/authorize',
	Reddit: 'https://www.reddit.com/api/v1/authorize',
	Roblox: 'https://apis.roblox.com/oauth/v1/authorize',
	Salesforce: 
		'https://login.salesforce.com/services/oauth2/authorize'
	,
	Shikimori: 'https://shikimori.one/oauth/authorize',
	Slack: 'https://slack.com/oauth/v2/authorize',
	Spotify: 'https://accounts.spotify.com/authorize',
	Strava: 'https://www.strava.com/oauth/authorize',
	Tiltify: 'https://tiltify.com/oauth/authorize',
	Tumblr: 'https://www.tumblr.com/oauth/authorize',
	Twitch: 'https://id.twitch.tv/oauth2/authorize',
	Twitter: 'https://api.twitter.com/oauth/authorize',
	VK: 'https://oauth.vk.com/authorize',
	WorkOS: 'https://api.workos.com/sso/authorize',
	Yahoo: 'https://api.login.yahoo.com/oauth2/request_auth',
	Yandex: 'https://oauth.yandex.com/authorize',
	Zoom: 'https://zoom.us/oauth/authorize',
	FortyTwo: 'https://api.intra.42.fr/oauth/authorize'
};

export const normalizedUserInfoURLKeys = Object.keys(userInfoURLs).reduce(
	(map, key) => {
		map[key.toLowerCase()] = key;
		return map;
	},
	{} as Record<string, string>
);

export const normalizedIssuerURLKeys = Object.keys(issuerURLs).reduce(
	(map, key) => {
		map[key.toLowerCase()] = key;
		return map;
	},
	{} as Record<string, string>
);
