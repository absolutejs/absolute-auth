import { createElement } from 'react';
import type { ComponentType } from 'react';
import { renderToReadableStream } from 'react-dom/server';

export const handlePageRequest = async (
	pageComponent: ComponentType,
	index: string
) => {
	const page = createElement(pageComponent);
	const stream = await renderToReadableStream(page, {
		bootstrapModules: [index]
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/html' }
	});
};
