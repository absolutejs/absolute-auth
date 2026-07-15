# Absolute Auth

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

The `agentAuth` block provides a standards-first agent identity layer without
depending on a vendor registration protocol. It publishes RFC 9728 protected
resource metadata, records agent registrations and user delegations, and adds a
scoped `protectAgent` guard. Protocol-specific credentials are normalized by a
verifier adapter:

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
