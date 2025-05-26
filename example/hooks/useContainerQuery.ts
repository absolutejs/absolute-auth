import { useRef, useState, useEffect, useLayoutEffect } from 'react';

const useIsomorphicLayoutEffect =
	typeof window !== 'undefined' ? useLayoutEffect : useEffect;

type Dimensions = {
	width: number;
	height: number;
	scrollHeight: number;
};

export const useContainerQuery = <T extends HTMLElement = HTMLElement>() => {
	const ref = useRef<T | null>(null);
	const [dimensions, setDimensions] = useState<Dimensions>({
		height: 0,
		scrollHeight: 0,
		width: 0
	});

	useIsomorphicLayoutEffect(() => {
		const measure = () => {
			if (ref.current) {
				setDimensions({
					height: ref.current.offsetHeight,
					scrollHeight: ref.current.scrollHeight,
					width: ref.current.offsetWidth
				});
			}
		};

		measure();
		const observer = new ResizeObserver(() => {
			measure();
		});
		if (ref.current) {
			observer.observe(ref.current);
		}

		return () => {
			observer.disconnect();
		};
	}, []);

	return { dimensions, ref };
};
