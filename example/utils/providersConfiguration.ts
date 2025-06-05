import { Buffer } from 'buffer';
import { env } from 'process';
import { createProvidersConfiguration } from '../../src/utils';

const getEnvVar = (key: string) => {
	const environmentVariable = env[key];
	if (
		typeof environmentVariable !== 'string' ||
		environmentVariable.length === 0
	) {
		throw new Error(`Missing environment variable ${key}`);
	}

	return environmentVariable;
};

export const providersConfiguration = createProvidersConfiguration({
	'42': {
		credentials: {
			clientId: getEnvVar('FORTY_TWO_CLIENT_ID'),
			clientSecret: getEnvVar('FORTY_TWO_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	amazoncognito: {
		credentials: {
			clientId: getEnvVar('AMAZON_COGNITO_CLIENT_ID'),
			clientSecret: getEnvVar('AMAZON_COGNITO_CLIENT_SECRET'),
			domain: getEnvVar('AMAZON_COGNITO_DOMAIN'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	anilist: {
		credentials: {
			clientId: getEnvVar('ANILIST_CLIENT_ID'),
			clientSecret: getEnvVar('ANILIST_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	apple: {
		credentials: {
			clientId: getEnvVar('APPLE_CLIENT_ID'),
			keyId: getEnvVar('APPLE_KEY_ID'),
			pkcs8PrivateKey: Buffer.from(getEnvVar('APPLE_PKCS8_PRIVATE_KEY')),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI'),
			teamId: getEnvVar('APPLE_TEAM_ID')
		}
	},
	atlassian: {
		credentials: {
			clientId: getEnvVar('ATLASSIAN_CLIENT_ID'),
			clientSecret: getEnvVar('ATLASSIAN_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['read:me', 'offline_access']
	},
	auth0: {
		credentials: {
			clientId: getEnvVar('AUTH0_CLIENT_ID'),
			clientSecret: getEnvVar('AUTH0_CLIENT_SECRET'),
			domain: getEnvVar('AUTH0_DOMAIN'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		searchParams: [['prompt', 'login']],
		scope: ['offline_access', 'openid']
	},
	authentik: {
		credentials: {
			baseURL: getEnvVar('AUTHENTIK_BASE_URL'),
			clientId: getEnvVar('AUTHENTIK_CLIENT_ID'),
			clientSecret: getEnvVar('AUTHENTIK_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	autodesk: {
		credentials: {
			clientId: getEnvVar('AUTODESK_CLIENT_ID'),
			clientSecret: getEnvVar('AUTODESK_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	battlenet: {
		credentials: {
			clientId: getEnvVar('BATTLENET_CLIENT_ID'),
			clientSecret: getEnvVar('BATTLENET_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	bitbucket: {
		credentials: {
			clientId: getEnvVar('BITBUCKET_CLIENT_ID'),
			clientSecret: getEnvVar('BITBUCKET_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	box: {
		credentials: {
			clientId: getEnvVar('BOX_CLIENT_ID'),
			clientSecret: getEnvVar('BOX_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	bungie: {
		credentials: {
			clientId: getEnvVar('BUNGIE_CLIENT_ID'),
			clientSecret: getEnvVar('BUNGIE_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	coinbase: {
		credentials: {
			clientId: getEnvVar('COINBASE_CLIENT_ID'),
			clientSecret: getEnvVar('COINBASE_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	discord: {
		credentials: {
			clientId: getEnvVar('DISCORD_CLIENT_ID'),
			clientSecret: getEnvVar('DISCORD_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['openid']
	},
	donationalerts: {
		credentials: {
			clientId: getEnvVar('DONATION_ALERTS_CLIENT_ID'),
			clientSecret: getEnvVar('DONATION_ALERTS_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	dribbble: {
		credentials: {
			clientId: getEnvVar('DRIBBBLE_CLIENT_ID'),
			clientSecret: getEnvVar('DRIBBBLE_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	dropbox: {
		credentials: {
			clientId: getEnvVar('DROPBOX_APP_KEY'),
			clientSecret: getEnvVar('DROPBOX_APP_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	epicgames: {
		credentials: {
			clientId: getEnvVar('EPIC_GAMES_CLIENT_ID'),
			clientSecret: getEnvVar('EPIC_GAMES_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	etsy: {
		credentials: {
			clientId: getEnvVar('ETSY_KEYSTRING'),
			clientSecret: getEnvVar('ETSY_SHARED_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	facebook: {
		credentials: {
			clientId: getEnvVar('FACEBOOK_CLIENT_ID'),
			clientSecret: getEnvVar('FACEBOOK_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	figma: {
		credentials: {
			clientId: getEnvVar('FIGMA_CLIENT_ID'),
			clientSecret: getEnvVar('FIGMA_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['file_read']
	},
	gitea: {
		credentials: {
			baseURL: getEnvVar('GITEA_BASE_URL'),
			clientId: getEnvVar('GITEA_CLIENT_ID'),
			clientSecret: getEnvVar('GITEA_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	github: {
		credentials: {
			clientId: getEnvVar('GITHUB_CLIENT_ID'),
			clientSecret: getEnvVar('GITHUB_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	gitlab: {
		credentials: {
			baseURL: getEnvVar('GITLAB_BASE_URL'),
			clientId: getEnvVar('GITLAB_CLIENT_ID'),
			clientSecret: getEnvVar('GITLAB_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	google: {
		credentials: {
			clientId: getEnvVar('GOOGLE_CLIENT_ID'),
			clientSecret: getEnvVar('GOOGLE_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['profile', 'openid'],
		searchParams: [
			['access_type', 'offline'],
			['prompt', 'consent']
		]
	},
	intuit: {
		credentials: {
			clientId: getEnvVar('INTUIT_CLIENT_ID'),
			clientSecret: getEnvVar('INTUIT_CLIENT_SECRET'),
			environment:
				env.NODE_ENV === 'production' ? 'production' : 'sandbox',
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['openid']
	},
	kakao: {
		credentials: {
			clientId: getEnvVar('KAKAO_CLIENT_ID'),
			clientSecret: getEnvVar('KAKAO_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	keycloak: {
		credentials: {
			clientId: getEnvVar('KEYCLOAK_CLIENT_ID'),
			clientSecret: getEnvVar('KEYCLOAK_CLIENT_SECRET'),
			realmURL: getEnvVar('KEYCLOAK_REALM_URL'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	kick: {
		credentials: {
			clientId: getEnvVar('KICK_CLIENT_ID'),
			clientSecret: getEnvVar('KICK_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['user:read']
	},
	lichess: {
		credentials: {
			clientId: getEnvVar('LICHESS_CLIENT_ID'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	line: {
		credentials: {
			clientId: getEnvVar('LINE_CHANNEL_ID'),
			clientSecret: getEnvVar('LINE_CHANNEL_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['openid', 'profile']
	},
	linear: {
		credentials: {
			clientId: getEnvVar('LINEAR_CLIENT_ID'),
			clientSecret: getEnvVar('LINEAR_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	linkedin: {
		credentials: {
			clientId: getEnvVar('LINKEDIN_CLIENT_ID'),
			clientSecret: getEnvVar('LINKEDIN_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['openid', 'profile', 'email']
	},
	mastodon: {
		credentials: {
			baseURL: getEnvVar('MASTODON_BASE_URL'),
			clientId: getEnvVar('MASTODON_CLIENT_ID'),
			clientSecret: getEnvVar('MASTODON_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	mercadolibre: {
		credentials: {
			clientId: getEnvVar('MERCADO_LIBRE_CLIENT_ID'),
			clientSecret: getEnvVar('MERCADO_LIBRE_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	mercadopago: {
		credentials: {
			clientId: getEnvVar('MERCADO_PAGO_CLIENT_ID'),
			clientSecret: getEnvVar('MERCADO_PAGO_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	microsoftentraid: {
		credentials: {
			clientId: getEnvVar('MICROSOFT_ENTRA_ID_CLIENT_ID'),
			clientSecret: getEnvVar('MICROSOFT_ENTRA_ID_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI'),
			tenantId: getEnvVar('MICROSOFT_ENTRA_ID_TENANT_ID')
		}
	},
	myanimelist: {
		credentials: {
			clientId: getEnvVar('MY_ANIME_LIST_CLIENT_ID'),
			clientSecret: getEnvVar('MY_ANIME_LIST_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	naver: {
		credentials: {
			clientId: getEnvVar('NAVER_CLIENT_ID'),
			clientSecret: getEnvVar('NAVER_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	notion: {
		credentials: {
			clientId: getEnvVar('NOTION_CLIENT_ID'),
			clientSecret: getEnvVar('NOTION_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	okta: {
		credentials: {
			clientId: getEnvVar('OKTA_CLIENT_ID'),
			clientSecret: getEnvVar('OKTA_CLIENT_SECRET'),
			domain: getEnvVar('OKTA_DOMAIN'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['openid', 'offline_access']
	},
	osu: {
		credentials: {
			clientId: getEnvVar('OSU_CLIENT_ID'),
			clientSecret: getEnvVar('OSU_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	patreon: {
		credentials: {
			clientId: getEnvVar('PATREON_CLIENT_ID'),
			clientSecret: getEnvVar('PATREON_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	polar: {
		credentials: {
			clientId: getEnvVar('POLAR_CLIENT_ID'),
			clientSecret: getEnvVar('POLAR_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['openid']
	},
	polaraccesslink: {
		credentials: {
			clientId: getEnvVar('POLAR_ACCESSLINK_CLIENT_ID'),
			clientSecret: getEnvVar('POLAR_ACCESSLINK_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	polarteampro: {
		credentials: {
			clientId: getEnvVar('POLAR_TEAM_PRO_CLIENT_ID'),
			clientSecret: getEnvVar('POLAR_TEAM_PRO_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	reddit: {
		credentials: {
			clientId: getEnvVar('REDDIT_CLIENT_ID'),
			clientSecret: getEnvVar('REDDIT_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['identity'],
		searchParams: [['duration', 'permanent']]
	},
	roblox: {
		credentials: {
			clientId: getEnvVar('ROBLOX_CLIENT_ID'),
			clientSecret: getEnvVar('ROBLOX_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['openid', 'profile']
	},
	salesforce: {
		credentials: {
			clientId: getEnvVar('SALESFORCE_CONSUMER_KEY'),
			clientSecret: getEnvVar('SALESFORCE_CONSUMER_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	shikimori: {
		credentials: {
			clientId: getEnvVar('SHIKIMORI_CLIENT_ID'),
			clientSecret: getEnvVar('SHIKIMORI_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	slack: {
		credentials: {
			clientId: getEnvVar('SLACK_CLIENT_ID'),
			clientSecret: getEnvVar('SLACK_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['openid']
	},
	spotify: {
		credentials: {
			clientId: getEnvVar('SPOTIFY_CLIENT_ID'),
			clientSecret: getEnvVar('SPOTIFY_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	startgg: {
		credentials: {
			clientId: getEnvVar('STARTGG_CLIENT_ID'),
			clientSecret: getEnvVar('STARTGG_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	strava: {
		credentials: {
			clientId: getEnvVar('STRAVA_CLIENT_ID'),
			clientSecret: getEnvVar('STRAVA_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	synology: {
		credentials: {
			clientId: getEnvVar('SYNOLOGY_CLIENT_ID'),
			clientSecret: getEnvVar('SYNOLOGY_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	tiktok: {
		credentials: {
			clientId: getEnvVar('TIK_TOK_CLIENT_KEY'),
			clientSecret: getEnvVar('TIK_TOK_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	tiltify: {
		credentials: {
			clientId: getEnvVar('TILTIFY_CLIENT_ID'),
			clientSecret: getEnvVar('TILTIFY_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	tumblr: {
		credentials: {
			clientId: getEnvVar('TUMBLR_CONSUMER_KEY'),
			clientSecret: getEnvVar('TUMBLR_CONSUMER_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	twitch: {
		credentials: {
			clientId: getEnvVar('TWITCH_CLIENT_ID'),
			clientSecret: getEnvVar('TWITCH_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	twitter: {
		credentials: {
			clientId: getEnvVar('TWITTER_CLIENT_ID'),
			clientSecret: getEnvVar('TWITTER_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	vk: {
		credentials: {
			clientId: getEnvVar('VK_CLIENT_ID'),
			clientSecret: getEnvVar('VK_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	withings: {
		credentials: {
			clientId: getEnvVar('WITHINGS_CLIENT_ID'),
			clientSecret: getEnvVar('WITHINGS_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		},
		scope: ['user.info']
	},
	workos: {
		credentials: {
			clientId: getEnvVar('WORK_OS_CLIENT_ID'),
			clientSecret: getEnvVar('WORK_OS_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	yahoo: {
		credentials: {
			clientId: getEnvVar('YAHOO_CLIENT_ID'),
			clientSecret: getEnvVar('YAHOO_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	yandex: {
		credentials: {
			clientId: getEnvVar('YANDEX_CLIENT_ID'),
			clientSecret: getEnvVar('YANDEX_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	},
	zoom: {
		credentials: {
			clientId: getEnvVar('ZOOM_CLIENT_ID'),
			clientSecret: getEnvVar('ZOOM_CLIENT_SECRET'),
			redirectUri: getEnvVar('OAUTH2_CALLBACK_URI')
		}
	}
});
