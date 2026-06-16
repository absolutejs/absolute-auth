// Mounts `GET /vc/status/:listId` — the wallet/verifier-facing endpoint that returns the
// published status list JWT. The consumer wires `getStatusList(listId) → Uint8Array | undefined`
// and the package handles signing on the fly so revocations are reflected on the next fetch.

import { Elysia, t } from 'elysia';
import type { SigningKey } from '../oidc/keys';
import {
	signStatusList,
	STATUS_LIST_SUB_TYP,
	type StatusListBits
} from './statusList';

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

export const DEFAULT_STATUS_ROUTE = '/vc/status';

export const statusListRoutes = ({
	getStatusList,
	issuerUrl,
	signingKey,
	statusRoute = DEFAULT_STATUS_ROUTE,
	ttlSeconds
}: {
	// Pulls the raw bytes for one list. Return undefined for unknown listId.
	getStatusList: (
		listId: string
	) => Promise<StatusListBits | undefined> | StatusListBits | undefined;
	issuerUrl: string;
	signingKey: SigningKey;
	statusRoute?: string;
	// The published `ttl` claim — wallets cache for this long before refetching.
	ttlSeconds?: number;
}) => {
	const listRoute = `${statusRoute}/:listId` as const;

	return new Elysia().get(
		listRoute,
		async ({ params: { listId } }) => {
			const bits = await getStatusList(listId);
			if (bits === undefined) {
				return new Response('Not found', { status: HTTP_NOT_FOUND });
			}
			const jwt = await signStatusList({
				bits,
				issuer: issuerUrl,
				listUri: `${issuerUrl}${statusRoute}/${listId}`,
				signingKey,
				ttlSeconds
			});

			return new Response(jwt, {
				headers: { 'content-type': STATUS_LIST_SUB_TYP },
				status: HTTP_OK
			});
		},
		{ params: t.Object({ listId: t.String() }) }
	);
};
