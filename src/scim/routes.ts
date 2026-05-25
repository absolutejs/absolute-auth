import { Elysia, t } from 'elysia';
import type { RouteString } from '../types';
import {
	DEFAULT_SCIM_ROUTE,
	resolveScimOrganization,
	type ScimConfig
} from './config';
import {
	applyGroupPatch,
	applyPatch,
	listResponse,
	parseFilter,
	parseGroupInput,
	parseUserInput,
	scimError,
	scimJson,
	serviceProviderConfig,
	toGroupResource,
	toUserResource
} from './serialize';

const SCIM_OK = 200;
const SCIM_CREATED = 201;
const SCIM_NO_CONTENT = 204;
const SCIM_BAD_REQUEST = 400;
const SCIM_UNAUTHORIZED = 401;
const SCIM_NOT_FOUND = 404;
const SCIM_NOT_IMPLEMENTED = 501;
const SCIM_CONTENT_TYPE = 'application/scim+json';

const unauthorized = () =>
	scimError(SCIM_UNAUTHORIZED, 'Invalid or missing SCIM bearer token');

const notImplemented = () =>
	scimError(SCIM_NOT_IMPLEMENTED, 'Group provisioning is not configured');

export const scimRoutes = ({
	getScimGroup,
	getScimUser,
	listScimGroups,
	listScimUsers,
	onScimGroupCreate,
	onScimGroupDelete,
	onScimGroupReplace,
	onScimUserCreate,
	onScimUserDeactivate,
	onScimUserReplace,
	scimRoute = DEFAULT_SCIM_ROUTE,
	scimTokenStore
}: ScimConfig) => {
	const usersRoute: RouteString = `${scimRoute}/Users`;
	const userRoute: RouteString = `${scimRoute}/Users/:id`;
	const groupsRoute: RouteString = `${scimRoute}/Groups`;
	const groupRoute: RouteString = `${scimRoute}/Groups/:id`;
	const spcRoute: RouteString = `${scimRoute}/ServiceProviderConfig`;

	const userLocation = (requestUrl: string, id: string) =>
		`${new URL(requestUrl).origin}${scimRoute}/Users/${id}`;
	const groupLocation = (requestUrl: string, id: string) =>
		`${new URL(requestUrl).origin}${scimRoute}/Groups/${id}`;

	return (
		new Elysia()
			// Okta / Azure AD send `Content-Type: application/scim+json`, which Elysia does not
			// parse as JSON by default.
			.onParse(({ request }, contentType) =>
				contentType === SCIM_CONTENT_TYPE ? request.json() : undefined
			)
			.get(spcRoute, async ({ headers, request }) => {
				const organizationId = await resolveScimOrganization(
					scimTokenStore,
					headers.authorization
				);
				if (organizationId === undefined) return unauthorized();

				return scimJson(
					serviceProviderConfig(
						`${new URL(request.url).origin}${spcRoute}`
					),
					SCIM_OK
				);
			})
			.post(usersRoute, async ({ body, headers, request }) => {
				const organizationId = await resolveScimOrganization(
					scimTokenStore,
					headers.authorization
				);
				if (organizationId === undefined) return unauthorized();

				const input = parseUserInput(body);
				if (input === undefined) {
					return scimError(
						SCIM_BAD_REQUEST,
						'Request body is not a valid SCIM User',
						'invalidValue'
					);
				}

				const user = await onScimUserCreate({ input, organizationId });

				return scimJson(
					toUserResource(user, userLocation(request.url, user.id)),
					SCIM_CREATED
				);
			})
			.get(
				usersRoute,
				async ({ headers, query, request }) => {
					const organizationId = await resolveScimOrganization(
						scimTokenStore,
						headers.authorization
					);
					if (organizationId === undefined) return unauthorized();

					const users = await listScimUsers({
						filter: parseFilter(query.filter),
						organizationId
					});
					const resources = users.map((user) =>
						toUserResource(user, userLocation(request.url, user.id))
					);

					return scimJson(listResponse(resources), SCIM_OK);
				},
				{ query: t.Object({ filter: t.Optional(t.String()) }) }
			)
			.get(
				userRoute,
				async ({ headers, params: { id }, request }) => {
					const organizationId = await resolveScimOrganization(
						scimTokenStore,
						headers.authorization
					);
					if (organizationId === undefined) return unauthorized();

					const user = await getScimUser({ id, organizationId });
					if (user === undefined) {
						return scimError(SCIM_NOT_FOUND, 'User not found');
					}

					return scimJson(
						toUserResource(user, userLocation(request.url, id)),
						SCIM_OK
					);
				},
				{ params: t.Object({ id: t.String() }) }
			)
			.put(
				userRoute,
				async ({ body, headers, params: { id }, request }) => {
					const organizationId = await resolveScimOrganization(
						scimTokenStore,
						headers.authorization
					);
					if (organizationId === undefined) return unauthorized();

					const input = parseUserInput(body);
					if (input === undefined) {
						return scimError(
							SCIM_BAD_REQUEST,
							'Request body is not a valid SCIM User',
							'invalidValue'
						);
					}

					const user = await onScimUserReplace({
						id,
						input,
						organizationId
					});
					if (user === undefined) {
						return scimError(SCIM_NOT_FOUND, 'User not found');
					}

					return scimJson(
						toUserResource(user, userLocation(request.url, id)),
						SCIM_OK
					);
				},
				{ params: t.Object({ id: t.String() }) }
			)
			.patch(
				userRoute,
				async ({ body, headers, params: { id }, request }) => {
					const organizationId = await resolveScimOrganization(
						scimTokenStore,
						headers.authorization
					);
					if (organizationId === undefined) return unauthorized();

					const current = await getScimUser({ id, organizationId });
					if (current === undefined) {
						return scimError(SCIM_NOT_FOUND, 'User not found');
					}

					const user = await onScimUserReplace({
						id,
						input: applyPatch(current, body),
						organizationId
					});
					if (user === undefined) {
						return scimError(SCIM_NOT_FOUND, 'User not found');
					}

					return scimJson(
						toUserResource(user, userLocation(request.url, id)),
						SCIM_OK
					);
				},
				{ params: t.Object({ id: t.String() }) }
			)
			.delete(
				userRoute,
				async ({ headers, params: { id } }) => {
					const organizationId = await resolveScimOrganization(
						scimTokenStore,
						headers.authorization
					);
					if (organizationId === undefined) return unauthorized();

					await onScimUserDeactivate({ id, organizationId });

					return new Response(null, { status: SCIM_NO_CONTENT });
				},
				{ params: t.Object({ id: t.String() }) }
			)
			.post(groupsRoute, async ({ body, headers, request }) => {
				const organizationId = await resolveScimOrganization(
					scimTokenStore,
					headers.authorization
				);
				if (organizationId === undefined) return unauthorized();
				if (onScimGroupCreate === undefined) return notImplemented();

				const input = parseGroupInput(body);
				if (input === undefined) {
					return scimError(
						SCIM_BAD_REQUEST,
						'Request body is not a valid SCIM Group',
						'invalidValue'
					);
				}

				const group = await onScimGroupCreate({
					input,
					organizationId
				});

				return scimJson(
					toGroupResource(
						group,
						groupLocation(request.url, group.id)
					),
					SCIM_CREATED
				);
			})
			.get(
				groupsRoute,
				async ({ headers, query, request }) => {
					const organizationId = await resolveScimOrganization(
						scimTokenStore,
						headers.authorization
					);
					if (organizationId === undefined) return unauthorized();
					if (listScimGroups === undefined) return notImplemented();

					const groups = await listScimGroups({
						filter: parseFilter(query.filter),
						organizationId
					});
					const resources = groups.map((group) =>
						toGroupResource(
							group,
							groupLocation(request.url, group.id)
						)
					);

					return scimJson(listResponse(resources), SCIM_OK);
				},
				{ query: t.Object({ filter: t.Optional(t.String()) }) }
			)
			.get(
				groupRoute,
				async ({ headers, params: { id }, request }) => {
					const organizationId = await resolveScimOrganization(
						scimTokenStore,
						headers.authorization
					);
					if (organizationId === undefined) return unauthorized();
					if (getScimGroup === undefined) return notImplemented();

					const group = await getScimGroup({ id, organizationId });
					if (group === undefined) {
						return scimError(SCIM_NOT_FOUND, 'Group not found');
					}

					return scimJson(
						toGroupResource(group, groupLocation(request.url, id)),
						SCIM_OK
					);
				},
				{ params: t.Object({ id: t.String() }) }
			)
			.put(
				groupRoute,
				async ({ body, headers, params: { id }, request }) => {
					const organizationId = await resolveScimOrganization(
						scimTokenStore,
						headers.authorization
					);
					if (organizationId === undefined) return unauthorized();
					if (onScimGroupReplace === undefined)
						return notImplemented();

					const input = parseGroupInput(body);
					if (input === undefined) {
						return scimError(
							SCIM_BAD_REQUEST,
							'Request body is not a valid SCIM Group',
							'invalidValue'
						);
					}

					const group = await onScimGroupReplace({
						id,
						input,
						organizationId
					});
					if (group === undefined) {
						return scimError(SCIM_NOT_FOUND, 'Group not found');
					}

					return scimJson(
						toGroupResource(group, groupLocation(request.url, id)),
						SCIM_OK
					);
				},
				{ params: t.Object({ id: t.String() }) }
			)
			.patch(
				groupRoute,
				async ({ body, headers, params: { id }, request }) => {
					const organizationId = await resolveScimOrganization(
						scimTokenStore,
						headers.authorization
					);
					if (organizationId === undefined) return unauthorized();
					if (
						getScimGroup === undefined ||
						onScimGroupReplace === undefined
					) {
						return notImplemented();
					}

					const current = await getScimGroup({ id, organizationId });
					if (current === undefined) {
						return scimError(SCIM_NOT_FOUND, 'Group not found');
					}

					const group = await onScimGroupReplace({
						id,
						input: applyGroupPatch(current, body),
						organizationId
					});
					if (group === undefined) {
						return scimError(SCIM_NOT_FOUND, 'Group not found');
					}

					return scimJson(
						toGroupResource(group, groupLocation(request.url, id)),
						SCIM_OK
					);
				},
				{ params: t.Object({ id: t.String() }) }
			)
			.delete(
				groupRoute,
				async ({ headers, params: { id } }) => {
					const organizationId = await resolveScimOrganization(
						scimTokenStore,
						headers.authorization
					);
					if (organizationId === undefined) return unauthorized();
					if (onScimGroupDelete === undefined)
						return notImplemented();

					await onScimGroupDelete({ id, organizationId });

					return new Response(null, { status: SCIM_NO_CONTENT });
				},
				{ params: t.Object({ id: t.String() }) }
			)
	);
};
