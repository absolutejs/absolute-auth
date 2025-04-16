import type { Dispatch, SetStateAction } from 'react';
import type { User } from '../db/schema';
type NavbarProps = {
    user: User | undefined;
    modalOpen: boolean;
    handleLogOut: () => Promise<void>;
    setModalOpen: Dispatch<SetStateAction<boolean>>;
};
export declare const Navbar: ({ user, handleLogOut, modalOpen, setModalOpen }: NavbarProps) => import("react/jsx-runtime").JSX.Element;
export {};
