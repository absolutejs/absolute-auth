import type { OAuth2ConfigurationOptions } from './types';

export type ProviderSelection = Record<
	string,
	{ scope?: string[]; searchParams?: [string, string][] }
>;

const envKey = (provider: string, suffix: string) =>
	`${provider.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_${suffix}`;

/**
 * Build `providersConfiguration` from a serializable provider selection plus
 * environment credentials, by convention: `<PROVIDER>_CLIENT_ID` and
 * `<PROVIDER>_CLIENT_SECRET` (e.g. `GOOGLE_CLIENT_ID`). This is the bridge
 * between no-code/manifest-driven configuration (which must never contain
 * secrets) and `auth()`'s credential-bearing provider entries — the host app
 * wires env → config, the selection stays serializable.
 *
 * Covers providers whose citra credentials are the standard
 * clientId/clientSecret pair. Providers with richer credential shapes
 * (e.g. Apple's team/key ids) should be configured directly in
 * `providersConfiguration`.
 */
export const providersFromEnv = (
	selection: ProviderSelection,
	env: Record<string, string | undefined> = process.env
): OAuth2ConfigurationOptions =>
	Object.fromEntries(
		Object.entries(selection).map(([provider, options]) => [
			provider,
			{
				...options,
				credentials: {
					clientId: env[envKey(provider, 'CLIENT_ID')] ?? '',
					clientSecret: env[envKey(provider, 'CLIENT_SECRET')] ?? ''
				}
			}
		])
	) as OAuth2ConfigurationOptions;
