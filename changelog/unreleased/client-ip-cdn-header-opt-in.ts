import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The client address given to `isMfaRequired` came from `cf-connecting-ip` or `do-connecting-ip` whenever a request carried one. Any client can send those headers to an app that has no Cloudflare or DigitalOcean App Platform in front of it, so the address MFA and risk rules see could be chosen by the caller. A CDN header is now read only when `credentials.clientIpHeader` names it; otherwise the address is the first `x-forwarded-for` entry, which the reverse proxy sets.',
	kind: 'security',
	summary:
		'Read a CDN client-address header only when credentials.clientIpHeader names it'
};
