import { providers, isValidProviderOption } from 'citra';
import { t } from 'elysia';

export const userSessionIdCookie = t.Optional(
	t.TemplateLiteral('${string}-${string}-${string}-${string}-${string}')
);

export const authProviderOption = t.Enum(
	Object.fromEntries(
		Object.keys(providers)
			.filter(isValidProviderOption)
			.map((key) => [key, key])
	)
);
