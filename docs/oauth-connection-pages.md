# OAuth connection screens

Import `renderOAuthConsentPage`, `renderOAuthStatusPage`, and `oauthPageResponse` from `@absolutejs/auth/oidc`. These server-rendered, responsive light/dark screens accept a brand name and optional same-origin logo path. All text and hidden fields are escaped; navigation and form URLs must be same-origin paths. The response helper disables caching, referrer path/query disclosure, scripts, and framing.

```ts
import {
	renderOAuthConsentPage,
	oauthPageResponse
} from '@absolutejs/auth/oidc';

const response = oauthPageResponse(
	renderOAuthConsentPage({
		brand: { name: 'My app', logoPath: '/logo.svg' },
		clientName: 'The requesting MCP client',
		permissions: ['Read your profile'],
		actionPath: '/oauth/consent',
		fields: {
			request_id: 'server-owned-request',
			csrf: 'session-bound-token'
		}
	})
);
```

Resolve the registered client and permissions server-side. The application still verifies sessions, CSRF, request expiry, scopes, administrator/MFA requirements, and its existing consent policy before recording approval. The renderer never grants access. Buttons POST `decision=approve` or `decision=deny`; custom names/values are available for existing endpoints. Unknown scopes must still be disclosed, rather than silently omitted.

For a supported device flow, pass `userCode` to show a compare-code confirmation. After the persisted decision, render state `approved` or `denied` using `renderOAuthStatusPage`. `approved` says the requesting client can finish connecting; it does not claim that token exchange completed. Use `connected` only after a verified successful exchange/connection. `expired`, `error`, and `handoff` provide recovery text. Optional `action: {label, href}` supplies a same-origin next step. Never put tokens or authorization codes into a success-page URL.

## Hosted MCP installation

An HTTPS MCP server stays hosted. Users add its public URL to their MCP client; they do not install the server. A desktop client may receive its OAuth callback at 127.0.0.1 on the user's computer. A hosted client uses its own callback. Preserve the client's registered redirect URI, state, and PKCE flow. These screens cannot restyle third-party callback responses.

The shared consent page tells users to return to the requesting app after approval. Do not insert another confirmation or replace its callback with a branded page: that would leave the client waiting. If a desktop callback expires, restart login from that client. A callback running on a remote development machine needs that client's supported forwarding/manual callback flow; do not ask ordinary users to expose a port.

Device authorization can keep completion on the issuer's website when the client explicitly supports that grant. `@absolutejs/mcp/local-auth` is such a device-flow helper; the issuer must implement authenticated code confirmation and policy enforcement. This is not an automatic replacement for standard HTTP MCP OAuth clients.
