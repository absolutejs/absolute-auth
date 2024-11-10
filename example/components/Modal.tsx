import { ReactNode, useEffect, MouseEvent } from 'react';

type ModalProps = {
	isOpen: boolean;
	onClose: () => void;
	children: ReactNode;
};

export const Modal = ({ isOpen, onClose, children }: ModalProps) => {
	useEffect(() => {
		if (isOpen) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onClose();
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.body.style.overflow = '';
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [isOpen, onClose]);

	const handleBackgroundClick = (event: MouseEvent<HTMLDivElement>) => {
		if (event.target === event.currentTarget) {
			onClose();
		}
	};

	if (!isOpen) return null;

	return (
		<div
			onClick={handleBackgroundClick}
			style={{
				position: 'fixed',
				top: 0,
				left: 0,
				width: '100%',
				height: '100%',
				backgroundColor: 'rgba(0, 0, 0, 0.5)',
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				zIndex: 10000
			}}
		>
			<div
				style={{
					backgroundColor: '#fff',
					padding: '20px',
					borderRadius: '8px',
					minWidth: '300px',
					position: 'relative'
				}}
			>
				<button
					onClick={onClose}
					style={{
						position: 'absolute',
						top: '10px',
						right: '10px',
						backgroundColor: 'transparent',
						border: 'none',
						fontSize: '16px',
						cursor: 'pointer'
					}}
				>
					&times;
				</button>
				{children}
			</div>
		</div>
	);
};
