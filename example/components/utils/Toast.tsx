type ToastProps = {
	message: string;
	action?: { label: string; onClick: () => void };
	style?: { background?: string; color?: string };
	removeToast: () => void;
};

export const Toast = ({ message, action, style, removeToast }: ToastProps) => (
	<div
		style={{
			alignItems: 'flex-start',
			background: style?.background || '#333',
			borderRadius: '0.5rem',
			boxShadow: '0px 4px 10px rgba(0,0,0,0.2)',
			color: style?.color || '#fff',
			direction: 'rtl',
			display: 'flex',
			gap: '1rem',
			marginBottom: '0.625rem',
			maxWidth: '300px',
			overflow: 'visible',
			padding: '0.75rem',
			paddingRight: '2.5rem',
			position: 'relative'
		}}
		onMouseEnter={(event) => {
			const btn =
				event.currentTarget.querySelector<HTMLElement>('.close-btn');
			if (btn) {
				btn.style.opacity = '1';
			}
		}}
		onMouseLeave={(event) => {
			const btn =
				event.currentTarget.querySelector<HTMLElement>('.close-btn');
			if (btn) {
				btn.style.opacity = '0';
			}
		}}
	>
		<span
			style={{
				direction: 'ltr',
				display: 'block',
				fontSize: '0.875rem',
				overflowWrap: 'anywhere',
				wordBreak: 'break-word'
			}}
		>
			{message}
		</span>

		{action !== undefined && (
			<button
				onClick={() => {
					action.onClick();
					removeToast();
				}}
				style={{
					background: '#007BFF',
					border: 'none',
					borderRadius: '0.25rem',
					color: '#fff',
					cursor: 'pointer',
					fontSize: '0.75rem',
					padding: '0.375rem 0.625rem'
				}}
			>
				{action.label}
			</button>
		)}

		<button
			className="close-btn"
			onClick={removeToast}
			style={{
				background: 'transparent',
				border: 'none',
				color: 'inherit',
				cursor: 'pointer',
				fontSize: '0.875rem',
				fontWeight: 'bold',
				opacity: 0,
				position: 'absolute',
				right: '0.5rem',
				top: '0.5rem',
				transition: 'opacity 0.2s ease-in-out'
			}}
		>
			✕
		</button>
	</div>
);
