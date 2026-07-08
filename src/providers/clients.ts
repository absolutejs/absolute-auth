import {
	CredentialsFor,
	OAuth2Client,
	ProviderOption,
	createCustomOAuth2Client,
	isValidProviderOption,
	providers
} from 'citra';
import {
	CustomProviderClientConfiguration,
	CustomProvidersConfiguration,
	OAuth2ConfigurationOptions,
	OAuth2ProviderClientConfiguration,
	ClientProviderEntry,
	ClientProviderGroup
} from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isProviderClientConfig = <Provider extends ProviderOption>(
	value: unknown
): value is OAuth2ProviderClientConfiguration<Provider> =>
	isRecord(value) && 'credentials' in value;

const isCustomClientConfig = (
	value: unknown
): value is CustomProviderClientConfiguration =>
	isRecord(value) && 'credentials' in value && 'providerConfig' in value;

const normalizeCustomClients = (
	providerName: string,
	providerConfig: CustomProvidersConfiguration[string]
) => {
	if (isCustomClientConfig(providerConfig)) return { '': providerConfig };
	if (!isRecord(providerConfig) || Object.keys(providerConfig).length === 0) {
		throw new Error(
			`Invalid custom provider configuration for ${providerName}`
		);
	}
	Object.entries(providerConfig).forEach(([clientName, clientConfig]) => {
		if (!isCustomClientConfig(clientConfig)) {
			throw new Error(
				`Invalid custom client configuration for ${providerName}.${clientName}`
			);
		}
	});

	return providerConfig;
};

const buildCustomProviderGroups = async (
	customProviders: CustomProvidersConfiguration
) => {
	const groups = await Promise.all(
		Object.entries(customProviders).map(async ([providerName, config]) => {
			if (isValidProviderOption(providerName)) {
				throw new Error(
					`Custom provider "${providerName}" collides with a built-in provider — configure it under providersConfiguration instead`
				);
			}
			const clients = normalizeCustomClients(providerName, config);
			const entries = await Promise.all(
				Object.entries(clients).map(
					async ([clientName, clientConfig]) => {
						const providerInstance = await createCustomOAuth2Client(
							clientConfig.providerConfig,
							clientConfig.credentials
						);

						return [
							clientName,
							{
								clientName:
									clientName.length > 0
										? clientName
										: undefined,
								providerConfiguration:
									clientConfig.providerConfig,
								providerInstance,
								requiresPKCE:
									clientConfig.providerConfig.PKCEMethod !==
									undefined,
								scope: clientConfig.scope,
								searchParams: clientConfig.searchParams
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

export const buildClientProviders = async (
	providersConfiguration: OAuth2ConfigurationOptions,
	createOAuth2ClientFn: <P extends ProviderOption>(
		providerName: P,
		config: CredentialsFor<P>
	) => Promise<OAuth2Client<P>>,
	customProviders?: CustomProvidersConfiguration
) => {
	const customGroups = customProviders
		? await buildCustomProviderGroups(customProviders)
		: {};
	const normalized = normalizeProvidersConfiguration(providersConfiguration);
	const groups = await Promise.all(
		Object.entries(normalized).map(async ([providerName, clients]) => {
			if (!isValidProviderOption(providerName)) {
				throw new Error(
					`Invalid provider configuration for ${providerName}`
				);
			}

			const entries = await Promise.all(
				Object.entries(clients).map(
					async ([clientName, providerConfig]) => {
						const providerInstance = await createOAuth2ClientFn(
							providerName,
							providerConfig.credentials
						);

						return [
							clientName,
							{
								clientName:
									clientName.length > 0
										? clientName
										: undefined,
								providerConfiguration: providers[providerName],
								providerInstance,
								requiresPKCE:
									providers[providerName].PKCEMethod !==
									undefined,
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

	return { ...customGroups, ...Object.fromEntries(groups) };
};
const normalizeClientConfig = (
	providerName: string,
	clientName: string,
	clientConfig: unknown
) => {
	if (!isProviderClientConfig(clientConfig)) {
		throw new Error(
			`Invalid client configuration for ${providerName}.${clientName}`
		);
	}

	return [clientName, clientConfig] as const;
};

const normalizeProviderClients = (
	providerName: string,
	providerConfig: NonNullable<OAuth2ConfigurationOptions[ProviderOption]>
) => {
	if (isProviderClientConfig(providerConfig)) {
		return { '': providerConfig };
	}

	if (!isRecord(providerConfig) || Object.keys(providerConfig).length === 0) {
		throw new Error(`Invalid provider configuration for ${providerName}`);
	}

	return Object.fromEntries(
		Object.entries(providerConfig).map(([clientName, clientConfig]) =>
			normalizeClientConfig(providerName, clientName, clientConfig)
		)
	);
};

export const normalizeProvidersConfiguration = (
	providersConfiguration: OAuth2ConfigurationOptions
) => {
	const entries = Object.entries(providersConfiguration).flatMap(
		([providerName, providerConfig]) => {
			if (!isValidProviderOption(providerName) || !providerConfig) {
				return [];
			}

			return [
				[
					providerName,
					normalizeProviderClients(providerName, providerConfig)
				] as const
			];
		}
	);

	return Object.fromEntries(entries);
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
