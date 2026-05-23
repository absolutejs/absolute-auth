import {
	useMutation,
	useQuery,
	useQueryClient,
	type UseMutationResult
} from '@tanstack/react-query';
import { server as eden } from '../eden/treaty';

export type AuthIdentity = {
	id: string;
	user_sub: string;
	auth_provider: string;
	provider_subject: string;
	metadata?: Record<string, unknown>;
	created_at: string;
	updated_at: string;
	isPrimary: boolean;
};

export type AuthIdentityMergeRequest = {
	id: string;
	target_user_sub: string;
	source_user_sub: string;
	conflicting_auth_provider: string;
	conflicting_provider_subject: string;
	status: string;
	metadata?: Record<string, unknown>;
	created_at: string;
	updated_at: string;
};

export type AuthIdentityPayload = {
	userSub: string;
	primaryIdentityId?: string | null;
	identities: Record<string, AuthIdentity[]>;
	mergeRequests: AuthIdentityMergeRequest[];
};

const authIdentityPayloadQueryKey = ['auth-identities'] as const;
const edenClient = eden as unknown as Record<string, any>;

const toErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}

	if (
		typeof error === 'object' &&
		error !== null &&
		'value' in error &&
		typeof error.value === 'string'
	) {
		return error.value;
	}

	return String(error);
};

const unwrap = <T>(response: { data: T | null; error: unknown }) => {
	if (response.error) {
		throw new Error(toErrorMessage(response.error));
	}

	if (response.data === null) {
		throw new Error('No response data returned');
	}

	return response.data;
};

const usePayloadMutation = <TVariables>(
	mutationFn: (variables: TVariables) => Promise<AuthIdentityPayload>
): UseMutationResult<AuthIdentityPayload, Error, TVariables> => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn,
		onSuccess: (payload) => {
			queryClient.setQueryData(authIdentityPayloadQueryKey, payload);
		}
	});
};

const getAuthIdentityPayload = async () =>
	unwrap<AuthIdentityPayload>(await edenClient['auth-identities'].get());

const postPrimaryIdentity = async (identityId: string) =>
	unwrap<AuthIdentityPayload>(
		await edenClient['auth-identities']({ id: identityId }).primary.post()
	);

const deleteIdentity = async (identityId: string) =>
	unwrap<AuthIdentityPayload>(
		await edenClient['auth-identities']({ id: identityId }).delete()
	);

const postMergeRequest = async (mergeRequestId: string) =>
	unwrap<AuthIdentityPayload>(
		await edenClient['auth-identity-merge-requests']({
			id: mergeRequestId
		}).merge.post()
	);

const deleteMergeRequest = async (mergeRequestId: string) =>
	unwrap<AuthIdentityPayload>(
		await edenClient['auth-identity-merge-requests']({
			id: mergeRequestId
		}).delete()
	);

export const useAuthIdentityPayload = () => {
	const query = useQuery<AuthIdentityPayload, Error>({
		queryKey: authIdentityPayloadQueryKey,
		queryFn: getAuthIdentityPayload,
		enabled: typeof window !== 'undefined'
	});

	const setPrimaryMutation = usePayloadMutation(postPrimaryIdentity);
	const removeIdentityMutation = usePayloadMutation(deleteIdentity);
	const mergeRequestMutation = usePayloadMutation(postMergeRequest);
	const dismissMergeRequestMutation = usePayloadMutation(deleteMergeRequest);

	return {
		dismissMergeRequest: dismissMergeRequestMutation.mutateAsync,
		error: query.error?.message ?? '',
		loading: query.isPending,
		mergeRequest: mergeRequestMutation.mutateAsync,
		payload: query.data ?? null,
		refresh: async () => {
			await query.refetch();
		},
		removeIdentity: removeIdentityMutation.mutateAsync,
		setPrimaryIdentity: setPrimaryMutation.mutateAsync
	};
};
