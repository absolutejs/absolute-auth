import {
	CredentialsFor,
	NonEmptyArray,
	OAuth2Client,
	ProviderOption,
	ProvidersMap,
	isValidProviderOption
} from 'citra';
import {
	OAuth2ConfigurationOptions,
	OAuth2ProviderClientConfiguration,
	ClientProviderEntry,
	ClientProviderGroup
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isProviderClientConfig = <Provider extends ProviderOption>(
	value: unknown
): value is OAuth2ProviderClientConfiguration<Provider> =>
	isRecord(value) && 'credentials' in value;

export const normalizeProvidersConfiguration = (
	providersConfiguration: OAuth2ConfigurationOptions
): Record<
	ProviderOption,
	Record<string, OAuth2ProviderClientConfiguration<ProviderOption>>
> => {
	const normalized = {} as Record<
		ProviderOption,
		Record<string, OAuth2ProviderClientConfiguration<ProviderOption>>
	>;

	for (const [providerName, providerConfig] of Object.entries(
		providersConfiguration
	)) {
		if (!isValidProviderOption(providerName) || !providerConfig) continue;

		if (isProviderClientConfig(providerConfig)) {
			normalized[providerName] = {
				'': providerConfig as OAuth2ProviderClientConfiguration<ProviderOption>
			};
			continue;
		}

		if (
			!isRecord(providerConfig) ||
			Object.keys(providerConfig).length === 0
		) {
			throw new Error(
				`Invalid provider configuration for ${providerName}`
			);
		}

		const clientEntries = Object.fromEntries(
			Object.entries(providerConfig).map(([clientName, clientConfig]) => {
				if (!isProviderClientConfig(clientConfig)) {
					throw new Error(
						`Invalid client configuration for ${providerName}.${clientName}`
					);
				}

				return [
					clientName,
					clientConfig as OAuth2ProviderClientConfiguration<ProviderOption>
				];
			})
		) as Record<string, OAuth2ProviderClientConfiguration<ProviderOption>>;

		normalized[providerName] = clientEntries;
	}

	return normalized;
};

export const resolveProviderClientConfiguration = ({
	clientName,
	providerName,
	providersConfiguration
}: {
	providerName: ProviderOption;
	clientName?: string;
	providersConfiguration: OAuth2ConfigurationOptions;
}) => {
	const normalized = normalizeProvidersConfiguration(providersConfiguration);
	const clients = normalized[providerName];
	if (!clients) {
		return { error: 'Client provider not found' as const };
	}

	const keys = Object.keys(clients);
	if (keys.length === 1 && keys[0] === '') {
		return { config: clients[''] };
	}

	const requestedClient = clientName?.trim();
	if (!requestedClient) {
		return { error: 'Client variant is required' as const };
	}

	const config = clients[requestedClient];
	if (!config) {
		return { error: 'Client variant not found' as const };
	}

	return { config };
};

export const buildClientProviders = async (
	providersConfiguration: OAuth2ConfigurationOptions,
	createOAuth2ClientFn: <P extends ProviderOption>(
		providerName: P,
		config: CredentialsFor<P>
	) => Promise<OAuth2Client<P>>
): Promise<Record<string, ClientProviderGroup>> => {
	const normalized = normalizeProvidersConfiguration(providersConfiguration);
	const groups = await Promise.all(
		Object.entries(normalized).map(async ([providerName, clients]) => {
			const entries = await Promise.all(
				Object.entries(clients).map(
					async ([clientName, providerConfig]) => {
						const providerInstance = await createOAuth2ClientFn(
							providerName as ProviderOption,
							providerConfig.credentials
						);

						return [
							clientName,
							{
								clientName:
									clientName.length > 0
										? clientName
										: undefined,
								providerInstance,
								scope: providerConfig.scope,
								searchParams: providerConfig.searchParams
							} satisfies ClientProviderEntry
						] as const;
					}
				)
			);

			return [
				providerName,
				{
					entries: Object.fromEntries(entries),
					isSingleClient:
						entries.length === 1 && entries[0]?.[0] === ''
				} satisfies ClientProviderGroup
			] as const;
		})
	);

	return Object.fromEntries(groups);
};

export const resolveClientProviderEntry = ({
	clientName,
	clientProviders,
	providerName
}: {
	providerName: string | undefined;
	clientName?: string;
	clientProviders: Record<string, ClientProviderGroup>;
}) => {
	if (!providerName) {
		return { error: 'Provider is required' as const };
	}

	const group = clientProviders[providerName];
	if (!group) {
		return { error: 'Client provider not found' as const };
	}

	if (group.isSingleClient) {
		const entry = group.entries[''];
		if (!entry) {
			return { error: 'Client provider not found' as const };
		}

		return { entry };
	}

	const requestedClient = clientName?.trim();
	if (!requestedClient) {
		return { error: 'Client variant is required' as const };
	}

	const entry = group.entries[requestedClient];
	if (!entry) {
		return { error: 'Client variant not found' as const };
	}

	return { entry };
};
