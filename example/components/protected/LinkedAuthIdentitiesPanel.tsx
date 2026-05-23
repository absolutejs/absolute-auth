import { useMemo, useState } from 'react';
import { buttonStyle, contentStyle } from '../../styles/styles';
import { providerData } from '../../utils/providerData';
import { useAuthIdentityPayload } from '../../hooks/useAuthIdentityPayload';
import { HighlightedJson } from '../utils/HighlightedJson';
import { useToast } from '../utils/ToastProvider';

const cardStyle = {
	background: '#fff',
	border: '1px solid #d9e2ec',
	borderRadius: '0.75rem',
	boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
	padding: '1rem',
	width: 'min(960px, 92vw)'
} as const;

const pillStyle = {
	background: '#dbeafe',
	borderRadius: '999px',
	color: '#1d4ed8',
	display: 'inline-flex',
	fontSize: '0.8125rem',
	fontWeight: 700,
	padding: '0.25rem 0.625rem'
} as const;

const summaryStyle = {
	alignItems: 'center',
	cursor: 'pointer',
	display: 'flex',
	gap: '0.75rem',
	justifyContent: 'space-between',
	listStyle: 'none'
} as const;

const searchInputStyle = {
	border: '1px solid #cbd5e1',
	borderRadius: '0.75rem',
	fontSize: '1rem',
	padding: '0.75rem 0.875rem',
	width: '100%'
} as const;

const providerHeadingStyle = {
	alignItems: 'center',
	display: 'flex',
	gap: '0.75rem'
} as const;

const providerLogoStyle = {
	borderRadius: '0.5rem',
	height: '1.75rem',
	objectFit: 'contain',
	width: '1.75rem'
} as const;

const getDisplayIdentity = (provider: string, identityId: string) => {
	const prefix = `${provider}:`;
	return identityId.startsWith(prefix)
		? identityId.slice(prefix.length)
		: identityId;
};

export const LinkedAuthIdentitiesPanel = () => {
	const { addToast } = useToast();
	const [searchTerm, setSearchTerm] = useState('');
	const {
		dismissMergeRequest,
		error,
		loading,
		mergeRequest,
		payload,
		refresh,
		removeIdentity,
		setPrimaryIdentity
	} = useAuthIdentityPayload();

	const allIdentities = useMemo(
		() => (payload ? Object.values(payload.identities).flat() : []),
		[payload]
	);

	const normalizedSearchTerm = searchTerm.trim().toLowerCase();

	const filteredIdentitiesByProvider = useMemo(() => {
		if (!payload) {
			return [] as Array<[string, typeof allIdentities]>;
		}

		return Object.entries(payload.identities)
			.map(([provider, identities]) => {
				const providerInfo =
					providerData[provider as keyof typeof providerData];
				const filteredIdentities = identities.filter((identity) => {
					if (normalizedSearchTerm.length === 0) {
						return true;
					}

					const displayIdentity = getDisplayIdentity(
						provider,
						identity.id
					);
					const haystack = [
						provider,
						providerInfo?.name ?? provider,
						identity.id,
						displayIdentity,
						identity.provider_subject,
						payload.userSub
					]
						.join(' ')
						.toLowerCase();

					return haystack.includes(normalizedSearchTerm);
				});

				return [provider, filteredIdentities] as const;
			})
			.filter(([, identities]) => identities.length > 0);
	}, [allIdentities, normalizedSearchTerm, payload]);

	const runAction = async (label: string, fn: () => Promise<unknown>) => {
		try {
			await fn();
			addToast({
				message: `${label} completed`,
				style: { background: '#d4edda', color: '#155724' }
			});
		} catch (err) {
			addToast({
				duration: 0,
				message: err instanceof Error ? err.message : String(err),
				style: { background: '#f8d7da', color: '#721c24' }
			});
		}
	};

	return (
		<div
			style={{
				...contentStyle,
				gap: '1rem',
				justifyContent: 'flex-start',
				padding: '2rem 0'
			}}
		>
			<div style={cardStyle}>
				<div
					style={{
						alignItems: 'center',
						display: 'flex',
						justifyContent: 'space-between',
						gap: '1rem'
					}}
				>
					<div>
						<h2>Linked Login Identities</h2>
						<p>
							One app user can have multiple login providers
							attached without changing the current session user.
						</p>
					</div>
					<button
						style={buttonStyle({
							backgroundColor: '#111827',
							color: 'white'
						})}
						onClick={() => void refresh()}
					>
						Refresh identities
					</button>
				</div>
				{loading && <p>Loading linked identities...</p>}
				{error && <p style={{ color: '#b91c1c' }}>{error}</p>}
				{payload && (
					<div
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: '1rem',
							marginTop: '1rem'
						}}
					>
						<p>
							<strong>Canonical sub:</strong> {payload.userSub}
						</p>
						<label
							style={{
								display: 'flex',
								flexDirection: 'column',
								gap: '0.5rem'
							}}
						>
							<span style={{ fontWeight: 600 }}>
								Search identities
							</span>
							<input
								onChange={(event) =>
									setSearchTerm(event.target.value)
								}
								placeholder="Search by provider or sub/id"
								style={searchInputStyle}
								value={searchTerm}
							/>
						</label>
						{payload.mergeRequests.length > 0 ? (
							<div
								style={{
									display: 'flex',
									flexDirection: 'column',
									gap: '1rem'
								}}
							>
								<h3>Merge Requests</h3>
								{payload.mergeRequests.map((request) => (
									<div key={request.id} style={cardStyle}>
										<p>
											<strong>Conflict:</strong>{' '}
											{request.conflicting_auth_provider}:
											{
												request.conflicting_provider_subject
											}
										</p>
										<p>
											<strong>Source user:</strong>{' '}
											{request.source_user_sub}
										</p>
										<p>
											<strong>Status:</strong>{' '}
											{request.status}
										</p>
										<div
											style={{
												display: 'flex',
												gap: '0.75rem',
												flexWrap: 'wrap'
											}}
										>
											<button
												style={buttonStyle({
													backgroundColor: '#1d4ed8',
													color: 'white'
												})}
												onClick={() =>
													void runAction(
														`Merged request ${request.id}`,
														() =>
															mergeRequest(
																request.id
															)
													)
												}
											>
												Merge account into current user
											</button>
											<button
												style={buttonStyle({
													backgroundColor: '#7f1d1d',
													color: 'white'
												})}
												onClick={() =>
													void runAction(
														`Dismissed request ${request.id}`,
														() =>
															dismissMergeRequest(
																request.id
															)
													)
												}
											>
												Dismiss request
											</button>
										</div>
									</div>
								))}
							</div>
						) : null}
						{allIdentities.length === 0 ? (
							<p>No linked identities yet.</p>
						) : filteredIdentitiesByProvider.length === 0 ? (
							<p>No identities matched that search.</p>
						) : (
							filteredIdentitiesByProvider.map(
								([provider, identities]) => {
									const providerInfo =
										providerData[
											provider as keyof typeof providerData
										];
									const providerName =
										providerInfo?.name ?? provider;

									return (
										<div
											key={provider}
											style={{
												display: 'flex',
												flexDirection: 'column',
												gap: '1rem'
											}}
										>
											<div style={providerHeadingStyle}>
												{providerInfo ? (
													<img
														alt={`${providerName} logo`}
														src={
															providerInfo.logoUrl
														}
														style={
															providerLogoStyle
														}
													/>
												) : null}
												<h3 style={{ margin: 0 }}>
													{providerName}
												</h3>
											</div>
											{identities.map((identity) => {
												const isRemovalDisabled =
													identity.isPrimary ||
													allIdentities.length <= 1;
												const displayIdentity =
													getDisplayIdentity(
														provider,
														identity.id
													);

												return (
													<details
														key={identity.id}
														style={cardStyle}
													>
														<summary
															style={summaryStyle}
														>
															<div
																style={{
																	display:
																		'flex',
																	flexDirection:
																		'column',
																	gap: '0.25rem'
																}}
															>
																<span>
																	<strong>
																		Identity:
																	</strong>{' '}
																	{
																		displayIdentity
																	}
																</span>
																<span
																	style={{
																		color: '#475569',
																		fontSize:
																			'0.875rem'
																	}}
																>
																	Updated{' '}
																	{new Date(
																		identity.updated_at
																	).toLocaleString()}
																</span>
															</div>
															<div
																style={{
																	alignItems:
																		'center',
																	display:
																		'flex',
																	gap: '0.75rem'
																}}
															>
																{identity.isPrimary ? (
																	<span
																		style={
																			pillStyle
																		}
																	>
																		Primary
																	</span>
																) : null}
																<span
																	style={{
																		color: '#64748b',
																		fontSize:
																			'0.875rem'
																	}}
																>
																	Details
																</span>
															</div>
														</summary>
														<div
															style={{
																display: 'flex',
																flexDirection:
																	'column',
																gap: '1rem',
																marginTop:
																	'1rem'
															}}
														>
															<div
																style={{
																	display:
																		'flex',
																	gap: '0.75rem',
																	flexWrap:
																		'wrap'
																}}
															>
																{identity.isPrimary ? null : (
																	<button
																		style={buttonStyle(
																			{
																				backgroundColor:
																					'#1d4ed8',
																				color: 'white'
																			}
																		)}
																		onClick={() =>
																			void runAction(
																				`Set primary identity ${identity.id}`,
																				() =>
																					setPrimaryIdentity(
																						identity.id
																					)
																			)
																		}
																	>
																		Make
																		primary
																	</button>
																)}
																<button
																	disabled={
																		isRemovalDisabled
																	}
																	style={{
																		...buttonStyle(
																			{
																				backgroundColor:
																					isRemovalDisabled
																						? '#9ca3af'
																						: '#7f1d1d',
																				color: 'white'
																			}
																		),
																		cursor: isRemovalDisabled
																			? 'not-allowed'
																			: 'pointer'
																	}}
																	onClick={() =>
																		void runAction(
																			`Removed identity ${identity.id}`,
																			() =>
																				removeIdentity(
																					identity.id
																				)
																		)
																	}
																>
																	Remove
																	identity
																</button>
															</div>
															<HighlightedJson
																data={
																	identity.metadata
																}
															/>
														</div>
													</details>
												);
											})}
										</div>
									);
								}
							)
						)}
						<details>
							<summary>Raw identity payload</summary>
							<HighlightedJson data={payload} />
						</details>
					</div>
				)}
			</div>
		</div>
	);
};
