import { useState, useEffect } from 'react';

type Breakpoints = {
	xs: number;
	sm: number;
	md: number;
	lg: number;
	xl: number;
	'2xl': number;
};

const defaultBreakpoints: Breakpoints = {
	'2xl': 1536,
	lg: 1024,
	md: 768,
	sm: 640,
	xl: 1280,
	xs: 0
};

export type Breakpoint = keyof Breakpoints;

export const useMediaQuery = (customBreakpoints = defaultBreakpoints) => {
	const [breakpoint, setBreakpoint] = useState<Breakpoint>('xs');

	useEffect(() => {
		const handleResize = () => {
			const { innerWidth: width } = window;

			if (width < customBreakpoints.sm) {
				setBreakpoint('xs');
			} else if (width < customBreakpoints.md) {
				setBreakpoint('sm');
			} else if (width < customBreakpoints.lg) {
				setBreakpoint('md');
			} else if (width < customBreakpoints.xl) {
				setBreakpoint('lg');
			} else if (width < customBreakpoints['2xl']) {
				setBreakpoint('xl');
			} else {
				setBreakpoint('2xl');
			}
		};

		handleResize();
		window.addEventListener('resize', handleResize);

		return () => {
			window.removeEventListener('resize', handleResize);
		};
	}, [customBreakpoints]);

	return breakpoint;
};
