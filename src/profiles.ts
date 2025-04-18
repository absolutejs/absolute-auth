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

	const init: RequestInit = { method, headers };

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
	facebook: {
		endpoint: 'https://graph.facebook.com/me?fields=id,name,picture,email',
		method: 'GET',
		authIn: 'query',
		tokenParam: 'access_token'
	},
	anilist: {
		endpoint: 'https://graphql.anilist.co',
		method: 'POST',
		authIn: 'header',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: {
			query: `query { Viewer { id name } }`
		}
	},
	atlassian: {
		endpoint: 'https://api.atlassian.com/me',
		method: 'GET',
		authIn: 'header'
	},
	battlenet: {
		endpoint: 'https://oauth.battle.net/userinfo',
		method: 'GET',
		authIn: 'header'
	},
	bitbucket: {
		endpoint: 'https://api.bitbucket.org/2.0/user',
		method: 'GET',
		authIn: 'header'
	},
	box: {
		endpoint: 'https://api.box.com/2.0/users/me',
		method: 'GET',
		authIn: 'header'
	},
	bungie: {
		endpoint:
			'https://www.bungie.net/Platform/User/GetCurrentBungieNetUser',
		method: 'GET',
		authIn: 'header',
		headers: {
			'X-API-Key': '<YOUR_API_KEY>'
		}
	},
	coinbase: {
		endpoint: 'https://api.coinbase.com/v2/user',
		method: 'GET',
		authIn: 'header'
	},
	discord: {
		endpoint: 'https://discord.com/api/users/@me',
		method: 'GET',
		authIn: 'header'
	},
	donationAlerts: {
		endpoint: 'https://www.donationalerts.com/api/v1/user',
		method: 'GET',
		authIn: 'header'
	},
	dribbble: {
		endpoint: 'https://api.dribbble.com/v2/user',
		method: 'GET',
		authIn: 'header'
	},
	dropbox: {
		endpoint: 'https://api.dropboxapi.com/2/users/get_current_account',
		method: 'GET',
		authIn: 'header'
	},
	epicGames: {
		endpoint: 'https://api.epicgames.dev/epic/oauth/v2/userInfo',
		method: 'GET',
		authIn: 'header'
	},
	etsy: {
		endpoint: 'https://openapi.etsy.com/v3/application/users/me',
		method: 'GET',
		authIn: 'header'
	},
	figma: {
		endpoint: 'https://api.figma.com/v1/me',
		method: 'GET',
		authIn: 'header'
	},
	gitea: {
		endpoint: 'https://<YOUR_GITEA_DOMAIN>/api/v1/user',
		method: 'GET',
		authIn: 'header'
	},
	github: {
		endpoint: 'https://api.github.com/user',
		method: 'GET',
		authIn: 'header'
	},
	gitlab: {
		endpoint: 'https://gitlab.com/api/v4/user',
		method: 'GET',
		authIn: 'header'
	},
	intuit: {
		endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/userinfo',
		method: 'GET',
		authIn: 'header'
	},
	kakao: {
		endpoint: 'https://kapi.kakao.com/v2/user/me',
		method: 'GET',
		authIn: 'header'
	},
	kick: {
		endpoint: 'https://api.kick.com/v1/user',
		method: 'GET',
		authIn: 'header'
	},
	lichess: {
		endpoint: 'https://lichess.org/api/account',
		method: 'GET',
		authIn: 'header'
	},
	line: {
		endpoint: 'https://api.line.me/v2/profile',
		method: 'GET',
		authIn: 'header'
	},
	linear: {
		endpoint: 'https://api.linear.app/graphql',
		method: 'POST',
		authIn: 'header',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: {
			query: `query { viewer { id name } }`
		}
	},
	mastodon: {
		endpoint: 'https://<YOUR_INSTANCE>/api/v1/accounts/verify_credentials',
		method: 'GET',
		authIn: 'header'
	},
	mercadoLibre: {
		endpoint: 'https://api.mercadolibre.com/users/me',
		method: 'GET',
		authIn: 'header'
	},
	mercadoPago: {
		endpoint: 'https://api.mercadopago.com/v1/users/me',
		method: 'GET',
		authIn: 'header'
	},
	myAnimeList: {
		endpoint: 'https://api.myanimelist.net/v2/users/@me',
		method: 'GET',
		authIn: 'header'
	},
	naver: {
		endpoint: 'https://openapi.naver.com/v1/nid/me',
		method: 'GET',
		authIn: 'header'
	},
	notion: {
		endpoint: 'https://api.notion.com/v1/users/me',
		method: 'GET',
		authIn: 'header'
	},
	osu: {
		endpoint: 'https://osu.ppy.sh/api/v2/me',
		method: 'GET',
		authIn: 'header'
	},
	patreon: {
		endpoint: 'https://www.patreon.com/api/oauth2/v2/identity',
		method: 'GET',
		authIn: 'header'
	},
	polar: {
		endpoint: 'https://www.polaraccesslink.com/v3/users/<USER_ID>',
		method: 'GET',
		authIn: 'header'
	},
	reddit: {
		endpoint: 'https://oauth.reddit.com/api/v1/me',
		method: 'GET',
		authIn: 'header'
	},
	roblox: {
		endpoint: 'https://apis.roblox.com/oauth/v1/userinfo',
		method: 'GET',
		authIn: 'header'
	},
	shikimori: {
		endpoint: 'https://shikimori.one/api/users/whoami',
		method: 'GET',
		authIn: 'header'
	},
	slack: {
		endpoint: 'https://slack.com/api/users.identity',
		method: 'GET',
		authIn: 'query',
		tokenParam: 'token'
	},
	spotify: {
		endpoint: 'https://api.spotify.com/v1/me',
		method: 'GET',
		authIn: 'header'
	},
	startGg: {
		endpoint: 'https://api.start.gg/gql/alpha',
		method: 'POST',
		authIn: 'header',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: {
			query: `query { currentUser { id slug email player { gamerTag } } }`
		}
	},
	strava: {
		endpoint: 'https://www.strava.com/api/v3/athlete',
		method: 'GET',
		authIn: 'header'
	},
	synology: {
		endpoint: 'https://<YOUR_DOMAIN>/webman/sso/SSOUserInfo.cgi',
		method: 'GET',
		authIn: 'header'
	},
	tiktok: {
		endpoint: 'https://open.douyin.com/oauth/userinfo',
		method: 'GET',
		authIn: 'query',
		tokenParam: 'access_token'
	},
	tiltify: {
		endpoint: 'https://tiltify.com/api/v3/me',
		method: 'GET',
		authIn: 'header'
	},
	tumblr: {
		endpoint: 'https://api.tumblr.com/v2/user/info',
		method: 'GET',
		authIn: 'header'
	},
	twitch: {
		endpoint: 'https://api.twitch.tv/helix/users',
		method: 'GET',
		authIn: 'header'
	},
	twitter: {
		endpoint: 'https://api.twitter.com/2/users/me',
		method: 'GET',
		authIn: 'header'
	},
	vk: {
		endpoint: 'https://api.vk.com/method/users.get',
		method: 'GET',
		authIn: 'query',
		tokenParam: 'access_token'
	},
	zoom: {
		endpoint: 'https://api.zoom.us/v2/users/me',
		method: 'GET',
		authIn: 'header'
	}
};
