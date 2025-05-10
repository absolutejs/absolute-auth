export type ProfileRequest = {
	endpoint: string;
	method?: 'GET' | 'POST';
	authIn: 'header' | 'query';
	tokenParam?: string;
	headers?: Record<string, string>;
	body?: any;
};

export async function fetchUserProfile(provider: string, accessToken: string) {
	const cfg: ProfileRequest | undefined = profileConfigs[provider];
	if (!cfg) {
		throw new Error(`Unknown provider: ${provider}`);
	}

	let url = cfg.endpoint;
	const method = cfg.method ?? 'GET';
	const headers: Record<string, string> = {};

	// Merge any static headers first
	if (cfg.headers) {
		Object.assign(headers, cfg.headers);
	}

	// Place token in header or query
	if (cfg.authIn === 'header') {
		headers['Authorization'] = `Bearer ${accessToken}`;
	} else {
		const tokenKey = cfg.tokenParam ?? 'access_token';
		const sep = url.includes('?') ? '&' : '?';
		url = `${url}${sep}${tokenKey}=${encodeURIComponent(accessToken)}`;
	}

	const init: RequestInit = { headers, method };

	if (method === 'POST' && cfg.body) {
		headers['Content-Type'] = 'application/json';
		init.body = JSON.stringify(cfg.body);
	}

	const res = await fetch(url, init);
	if (!res.ok) {
		const errText = await res.text();
		throw new Error(
			`Failed to fetch ${provider} profile: ${res.status} ${errText}`
		);
	}

	return res.json();
}

export const profileConfigs: Record<string, ProfileRequest> = {
	anilist: {
		authIn: 'header',
		body: {
			query: `query { Viewer { id name } }`
		},
		endpoint: 'https://graphql.anilist.co',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json'
		},
		method: 'POST'
	},
	atlassian: {
		authIn: 'header',
		endpoint: 'https://api.atlassian.com/me',
		method: 'GET'
	},
	battlenet: {
		authIn: 'header',
		endpoint: 'https://oauth.battle.net/userinfo',
		method: 'GET'
	},
	bitbucket: {
		authIn: 'header',
		endpoint: 'https://api.bitbucket.org/2.0/user',
		method: 'GET'
	},
	box: {
		authIn: 'header',
		endpoint: 'https://api.box.com/2.0/users/me',
		method: 'GET'
	},
	bungie: {
		authIn: 'header',
		endpoint:
			'https://www.bungie.net/Platform/User/GetCurrentBungieNetUser',
		headers: {
			'X-API-Key': '<YOUR_API_KEY>'
		},
		method: 'GET'
	},
	coinbase: {
		authIn: 'header',
		endpoint: 'https://api.coinbase.com/v2/user',
		method: 'GET'
	},
	discord: {
		authIn: 'header',
		endpoint: 'https://discord.com/api/users/@me',
		method: 'GET'
	},
	donationAlerts: {
		authIn: 'header',
		endpoint: 'https://www.donationalerts.com/api/v1/user',
		method: 'GET'
	},
	dribbble: {
		authIn: 'header',
		endpoint: 'https://api.dribbble.com/v2/user',
		method: 'GET'
	},
	dropbox: {
		authIn: 'header',
		endpoint: 'https://api.dropboxapi.com/2/users/get_current_account',
		method: 'GET'
	},
	epicGames: {
		authIn: 'header',
		endpoint: 'https://api.epicgames.dev/epic/oauth/v2/userInfo',
		method: 'GET'
	},
	etsy: {
		authIn: 'header',
		endpoint: 'https://openapi.etsy.com/v3/application/users/me',
		method: 'GET'
	},
	facebook: {
		authIn: 'query',
		endpoint: 'https://graph.facebook.com/me?fields=id,name,picture,email',
		method: 'GET',
		tokenParam: 'access_token'
	},
	figma: {
		authIn: 'header',
		endpoint: 'https://api.figma.com/v1/me',
		method: 'GET'
	},
	gitea: {
		authIn: 'header',
		endpoint: 'https://<YOUR_GITEA_DOMAIN>/api/v1/user',
		method: 'GET'
	},
	github: {
		authIn: 'header',
		endpoint: 'https://api.github.com/user',
		method: 'GET'
	},
	gitlab: {
		authIn: 'header',
		endpoint: 'https://gitlab.com/api/v4/user',
		method: 'GET'
	},
	intuit: {
		authIn: 'header',
		endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/userinfo',
		method: 'GET'
	},
	kakao: {
		authIn: 'header',
		endpoint: 'https://kapi.kakao.com/v2/user/me',
		method: 'GET'
	},
	kick: {
		authIn: 'header',
		endpoint: 'https://api.kick.com/v1/user',
		method: 'GET'
	},
	lichess: {
		authIn: 'header',
		endpoint: 'https://lichess.org/api/account',
		method: 'GET'
	},
	line: {
		authIn: 'header',
		endpoint: 'https://api.line.me/v2/profile',
		method: 'GET'
	},
	linear: {
		authIn: 'header',
		body: {
			query: `query { viewer { id name } }`
		},
		endpoint: 'https://api.linear.app/graphql',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json'
		},
		method: 'POST'
	},
	mastodon: {
		authIn: 'header',
		endpoint: 'https://<YOUR_INSTANCE>/api/v1/accounts/verify_credentials',
		method: 'GET'
	},
	mercadoLibre: {
		authIn: 'header',
		endpoint: 'https://api.mercadolibre.com/users/me',
		method: 'GET'
	},
	mercadoPago: {
		authIn: 'header',
		endpoint: 'https://api.mercadopago.com/v1/users/me',
		method: 'GET'
	},
	myAnimeList: {
		authIn: 'header',
		endpoint: 'https://api.myanimelist.net/v2/users/@me',
		method: 'GET'
	},
	naver: {
		authIn: 'header',
		endpoint: 'https://openapi.naver.com/v1/nid/me',
		method: 'GET'
	},
	notion: {
		authIn: 'header',
		endpoint: 'https://api.notion.com/v1/users/me',
		method: 'GET'
	},
	osu: {
		authIn: 'header',
		endpoint: 'https://osu.ppy.sh/api/v2/me',
		method: 'GET'
	},
	patreon: {
		authIn: 'header',
		endpoint: 'https://www.patreon.com/api/oauth2/v2/identity',
		method: 'GET'
	},
	polar: {
		authIn: 'header',
		endpoint: 'https://www.polaraccesslink.com/v3/users/<USER_ID>',
		method: 'GET'
	},
	reddit: {
		authIn: 'header',
		endpoint: 'https://oauth.reddit.com/api/v1/me',
		method: 'GET'
	},
	roblox: {
		authIn: 'header',
		endpoint: 'https://apis.roblox.com/oauth/v1/userinfo',
		method: 'GET'
	},
	shikimori: {
		authIn: 'header',
		endpoint: 'https://shikimori.one/api/users/whoami',
		method: 'GET'
	},
	slack: {
		authIn: 'query',
		endpoint: 'https://slack.com/api/users.identity',
		method: 'GET',
		tokenParam: 'token'
	},
	spotify: {
		authIn: 'header',
		endpoint: 'https://api.spotify.com/v1/me',
		method: 'GET'
	},
	startGg: {
		authIn: 'header',
		body: {
			query: `query { currentUser { id slug email player { gamerTag } } }`
		},
		endpoint: 'https://api.start.gg/gql/alpha',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json'
		},
		method: 'POST'
	},
	strava: {
		authIn: 'header',
		endpoint: 'https://www.strava.com/api/v3/athlete',
		method: 'GET'
	},
	synology: {
		authIn: 'header',
		endpoint: 'https://<YOUR_DOMAIN>/webman/sso/SSOUserInfo.cgi',
		method: 'GET'
	},
	tiktok: {
		authIn: 'query',
		endpoint: 'https://open.douyin.com/oauth/userinfo',
		method: 'GET',
		tokenParam: 'access_token'
	},
	tiltify: {
		authIn: 'header',
		endpoint: 'https://tiltify.com/api/v3/me',
		method: 'GET'
	},
	tumblr: {
		authIn: 'header',
		endpoint: 'https://api.tumblr.com/v2/user/info',
		method: 'GET'
	},
	twitch: {
		authIn: 'header',
		endpoint: 'https://api.twitch.tv/helix/users',
		method: 'GET'
	},
	twitter: {
		authIn: 'header',
		endpoint: 'https://api.twitter.com/2/users/me',
		method: 'GET'
	},
	vk: {
		authIn: 'query',
		endpoint: 'https://api.vk.com/method/users.get',
		method: 'GET',
		tokenParam: 'access_token'
	},
	zoom: {
		authIn: 'header',
		endpoint: 'https://api.zoom.us/v2/users/me',
		method: 'GET'
	}
};
