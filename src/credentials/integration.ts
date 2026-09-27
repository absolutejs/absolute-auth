/** Package-owned source recipe. Host bindings are explicit: no generated user
 * database, placeholder mailer, secret value or in-memory production fallback. */
export const credentialsIntegrationSource = `import { Elysia } from 'elysia';
import { createAuthContext, createCredentialsApi, createSignoutApi } from '@absolutejs/auth/server';
import { credentialsConfiguration } from './credentials.config';

export const credentialsApi = createCredentialsApi(credentialsConfiguration);
export const sessionApi = createSignoutApi({ authSessionStore: credentialsConfiguration.authSessionStore });
export const accountApi = new Elysia()
  .use(createAuthContext({ authSessionStore: credentialsConfiguration.authSessionStore }))
  .get('/api/account', ({ absoluteAuthStatus, status }) => {
    if (!absoluteAuthStatus.user) return status(401, { error: 'Sign in required' });
    return { user: absoluteAuthStatus.user };
  });
// Mount credentialsApi, sessionApi and accountApi for credentials-only apps.
// For OAuth apps use full auth without its credentials block and without a
// duplicate sessionApi mount. sessionApi is the narrow default sign-out type.
// Browser: treaty<typeof credentialsApi>(origin).auth.login.post({email,password})
// Sign-out: treaty<typeof sessionApi>(origin).oauth2.signout.delete()
// Execute directly typed calls in React Query mutationFns.
// Elysia 2 schema routes: .post(path, { body: schema }, handler).
`;
