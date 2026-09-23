# Neon partner OAuth

Neon direct OAuth requires a registered partner application and an active commercial
relationship. This preset does not register an application or confer partner status.
See https://neon.com/docs/guides/oauth-integration for registration and callback requirements.

```ts
import { createNeonProviderConfiguration } from '@absolutejs/auth/providers';

const neon = createNeonProviderConfiguration({
  credentials: {
    clientId: process.env.NEON_CLIENT_ID!,
    clientSecret: process.env.NEON_CLIENT_SECRET!,
    redirectUri: 'https://app.example.com/auth/neon/callback'
  },
  scopes: ['urn:neoncloud:orgs:read', 'urn:neoncloud:projects:read'],
  offlineAccess: true
});
// Pass customProviders: { neon } to your existing Auth configuration.
```

Keep credentials on the server. Register the exact callback used by your Auth
mount. The preset enables S256 PKCE, identifies accounts by `sub`, and requests
`openid`. Management permissions must be explicit. `offlineAccess` adds both
`offline` and `offline_access`; it defaults to false. Request create/update only
when the customer needs those operations. Delete and organization administration
are never implicit. Do not infer an email or organization from the subject.

The existing custom-provider authorization, callback, profile, refresh and revoke
routes handle this definition. An account connection is separate from signing the
customer into your application; enforce your application's account-linking policy.
The generic `createOAuthLinkedProviderCredentialResolver` currently accepts only
built-in providers. Applications using that resolver need a custom-provider-aware
resolver before enabling unattended Neon management. This preset alone does not
provide a resource picker, database provisioning, secret delivery or browser
assistance. Do not enable the customer-facing connection until those pieces and
partner credentials are in place.

Use a provider-owned sign-in window where required. Do not proxy sign-in into an
embedded browser that violates the identity provider's policies. Never put client
secrets, refresh tokens or database connection strings into chat or referral URLs.
Referral agreements and reporting are separate from OAuth permission grants.
