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
				alignItems: 'center',
				backgroundColor: 'rgba(0, 0, 0, 0.5)',
				display: 'flex',
				height: '100%',
				justifyContent: 'center',
				left: 0,
				position: 'fixed',
				top: 0,
				width: '100%',
				zIndex: 10000
			}}
		>
			<div
				style={{
					backgroundColor: '#fff',
					borderRadius: '8px',
					minWidth: '300px',
					padding: '20px',
					position: 'relative'
				}}
			>
				<button
					onClick={onClose}
					style={{
						backgroundColor: 'transparent',
						border: 'none',
						cursor: 'pointer',
						fontSize: '16px',
						position: 'absolute',
						right: '10px',
						top: '10px'
					}}
				>
					&times;
				</button>
				{children}
			</div>
		</div>
	);
};
