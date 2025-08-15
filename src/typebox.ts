import { t } from 'elysia';

export const userSessionIdCookie = t.Optional(
	t.TemplateLiteral('${string}-${string}-${string}-${string}-${string}')
);
