import {
	createContext,
	useContext,
	useState,
	useEffect,
	ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { Toast } from './Toast';
import { TOAST_DURATION } from '../../utils/constants';

type Toast = {
	id: number;
	message: string;
	action?: { label: string; onClick: () => void };
	style?: { background?: string; color?: string };
};

type AddToastProps = {
	message: string;
	action?: Toast['action'];
	style?: Toast['style'];
	duration?: number;
};

type ToastContextType = {
	addToast: (opts: AddToastProps) => void;
	registerHost: (host: HTMLElement | null) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);
export const useToast = () => {
	const ctx = useContext(ToastContext);
	if (!ctx) throw new Error('useToast must be used within ToastProvider');

	return ctx;
};

type ToastProviderProps = {
	children: ReactNode;
};

export const ToastProvider = ({ children }: ToastProviderProps) => {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const [host, setHost] = useState<HTMLElement | null>(null);

	useEffect(() => {
		setHost(document.body);
	}, []);

	const addToast = ({
		message,
		action,
		style,
		duration = TOAST_DURATION
	}: AddToastProps) => {
		const id = Date.now();
		setToasts((prev) => [...prev, { action, id, message, style }]);
		if (duration > 0) setTimeout(() => removeToast(id), duration);
	};

	const removeToast = (id: number) =>
		setToasts((prev) => prev.filter((toast) => toast.id !== id));

	const registerHost = (element: HTMLElement | null) =>
		setHost(element ?? document.body);

	return (
		<ToastContext.Provider value={{ addToast, registerHost }}>
			{children}
			{host !== null &&
				createPortal(
					<div
						style={{
							alignItems: 'flex-end',
							bottom: '1rem',
							display: 'flex',
							flexDirection: 'column',
							position: 'fixed',
							right: '1rem',
							zIndex: 10000
						}}
					>
						{toasts.map((toast) => (
							<Toast
								key={toast.id}
								message={toast.message}
								action={toast.action}
								style={toast.style}
								removeToast={() => removeToast(toast.id)}
							/>
						))}
					</div>,
					host
				)}
		</ToastContext.Provider>
	);
};
