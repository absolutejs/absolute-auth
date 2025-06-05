import { AnimatedProps } from '@react-spring/web';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { CSSProperties, ReactNode } from 'react';

export type AnimatedCSSProperties = AnimatedProps<CSSProperties>;

export type NavbarLink = {
	href: string;
	label: string;
	icon?: ReactNode;
};

type NavbarDropdown = {
	label: string;
	href: string;
	links: NavbarLink[];
	icon?: ReactNode;
};

export const isNavbarDropdown = (
	element: NavbarElement
): element is NavbarDropdown => 'links' in element;

export type NavbarElement = NavbarLink | NavbarDropdown;

export type UserFunctionProps<SchemaType extends Record<string, unknown>> = {
	authProvider: string;
	userIdentity: Record<string, unknown>;
	db: NeonHttpDatabase<SchemaType>;
};
