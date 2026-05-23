import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { server as eden } from '../../eden/treaty';
import { buttonStyle, contentStyle } from '../../styles/styles';
import { Modal } from '../utils/Modal';
import { useToast } from '../utils/ToastProvider';

type DeleteAccountSectionProps = {
	onSignedOut: () => Promise<void>;
};

const cardStyle = {
	background: '#fff',
	border: '1px solid #fecaca',
	borderRadius: '0.75rem',
	boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
	padding: '1rem',
	width: 'min(960px, 92vw)'
} as const;

const hintCode = 'DELETE';
const edenClient = eden as unknown as Record<string, any>;

const unwrap = <T,>(response: { data: T | null; error: unknown }) => {
	if (response.error) {
		if (response.error instanceof Error) {
			throw response.error;
		}

		if (
			typeof response.error === 'object' &&
			response.error !== null &&
			'value' in response.error &&
			typeof response.error.value === 'string'
		) {
			throw new Error(response.error.value);
		}

		throw new Error(String(response.error));
	}

	return response.data;
};

const copyToClipboard = async (value: string) => {
	if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
		throw new Error('Clipboard API unavailable');
	}

	await navigator.clipboard.writeText(value);
};

export const DeleteAccountSection = ({
	onSignedOut
}: DeleteAccountSectionProps) => {
	const { addToast } = useToast();
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [confirmationText, setConfirmationText] = useState('');

	const deleteAccountMutation = useMutation({
		mutationFn: async () => unwrap(await edenClient.account.delete()),
		onSuccess: async () => {
			setIsModalOpen(false);
			setConfirmationText('');
			await onSignedOut();
			addToast({
				message: 'Account deleted',
				style: { background: '#d4edda', color: '#155724' }
			});
			window.location.href = '/';
		}
	});

	const resetModal = () => {
		setIsModalOpen(false);
		setConfirmationText('');
	};

	const canDelete =
		confirmationText.trim() === hintCode &&
		!deleteAccountMutation.isPending;

	return (
		<div
			style={{
				...contentStyle,
				gap: '1rem',
				justifyContent: 'flex-start',
				paddingBottom: '2rem'
			}}
		>
			<div style={cardStyle}>
				<h2 style={{ color: '#991b1b' }}>Delete Account</h2>
				<p>
					This permanently deletes the AbsoluteJS account, linked
					login identities, merge requests, connector grants, and
					connector bindings.
				</p>
				<button
					onClick={() => setIsModalOpen(true)}
					style={buttonStyle({
						backgroundColor: '#991b1b',
						color: 'white'
					})}
				>
					Delete account
				</button>
			</div>
			<Modal isOpen={isModalOpen} onClose={resetModal}>
				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						gap: '1rem',
						maxWidth: '28rem'
					}}
				>
					<h2 style={{ margin: 0 }}>Delete account?</h2>
					<p style={{ margin: 0 }}>
						This cannot be undone. Your login identities and
						connector data for this account will be removed.
					</p>
					<div
						style={{
							alignItems: 'center',
							background: '#fef2f2',
							border: '1px solid #fecaca',
							borderRadius: '0.75rem',
							display: 'flex',
							gap: '0.75rem',
							justifyContent: 'space-between',
							padding: '0.75rem'
						}}
					>
						<div
							style={{
								display: 'flex',
								flexDirection: 'column',
								gap: '0.25rem'
							}}
						>
							<span
								style={{
									color: '#7f1d1d',
									fontSize: '0.875rem',
									fontWeight: 600
								}}
							>
								Type this to confirm
							</span>
							<code
								style={{
									color: '#991b1b',
									fontSize: '1rem',
									fontWeight: 700
								}}
							>
								{hintCode}
							</code>
						</div>
						<button
							onClick={async () => {
								try {
									await copyToClipboard(hintCode);
									addToast({
										message: 'Copied DELETE',
										style: {
											background: '#d4edda',
											color: '#155724'
										}
									});
								} catch (error) {
									addToast({
										duration: 0,
										message:
											error instanceof Error
												? error.message
												: 'Copy failed',
										style: {
											background: '#f8d7da',
											color: '#721c24'
										}
									});
								}
							}}
							style={buttonStyle({
								backgroundColor: '#fee2e2',
								color: '#991b1b'
							})}
							type="button"
						>
							Copy
						</button>
					</div>
					<label
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: '0.5rem'
						}}
					>
						<span style={{ fontWeight: 600 }}>Confirmation</span>
						<input
							autoComplete="off"
							name="delete-account-confirmation"
							onChange={(event) =>
								setConfirmationText(event.target.value)
							}
							placeholder="Type DELETE"
							style={{
								border: '1px solid #d1d5db',
								borderRadius: '0.75rem',
								fontSize: '1rem',
								padding: '0.75rem 0.875rem'
							}}
							value={confirmationText}
						/>
					</label>
					<div
						style={{
							display: 'flex',
							gap: '0.75rem',
							justifyContent: 'flex-end'
						}}
					>
						<button
							onClick={resetModal}
							style={buttonStyle({
								backgroundColor: '#e5e7eb',
								color: '#111827'
							})}
						>
							Cancel
						</button>
						<button
							disabled={!canDelete}
							onClick={() => {
								deleteAccountMutation.mutate(undefined, {
									onError: (error) => {
										addToast({
											duration: 0,
											message: error.message,
											style: {
												background: '#f8d7da',
												color: '#721c24'
											}
										});
									}
								});
							}}
							style={buttonStyle({
								backgroundColor: '#991b1b',
								color: 'white'
							})}
						>
							{deleteAccountMutation.isPending
								? 'Deleting...'
								: 'Delete account'}
						</button>
					</div>
				</div>
			</Modal>
		</div>
	);
};
