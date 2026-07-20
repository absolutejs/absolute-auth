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
    git clone https://github.com/alexkahndev/absolute-auth.git
    cd absolute-auth
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

### Delegated AI agents

The `agentAuth` block provides a standards-first agent identity layer. It
publishes RFC 9728 metadata, records registrations and user delegations, and
adds a scoped `protectAgent` guard. It can also serve a generated `/auth.md`
registration guide and matching structured OAuth metadata. This is native to
`@absolutejs/auth`; no WorkOS service or separate package is required.

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
			issuer: 'https://auth.example.com',
			publicJwk: signingKey.publicJwk,
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
