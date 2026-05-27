# OAuth Provider Quirks Reference

Nango's 2026 post — *"the real-world OAuth experience is comparable to
JavaScript browser APIs in 2008"* — is accurate. Every major OAuth
provider implements the spec a little differently, and the gap between
"works on Localhost with Google" and "works in production with eight
providers" is where most auth libraries lose their developers.

`@absolutejs/auth` delegates provider-specific knowledge to
[citra](https://www.npmjs.com/package/citra), which means the quirks
below are handled for you. This doc exists so you know *what* citra is
handling — useful when debugging, when a provider rolls out a breaking
change, or when you're picking which providers to support.

## Quick reference

| Provider | Standard? | Notable quirks |
|---|---|---|
| Google | ✓ Mostly | Email scope `openid email profile`; refresh tokens require `access_type=offline&prompt=consent`. |
| GitHub | ✗ Not OIDC | Returns `access_token` directly (no `id_token`); the user email needs a second call to `/user/emails` because the primary OAuth payload omits it for users who hide their email. |
| LinkedIn | ✗ | **Silently fails with PKCE.** citra disables PKCE for LinkedIn — passing it returns a confusing "Unauthorized" error from LinkedIn's `/oauth/v2/accessToken` with no body. |
| Slack | ✗ | **Two scope types** — `scope` (workspace-installed bot scopes) and `user_scope` (Sign in with Slack). citra exposes both separately. |
| Discord | ✓ Mostly | Email scope returns a different payload shape on `/users/@me` vs the OIDC `userinfo` endpoint; citra normalizes. |
| Facebook | ✗ | Token exchange uses GET, not POST. App tokens have a different format from user tokens. citra picks the right one. |
| Microsoft / Entra | ✓ | `tid` (tenant) claim is the multi-tenant routing key. Personal accounts vs work accounts return different `iss` claims; citra exposes both. |
| Apple | ✗ | **`form_post` response mode by default** — the redirect comes back as a POST, not GET. citra registers a POST handler. ID token returns first-name/last-name on FIRST sign-in only; we cache it. |
| QuickBooks | ✗ | Adds a `realmId` query param to the redirect — not in the spec, but essential (it's the QuickBooks company-file scope). citra exposes it as a top-level property. |
| Salesforce | ✗ | Returns `instance_url` (which sandbox/region) outside the spec. citra exposes it. Refresh-token TTL is governed by org-level setting "Refresh Token Policy", not OAuth defaults. |
| Notion | ✗ | The `bot_id` in the token response is the workspace integration — not the user. citra makes the distinction. |
| Zoom | ✓ Mostly | Refresh tokens rotate on every use AND invalidate other refresh tokens for the same user — single-device limit by default. |
| Atlassian (Jira / Confluence) | ✗ | Per-resource access tokens. citra fetches `/oauth/token/accessible-resources` after token exchange to expose the cloud IDs the token can access. |
| Spotify | ✓ | Standard. |
| Twitch | ✓ Mostly | The OAuth flow uses `id_token` but the `at_hash` calculation diverges from the spec — citra skips at_hash verification for Twitch. |
| Yahoo | ✗ | Uses non-standard `userinfo` paths per region (US vs JP). citra handles per-region. |
| Stack Overflow | ✗ | Token endpoint returns the access token URL-encoded in the body (e.g. `access_token=abc&expires=86400`), not JSON. citra parses it. |
| Dropbox | ✗ | Refresh tokens not issued unless you pass `token_access_type=offline` — undocumented. citra adds it. |
| Reddit | ✗ | Returns `error: 'unsupported_response_type'` if you DON'T also pass `duration=permanent` for refresh-capable flows. citra adds it. |
| X (Twitter) v2 | ✓ Mostly | Required `code_challenge_method=plain` if you pass `state` containing a `+`. citra escapes. |

## The hairy ones in detail

### LinkedIn

**Problem:** LinkedIn's IdP rejects PKCE proofs without a useful error.
The `/oauth/v2/accessToken` call returns 401 Unauthorized with an HTML
body (yes, HTML) explaining nothing.

**citra's handling:** LinkedIn's provider config sets `pkce: false`.
The redirect URL doesn't include `code_challenge`; the token exchange
doesn't include `code_verifier`. State + nonce only.

**Implication for security:** LinkedIn is a public OAuth client (no
client-bound proof of possession). Combine with strict `redirect_uri`
matching, short auth-code TTLs, and prefer `private_key_jwt` if you
have an enterprise LinkedIn instance.

### Apple Sign In

**Problem 1:** Apple POSTs the callback (form-post response mode) by
default. Most Express/Elysia setups only register the redirect handler
on `GET /callback`.

**citra's handling:** the redirect handler accepts both GET and POST
methods. The package's `callback.ts` extracts the auth code from either
query or form body.

**Problem 2:** Apple includes the user's first/last name as a JSON
payload in the `user` parameter on the **FIRST** sign-in only. Re-logins
omit it. If you wait until the second sign-in to extract the name,
you'll never see it.

**citra's handling:** extracts on first call + persists. Subsequent
sign-ins return the cached name from `auth_identities.metadata`.

### Slack

**Problem:** Slack has two distinct OAuth scope vocabularies — `scope`
(bot/installer scopes) and `user_scope` (Sign in with Slack). Passing
only `scope` works for app install but fails for Sign in with Slack;
passing only `user_scope` works for Sign in with Slack but doesn't
install the app.

**citra's handling:** the Slack provider config exposes both as
separate fields.

### QuickBooks

**Problem:** QuickBooks adds a non-spec `realmId` parameter to the
redirect — it identifies which company file the user authorized. If
you don't capture it, you've lost the only way to know which QuickBooks
account this token operates on.

**citra's handling:** parses `realmId` from the callback URL and
exposes it on the decoded payload alongside `email` / `sub` / etc.

### Salesforce

**Problem 1:** The token response includes `instance_url` — the URL of
the Salesforce org — which is where all subsequent API calls must go.
The OAuth spec has no field for this, so most libraries drop it.

**citra's handling:** `instance_url` exposed on the decoded payload.

**Problem 2:** Refresh token TTL is governed by the Salesforce org's
"Refresh Token Policy" setting, which can be configured to expire
sooner than standard OAuth defaults. If you assume standard semantics,
you'll get random 401s when the org admin tightens the policy.

**citra's handling:** treats every refresh as potentially failing and
returns an explicit error code; the consumer's `OnRefreshError` handler
gets the chance to redirect the user back through the authorize flow.

### Microsoft / Entra ID

**Problem:** Personal accounts and work accounts return different
`iss` (issuer) claims:

```
work:     https://login.microsoftonline.com/{tenant-id}/v2.0
personal: https://login.microsoftonline.com/9188040d-...-bf63a3.../v2.0
```

A naive `iss` allowlist that only includes one breaks the other.

**citra's handling:** issuer-check matches by prefix
`https://login.microsoftonline.com/`. JWKS lookup goes via the `iss`
claim's tenant.

## When citra needs to evolve

Providers change their OAuth behavior unilaterally. When you see:
- A new error code in an `OnCallbackError` log,
- A field you used to get from the decoded payload going missing,
- A `401` from a refresh that used to work,

…the fastest fix is usually to bump citra to its latest version
(`bun add citra@latest`). citra ships a per-provider integration test
suite + tracks upstream changes; typical lag between a provider
breaking change and a citra patch is days, not months.

If a fix isn't in citra yet, open an issue at
[github.com/absolutejs/citra](https://github.com/absolutejs/citra) with
the provider name + the specific request/response that failed. The
provider config is one TypeScript file per provider; patches are usually
5–30 lines.

## Recommended reading

- [Nango: Why is OAuth Still Hard in 2026?](https://nango.dev/blog/why-is-oauth-still-hard/)
- [RFC 9700 (OAuth 2.0 Best Current Practice)](https://datatracker.ietf.org/doc/rfc9700/) — the FAPI 2.0 baseline; pair with `strictFapi: true`.
