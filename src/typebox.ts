import { t } from 'elysia';

export const authClientOption = t.Optional(t.String());
export const authIntentOption = t.Optional(
	t.Union([
		t.Literal('login'),
		t.Literal('link_identity'),
		t.Literal('link_connector')
	])
);
// Any configured provider name — built-in OR customProviders key. The real
// gate is resolveClientProviderEntry (unknown names 404); a static enum of
// citra built-ins would wrongly reject caller-defined providers.
export const authProviderOption = t.String({ minLength: 1 });
export const userSessionIdTypebox = t.Optional(
	t.TemplateLiteral('${string}-${string}-${string}-${string}-${string}')
);
