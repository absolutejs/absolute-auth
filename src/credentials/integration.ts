/** Package-owned source recipe. Host bindings are explicit: no generated user
 * database, placeholder mailer, secret value or in-memory production fallback. */
export const credentialsIntegrationSource = `import { Elysia } from 'elysia';
import { createAuthContext, createCredentialsApi } from '@absolutejs/auth/server';
import { credentialsConfiguration } from './credentials.config';

export const credentialsApi = createCredentialsApi(credentialsConfiguration);
export const accountApi = new Elysia()
  .use(createAuthContext({ authSessionStore: credentialsConfiguration.authSessionStore }))
  .get('/api/account', ({ absoluteAuthStatus, status }) => {
    if (!absoluteAuthStatus.user) return status(401, { error: 'Sign in required' });
    return { user: absoluteAuthStatus.user };
  });
// Mount both subapps on the application server. Use auth without a credentials
// block for OAuth/sign-out to avoid duplicate credential routes.
// Browser: treaty<typeof credentialsApi>(origin).auth.login.post({email,password})
// Execute that directly typed call in a React Query mutationFn.
`;
