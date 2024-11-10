import { ComponentType, createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server.browser';

export const handlePageRequest = async (
	pageComponent: ComponentType,
	index: string,
	requireAuth = false
) => {
	const page = createElement(pageComponent);
	const stream = await renderToReadableStream(page, {
		bootstrapModules: [index]
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/html' }
	});
};
