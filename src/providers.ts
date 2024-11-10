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

export const providers = {
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

export const userInfoURLs = {
	AmazonCognito: new URL(
		'https://{region}.amazonaws.com/{userPoolId}/.well-known/openid-configuration'
	), // Replace {region} and {userPoolId}
	AniList: new URL('https://graphql.anilist.co'), // User info available via GraphQL
	Apple: new URL('https://appleid.apple.com/auth/token'), // Apple doesn't provide a dedicated userinfo endpoint, but tokens can be used to get data
	Atlassian: new URL('https://api.atlassian.com/me'),
	Auth0: new URL('https://{your_domain}/userinfo'), // Replace {your_domain}
	Authentik: new URL('https://{your_domain}/api/v1/user/me'), // Replace with your domain
	Bitbucket: new URL('https://api.bitbucket.org/2.0/user'),
	Box: new URL('https://api.box.com/2.0/users/me'),
	Coinbase: new URL('https://api.coinbase.com/v2/user'),
	Discord: new URL('https://discord.com/api/users/@me'),
	Dribbble: new URL('https://api.dribbble.com/v2/user'),
	Dropbox: new URL('https://api.dropboxapi.com/2/users/get_current_account'),
	Facebook: new URL('https://graph.facebook.com/me'),
	Figma: new URL('https://api.figma.com/v1/me'),
	Intuit: new URL(
		'https://accounts.platform.intuit.com/v1/openid_connect/userinfo'
	),
	GitHub: new URL('https://api.github.com/user'),
	GitLab: new URL('https://gitlab.com/api/v4/user'),
	Google: new URL('https://www.googleapis.com/userinfo/v2/me'),
	Kakao: new URL('https://kapi.kakao.com/v2/user/me'),
	KeyCloak: new URL(
		'https://{your_domain}/auth/realms/{realm}/protocol/openid-connect/userinfo'
	), // Replace {your_domain} and {realm}
	Lichess: new URL('https://lichess.org/api/account'),
	Line: new URL('https://api.line.me/v2/profile'),
	Linear: new URL('https://api.linear.app/v1/me'),
	LinkedIn: new URL('https://api.linkedin.com/v2/me'),
	MicrosoftEntraId: new URL('https://graph.microsoft.com/v1.0/me'),
	MyAnimeList: new URL('https://myanimelist.net/v1/users/@me'),
	Notion: new URL('https://api.notion.com/v1/users/me'),
	Okta: new URL('https://{yourOktaDomain}/oauth2/v1/userinfo'), // Replace {yourOktaDomain}
	Osu: new URL('https://osu.ppy.sh/api/v2/me'),
	Patreon: new URL('https://www.patreon.com/api/oauth2/v2/identity'),
	Reddit: new URL('https://oauth.reddit.com/api/v1/me'),
	Roblox: new URL('https://apis.roblox.com/users/v1/users/me'),
	Salesforce: new URL(
		'https://login.salesforce.com/services/oauth2/userinfo'
	),
	Shikimori: new URL('https://shikimori.one/api/users/whoami'),
	Slack: new URL('https://slack.com/api/users.identity'),
	Spotify: new URL('https://api.spotify.com/v1/me'),
	Strava: new URL('https://www.strava.com/api/v3/athlete'),
	Tiltify: new URL('https://tiltify.com/api/v3/user'),
	Tumblr: new URL('https://api.tumblr.com/v2/user/info'),
	Twitch: new URL('https://api.twitch.tv/helix/users'),
	Twitter: new URL('https://api.twitter.com/2/users/me'),
	VK: new URL('https://api.vk.com/method/users.get'),
	WorkOS: new URL('https://api.workos.com/sso/profile'),
	Yahoo: new URL('https://api.login.yahoo.com/openid/v1/userinfo'),
	Yandex: new URL('https://login.yandex.ru/info'),
	Zoom: new URL('https://api.zoom.us/v2/users/me'),
	FortyTwo: new URL('https://api.intra.42.fr/v2/me')
};

export const issuerURLs = {
	AmazonCognito: new URL(
		'https://cognito-idp.{region}.amazonaws.com/{userPoolId}'
	), // {region} and {userPoolId} need to be replaced
	AniList: new URL('https://anilist.co/api/v2/oauth/authorize'),
	Apple: new URL('https://appleid.apple.com'),
	Atlassian: new URL('https://auth.atlassian.com'),
	Auth0: new URL('https://{your_domain}.auth0.com'), // Replace {your_domain}
	Authentik: new URL('https://{your_domain}'), // Replace with your domain
	Bitbucket: new URL('https://bitbucket.org/site/oauth2/authorize'),
	Box: new URL('https://account.box.com/api/oauth2/authorize'),
	Coinbase: new URL('https://www.coinbase.com/oauth/authorize'),
	Discord: new URL('https://discord.com/api/oauth2/authorize'),
	Dribbble: new URL('https://dribbble.com/oauth/authorize'),
	Dropbox: new URL('https://www.dropbox.com/oauth2/authorize'),
	Facebook: new URL('https://www.facebook.com/v12.0/dialog/oauth'),
	Figma: new URL('https://www.figma.com/oauth'),
	Intuit: new URL('https://appcenter.intuit.com/connect/oauth2'),
	GitHub: new URL('https://github.com/login/oauth/authorize'),
	GitLab: new URL('https://gitlab.com/oauth/authorize'),
	Google: new URL('https://accounts.google.com'),
	Kakao: new URL('https://kauth.kakao.com/oauth/authorize'),
	KeyCloak: new URL('https://{your_domain}/auth'), // Replace {your_domain}
	Lichess: new URL('https://lichess.org/oauth/authorize'),
	Line: new URL('https://access.line.me/oauth2/v2.1/authorize'),
	Linear: new URL('https://linear.app/oauth/authorize'),
	LinkedIn: new URL('https://www.linkedin.com/oauth/v2/authorization'),
	MicrosoftEntraId: new URL(
		'https://login.microsoftonline.com/{tenant}/v2.0'
	), // Replace {tenant} if needed
	MyAnimeList: new URL('https://myanimelist.net/v1/oauth2/authorize'),
	Notion: new URL('https://api.notion.com/v1/oauth/authorize'),
	Okta: new URL('https://{yourOktaDomain}/oauth2/default/v1/authorize'), // Replace {yourOktaDomain}
	Osu: new URL('https://osu.ppy.sh/oauth/authorize'),
	Patreon: new URL('https://www.patreon.com/oauth2/authorize'),
	Reddit: new URL('https://www.reddit.com/api/v1/authorize'),
	Roblox: new URL('https://apis.roblox.com/oauth/v1/authorize'),
	Salesforce: new URL(
		'https://login.salesforce.com/services/oauth2/authorize'
	),
	Shikimori: new URL('https://shikimori.one/oauth/authorize'),
	Slack: new URL('https://slack.com/oauth/v2/authorize'),
	Spotify: new URL('https://accounts.spotify.com/authorize'),
	Strava: new URL('https://www.strava.com/oauth/authorize'),
	Tiltify: new URL('https://tiltify.com/oauth/authorize'),
	Tumblr: new URL('https://www.tumblr.com/oauth/authorize'),
	Twitch: new URL('https://id.twitch.tv/oauth2/authorize'),
	Twitter: new URL('https://api.twitter.com/oauth/authorize'),
	VK: new URL('https://oauth.vk.com/authorize'),
	WorkOS: new URL('https://api.workos.com/sso/authorize'),
	Yahoo: new URL('https://api.login.yahoo.com/oauth2/request_auth'),
	Yandex: new URL('https://oauth.yandex.com/authorize'),
	Zoom: new URL('https://zoom.us/oauth/authorize'),
	FortyTwo: new URL('https://api.intra.42.fr/oauth/authorize')
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
