import { isValidProviderOption, providers } from 'citra';
import { t } from 'elysia';

export const authClientOption = t.Optional(t.String());
export const authIntentOption = t.Optional(
	t.Union([
		t.Literal('login'),
		t.Literal('link_identity'),
		t.Literal('link_connector')
	])
);
export const authProviderOption = t.Enum(
	Object.fromEntries(
		Object.keys(providers)
			.filter(isValidProviderOption)
			.map((key) => [key, key])
	)
);
export const userSessionIdTypebox = t.Optional(
	t.TemplateLiteral('${string}-${string}-${string}-${string}-${string}')
);
