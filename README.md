# Absolute Auth

Server applications should import the primary authentication contract from
`@absolutejs/auth/server`. This declaration-stable entry point exposes `auth`,
session types, route protection, provider configuration, and the other core
server utilities without loading declarations for every optional Auth feature.
OIDC provider integrations should likewise import signing keys, token
verification, provider stores, and provider types from `@absolutejs/auth/oidc`.
The root entry point remains available for applications that need the complete
feature export surface. `auth()` exposes the complete reusable request context
(`protectRoute`, `requireRecentAuth`, optional `protectPermission`, and
`protectAgent`) while keeping its declaration bounded. Consumers that need the
typed configurable route applications themselves can call
`createAuthApplications()` from the root entry point and compose its
`coreRoutes`, `featureRoutes`, and `authContext` applications independently.

## Overview

Absolute Auth is a TypeScript-based authentication system that provides a comprehensive solution for handling user authentication in web applications. It supports multiple authentication providers and offers features such as authorization, callback handling, token refresh, token revocation, and session management.

## Installation

### Prerequisites

- [Elysia](https://elysiajs.com/)

### Steps to Install Dependencies

1. Clone the repository:

    ```bash
    git clone https://github.com/absolutejs/auth.git
    cd auth
    ```

2. Install the dependencies:
    ```bash
    bun install
    ```

## Usage

### Example app

A full, runnable demo lives in the AbsoluteJS examples repo under
[`examples/auth`](https://github.com/absolutejs/examples/tree/main/auth). It
shows `@absolutejs/auth` across all six AbsoluteJS frontends (React, Vue,
Svelte, Angular, HTML, HTMX) — login, identity linking/merging, and connector
grants — against one shared Elysia server.

## Authentication System

### Expired browser sessions

Long-lived application tabs can install the framework-agnostic session guard
once during client boot. It checks the package status route when a tab becomes
active, intercepts `401` responses from explicitly protected same-origin paths,
and returns the person to the page they were using after sign-in:

```ts
import { installSessionExpiryGuard } from '@absolutejs/auth/client';

installSessionExpiryGuard({
	protectedPaths: ['/v1/'],
	signInPath: '/signin'
});
```

### Installed-app authentication

`createMobileAuthClient` keeps the public auth surface provider-neutral while
using the installed-app security model: system-browser Authorization Code with
S256 PKCE, exact state/issuer/redirect validation, rotating refresh credentials
in native secure storage, in-memory access tokens, serialized refresh, and an
origin allowlist for bearer requests. Passwords are entered in the external
authorization UI and never posted through the app WebView.

```ts
import {
	createMobileAuthClient,
	createMobileAuthTransport,
	createAuthClient
} from '@absolutejs/auth/client';
import { lifecycle, links, secureStorage } from '@absolutejs/devices';

const mobile = createMobileAuthClient({
	clientId: 'com.example.app',
	issuer: 'https://app.example',
	lifecycle,
	links,
	redirectUri: 'com.example.app:/oauth/callback',
	storage: secureStorage
});
const authClient = createAuthClient({
	transport: createMobileAuthTransport(mobile)
});
```

The OIDC client registration must be public (no client secret), include the
exact redirect URI, permit the requested scopes/resource, and require PKCE.
Browser applications continue using HTTP-only session cookies.

AbsoluteJS mobile builds provision that public client automatically when the
application declares `@absolutejs/auth`. The CLI passes a strict
`ABSOLUTE_AUTH_NATIVE_CLIENTS` deployment declaration into the server runtime;
Auth layers matching issuer clients over `oidc.clientStore` without writing to
the consumer's database. An explicitly stored client with the same ID remains
authoritative. Applications that use Auth on mobile must mount the OIDC
provider; the mobile build fails with an actionable error when it is absent.
`mobile.fetchOptional()` is intended for application-shell/page-envelope
requests: it sends a bearer token when a renewable session exists and otherwise
performs a credential-free request so public pages still load before sign-in.
The generated native shell installs this transport through the package-owned
runtime registry, so existing `createAuthClient()` calls select it without
application changes. Explicit `transport` options always win, installation is
stacked and reversible, and web/server runtimes never install the registry.

When portable push is enabled, Auth also owns its authenticated installation
boundary. Pass the existing Dispatch push lifecycle directly; the server derives
the principal, tenant, and authorized topics and returns an opaque installation
identity. The native shell handles APNs/FCM tokens, while the generated PWA
runtime handles structured browser subscriptions; ordinary page code reads
neither provider credential:

```ts
const authApplication = await auth({
	// ...normal Auth + OIDC configuration
	push: {
		registrar: pushLifecycle,
		tenant: (principal) => principal.user.organizationId,
		topics: (principal) => topicsFor(principal.user)
	}
});
```

The fixed `/auth/push` route accepts bearer-authenticated native clients and
cookie-authenticated web clients, but never accepts user ID, tenant, or topics
from either. The prior `/auth/mobile/push` path remains an installed-client
compatibility alias. Credential rotation and deletion require the server-issued
installation identity and Dispatch verifies that it belongs to the current
principal. Native sign-out attempts removal while credentials still exist and
always clears the local provider registration even when the network is down.

For WebSocket/Sync authentication, enable a ticket store on the provider. A
valid audience-bound access token can then obtain a 30-second, hashed-at-rest,
single-use ticket from `/oauth2/socket-ticket`:

```ts
const socketTicketStore = createPostgresSocketTicketStore(db);

await auth({
	oidc: {
		// ...normal provider configuration
		socketTicketStore
	}
});

const ticket = await mobile.socketTicket();
```

Run the `oidc` migration block after upgrading; migration
`0004_socket_tickets` creates the ticket table. Resource servers may use
`requireAuthPlugin({ accessTokens: { getUser, oidc } })` to resolve cookie
sessions and bearer access tokens into the same typed `authPrincipal`. DPoP-
bound bearer tokens currently fail closed until resource-proof verification is
enabled.

The complete Auth application also publishes an `absoluteAuthSync` capability
to later Elysia plugins. `@absolutejs/sync` detects it automatically: the
single-use ticket on a WebSocket, the Bearer token on the finite native route,
and an exact-same-origin HTTP-only browser session all resolve to the same
`{ authPrincipal, user }` context. For a browser session the bridge also derives
an opaque PWA IndexedDB namespace from issuer, subject, and the optional
`absolutejs_sync_partition` user claim; the cookie and identity never enter
worker storage. Mount Auth before Sync; page and native code require no
authentication wiring:

```ts
new Elysia().use(authApplication).use(syncSocket({ engine }));
```

The bridge is capability-based, so Auth does not depend on Sync and Sync does
not depend on Auth. Sync owns the exact-Origin, Fetch Metadata, and JSON request
checks before it asks Auth to resolve a cookie session. Invalid, expired,
replayed, wrong-audience, cross-origin, and DPoP-bound credentials continue to
fail closed.

The defaults use `/oauth2/status`, `/signin`, `reason=session_expired`, and a
`returnUrl` query parameter. Use `onExpired` when a router or application shell
should own navigation. The returned guard exposes `check()` for an immediate
status check and `dispose()` for cleanup.

### Optional SAML adapter

SAML route types and wiring are available from the main package. The concrete
`@node-saml/node-saml` adapter is isolated so applications that do not use SAML do
not install or bundle its XML/crypto dependencies:

```ts
import { createNodeSamlAdapter } from '@absolutejs/auth/saml';
```

Install `@node-saml/node-saml` only in applications that use this adapter.

The concrete SimpleWebAuthn adapter follows the same boundary:

```ts
import { createSimpleWebAuthnAdapter } from '@absolutejs/auth/webauthn';
```

### Provider-managed phone verification

`verificationProvider` is the vendor-neutral phone-verification lifecycle.
The contract supports SMS, WhatsApp, and voice-call OTP; MFA currently selects
SMS while signup, recovery, phone change, and step-up flows can use the same
provider contract. Auth owns enrollment, atomic resend/code-consumption policy,
audit, and session promotion; the provider generates, delivers, checks, and
cancels the code.

```ts
import { auth } from '@absolutejs/auth/server';
import { createTwilioVerificationProvider } from '@absolutejs/auth-twilio';
import { Twilio } from 'twilio';

const authPlugin = await auth({
	// credentials, mfa, stores, providersConfiguration, etc.
	verificationProvider: createTwilioVerificationProvider({
		client: new Twilio(
			process.env.TWILIO_ACCOUNT_SID!,
			process.env.TWILIO_AUTH_TOKEN!
		),
		verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID!,
		serviceTokenTtlMs: 10 * 60 * 1000
	})
});
```

Without a provider, `mfa.onSendSmsCode` keeps codes local and accepts any
application-owned delivery system such as `@absolutejs/dispatch`. Its payload
includes `purpose` and `userId` for safe templates, audit correlation, and
tenant routing. Provider and local-code sends share the default 30-second
per-enrollment resend cooldown; configure `mfa.smsResendCooldownMs` when needed.
MFA enrollment, replacement, and removal require a fresh authentication by
default (five minutes); configure `mfa.managementAuthMaxAgeMs` deliberately.

Production databases must run the `mfa` migration block after upgrading to add
the atomic SMS challenge identifier.

### Delegated AI agents

The `agentAuth` block provides a standards-first agent identity layer. It
publishes RFC 9728 metadata, records registrations and user delegations, and
adds a scoped `protectAgent` guard. It can also serve a generated `/auth.md`
registration guide and matching structured OAuth metadata. This is native to
`@absolutejs/auth`; no WorkOS service or separate package is required.

Applications using ordinary OAuth dynamic client registration can publish an
agent-readable `/auth.md` without enabling the separate claim/ID-JAG profile.
Set `agentAuth.oauthGuide` to the exact enabled protected resources, metadata
URLs, and scopes. Auth serves the guide and advertises it through RFC 8414
`service_documentation`; the structured OAuth metadata remains authoritative.

Protocol-specific credentials are normalized by verifier adapters:

```ts
import {
	createInMemoryAgentDelegationStore,
	createInMemoryAgentRegistrationStore,
	createOidcAgentCredentialVerifier
} from '@absolutejs/auth/agents';

const registrationStore = createInMemoryAgentRegistrationStore();
const delegationStore = createInMemoryAgentDelegationStore();

const authPlugin = await auth({
	agentAuth: {
		authorizationServer: 'https://auth.example.com',
		delegationStore,
		registerDynamicClients: true,
		registrationStore,
		resource: 'https://api.example.com',
		scopes: ['documents:read', 'documents:write'],
		verifyCredential: createOidcAgentCredentialVerifier({
			// Atomically insert a hash of jkt + jti; return false on conflict.
			consumeDpopJti: replayStore.consume,
			issuer: 'https://auth.example.com',
			publicJwk: signingKey.publicJwk,
			requireDpop: true,
			resource: 'https://api.example.com'
		})
	},
	oidc: {
		// Enable RFC 7591 dynamic client registration and RFC 8628 device auth.
		clientRegistrationTokenStore,
		deviceAuthorizationStore
		// ...the normal OIDC provider configuration
	}
});
```

With `registerDynamicClients` enabled, an RFC 7591 client becomes an agent
registration. Approval through the existing RFC 8628 device flow creates the
user-to-agent delegation. The agent can then use RFC 8693 token exchange to get
a narrowed, audience-bound access token for the protected API.

When `requireDpop` is enabled, the adapter accepts only an RFC 9449-bound
access token using the `DPoP` authorization scheme, verifies its per-request
proof and `ath` token hash, and requires the proof key to match `cnf.jkt`.
Provide `consumeDpopJti` as an atomic shared-store insertion in clustered
deployments; returning `false` rejects a replay. Proofs without `jti`, proofs
whose JWK contains private key material, oversized identifiers, and `htu`
claims containing query or fragment components fail closed. Resource servers
that require RFC 9449 nonces can use the nonce helpers exported by
`@absolutejs/auth/oidc` to issue a separate resource nonce challenge.

```ts
app.get('/documents', ({ protectAgent }) =>
	protectAgent(['documents:read'], (agent) => ({
		agentId: agent.agentId,
		actingFor: agent.userId
	}))
);
```

Postgres and Neon registration/delegation stores are exported alongside the
in-memory stores. Include the `agents` migration block in production.
`runMigrations` uses its existing Neon-compatible pool when given
`databaseUrl`, or accepts an injected `MigrationClient` for standard Postgres
drivers. Injected clients remain owned by the caller and are not closed by the
migration runner.

For agents that need to create or link an account, configure
`agentAuth.agentRegistration` with an identity-registration store, access-token
store, signing key, authenticated-user resolver, and post-claim scopes. Enable
`service_auth` or anonymous registration explicitly; anonymous registration
also requires an idempotent callback that revokes every pre-claim token before
ownership changes. Absolute exposes provider and consumer helpers from
`@absolutejs/auth/agents`, including ID-JAG issuance and verification, secure
RFC 9728/RFC 8414 discovery, claim polling, and assertion exchange.

See [the agent-auth interoperability and deployment guide](docs/AGENT-AUTH.md)
for supported standards, security invariants, and the production checklist.

OIDC and agent-registration signing accepts either a local ES256 `privateJwk`
or a `sign(input)` adapter with the public JWK and key ID. Production adapters
can therefore keep private key material non-exportable in a KMS or HSM. The
adapter must return the 64-byte JOSE ES256 signature (`r || s`); DER conversion
belongs at the KMS boundary.

OIDC providers can retain bounded `previousSigningKeys` containing public
identity only. The JWKS endpoint publishes the active key first and the
previous keys behind it, while every new token remains signed exclusively by
the active key. Provider token exchange, introspection, userinfo, logout hints,
and agent credential verification select the exact verification key named by
the JWT `kid`. Remove each previous key only after the longest issued token
using it has expired; duplicate key IDs fail closed.

### Features

- **Authorization**: Handles the authorization process by generating the authorization URL and redirecting the user to the authentication provider.
- **Callback Handling**: Handles the callback process by validating the authorization code, decoding the ID token, and creating or retrieving the user.
- **Token Refresh**: Handles the token refresh process by refreshing the access token using the refresh token.
- **Token Revocation**: Handles the token revocation process by revoking the access token.
- **Session Management**: Manages user sessions, including creating, retrieving, and removing sessions.

### Configuration Options

- **Providers**: Configure multiple authentication providers such as Google, GitHub, and more.
- **Routes**: Customize the routes for authorization, callback, signout, status, refresh, and revoke.
- **Event Handlers**: Define custom event handlers for authorization, callback, status, refresh, signout, and revoke events.
- **User Management**: Implement custom functions for creating and retrieving users.

## Note

This project uses Bun and is built for Elysia.
