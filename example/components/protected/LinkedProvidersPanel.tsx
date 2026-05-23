import { useEffect, useState } from 'react';
import { buttonStyle, contentStyle } from '../../styles/styles';
import { useToast } from '../utils/ToastProvider';
import { HighlightedJson } from '../utils/HighlightedJson';

type LinkedProviderGrant = {
	id: string;
	authProviderKey: string;
	providerSubject: string;
	status: string;
	grantedScopes: string[];
	updatedAt: number;
};

type LinkedProviderBinding = {
	id: string;
	grantId: string;
	connectorProvider: string;
	externalAccountId: string;
	externalAccountType: string;
	label?: string;
	email?: string;
	status: string;
	availableScopes: string[];
	grantStatus?: string;
	grantUpdatedAt?: number;
};

type LinkedProviderPayload = {
	ownerRef: string;
	grants: LinkedProviderGrant[];
	bindings: LinkedProviderBinding[];
};

const cardStyle = {
	background: '#fff',
	border: '1px solid #d9e2ec',
	borderRadius: '0.75rem',
	boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
	padding: '1rem',
	width: 'min(960px, 92vw)'
} as const;

const rowStyle = {
	display: 'flex',
	flexDirection: 'column',
	gap: '0.75rem'
} as const;

const pillStyle = {
	background: '#eef2ff',
	borderRadius: '999px',
	color: '#1e3a8a',
	display: 'inline-flex',
	fontSize: '0.8125rem',
	fontWeight: 700,
	padding: '0.25rem 0.625rem'
} as const;

const formatDate = (value: number | undefined) =>
	typeof value === 'number' ? new Date(value).toLocaleString() : 'n/a';

export const LinkedProvidersPanel = () => {
	const { addToast } = useToast();
	const [payload, setPayload] = useState<LinkedProviderPayload | null>(null);
	const [error, setError] = useState<string>('');
	const [loading, setLoading] = useState<boolean>(true);

	const load = async () => {
		setLoading(true);
		setError('');
		try {
			const response = await fetch('/linked-providers');
			if (!response.ok) {
				throw new Error(await response.text());
			}
			setPayload((await response.json()) as LinkedProviderPayload);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
	}, []);

	const removeBinding = async (bindingId: string) => {
		const response = await fetch(
			`/linked-providers/bindings/${encodeURIComponent(bindingId)}`,
			{
				method: 'DELETE'
			}
		);
		if (!response.ok) {
			throw new Error(await response.text());
		}
		setPayload((await response.json()) as LinkedProviderPayload);
	};

	const removeGrant = async (grantId: string) => {
		const response = await fetch(
			`/linked-providers/grants/${encodeURIComponent(grantId)}`,
			{
				method: 'DELETE'
			}
		);
		if (!response.ok) {
			throw new Error(await response.text());
		}
		setPayload((await response.json()) as LinkedProviderPayload);
	};

	const runAction = async (label: string, fn: () => Promise<void>) => {
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
						<h2>Linked Providers</h2>
						<p>
							Inspect the durable grant and binding records that
							connector consumers use for background sync.
						</p>
					</div>
					<button
						style={buttonStyle({
							backgroundColor: '#111827',
							color: 'white'
						})}
						onClick={() => void load()}
					>
						Refresh linked providers
					</button>
				</div>
				{loading && <p>Loading linked providers...</p>}
				{error && <p style={{ color: '#b91c1c' }}>{error}</p>}
				{payload && (
					<div style={{ ...rowStyle, marginTop: '1rem' }}>
						<p>
							<strong>Owner:</strong> {payload.ownerRef}
						</p>
						<div style={{ ...rowStyle }}>
							<h3>Bindings</h3>
							{payload.bindings.length === 0 ? (
								<p>No linked bindings yet.</p>
							) : (
								payload.bindings.map((binding) => (
									<div key={binding.id} style={cardStyle}>
										<div
											style={{
												alignItems: 'center',
												display: 'flex',
												justifyContent: 'space-between',
												gap: '1rem'
											}}
										>
											<div>
												<h4>
													{binding.label ??
														binding.externalAccountId}
												</h4>
												<p>
													{binding.connectorProvider}{' '}
													·{' '}
													{
														binding.externalAccountType
													}{' '}
													·{' '}
													{binding.email ??
														binding.externalAccountId}
												</p>
											</div>
											<span style={pillStyle}>
												{binding.status} /{' '}
												{binding.grantStatus ??
													'grant n/a'}
											</span>
										</div>
										<p>
											<strong>Binding:</strong>{' '}
											{binding.id}
										</p>
										<p>
											<strong>Scopes:</strong>{' '}
											{binding.availableScopes.join(
												', '
											) || 'none'}
										</p>
										<p>
											<strong>Grant updated:</strong>{' '}
											{formatDate(binding.grantUpdatedAt)}
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
													backgroundColor: '#991b1b',
													color: 'white'
												})}
												onClick={() =>
													void runAction(
														`Removed binding ${binding.id}`,
														() =>
															removeBinding(
																binding.id
															)
													)
												}
											>
												Remove binding
											</button>
										</div>
									</div>
								))
							)}
						</div>
						<div style={{ ...rowStyle }}>
							<h3>Grants</h3>
							{payload.grants.length === 0 ? (
								<p>No durable grants yet.</p>
							) : (
								payload.grants.map((grant) => (
									<div key={grant.id} style={cardStyle}>
										<div
											style={{
												alignItems: 'center',
												display: 'flex',
												justifyContent: 'space-between',
												gap: '1rem'
											}}
										>
											<div>
												<h4>{grant.authProviderKey}</h4>
												<p>{grant.providerSubject}</p>
											</div>
											<span style={pillStyle}>
												{grant.status}
											</span>
										</div>
										<p>
											<strong>Grant:</strong> {grant.id}
										</p>
										<p>
											<strong>Scopes:</strong>{' '}
											{grant.grantedScopes.join(', ') ||
												'none'}
										</p>
										<p>
											<strong>Updated:</strong>{' '}
											{formatDate(grant.updatedAt)}
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
													backgroundColor: '#7f1d1d',
													color: 'white'
												})}
												onClick={() =>
													void runAction(
														`Removed grant ${grant.id}`,
														() =>
															removeGrant(
																grant.id
															)
													)
												}
											>
												Remove grant
											</button>
										</div>
									</div>
								))
							)}
						</div>
						<details>
							<summary>Raw linked-provider payload</summary>
							<HighlightedJson data={payload} />
						</details>
					</div>
				)}
			</div>
		</div>
	);
};
