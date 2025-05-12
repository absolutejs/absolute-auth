import { animated, SpringRef, SpringValue } from '@react-spring/web';
import { ReactNode, RefObject, useEffect, useRef } from 'react';

type DropdownContainerProps = {
	spring: {
		opacity: SpringValue<number>;
		scale: SpringValue<number>;
	};
	springApi: SpringRef<{ opacity: number; scale: number }>;
	onClose?: () => void;
	children?: ReactNode;
	ignoredElements?: RefObject<HTMLElement | null>[];
};

export const DropdownContainer = ({
	spring,
	springApi,
	onClose,
	children,
	ignoredElements = []
}: DropdownContainerProps) => {
	const dropdownRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleOutsideClick = (event: MouseEvent) => {
			if (!(event.target instanceof Node)) return;

			for (const ref of ignoredElements) {
				if (ref.current && ref.current.contains(event.target)) {
					return;
				}
			}

			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(event.target)
			) {
				void springApi.start({ opacity: 0, scale: 0 });
				onClose?.();
			}
		};

		document.addEventListener('mousedown', handleOutsideClick);

		return () => {
			document.removeEventListener('mousedown', handleOutsideClick);
		};
	}, [ignoredElements, springApi, onClose]);

	return (
		// TODO : Fix this lint error i think its safe to remove but dont have time to check right now
		// eslint-disable-next-line absolute/no-unnecessary-div
		<div style={{ position: 'relative' }}>
			<animated.div
				ref={dropdownRef}
				style={{
					backgroundColor: '#fff',
					borderRadius: '12px',
					boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
					marginTop: '2.25rem',
					opacity: spring.opacity,
					position: 'absolute',
					right: 0,
					scale: spring.scale,
					top: '100%',
					zIndex: 999
				}}
			>
				{children}
			</animated.div>
		</div>
	);
};
