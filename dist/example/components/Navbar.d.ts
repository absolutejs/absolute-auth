import type { Dispatch, SetStateAction } from 'react';
import type { User } from '../db/schema';
type NavbarProps = {
    userIdentity: User | null;
    setUserIdentity: Dispatch<SetStateAction<User | null>>;
    modalOpen: boolean;
    setModalOpen: Dispatch<SetStateAction<boolean>>;
};
export declare const Navbar: ({ userIdentity, setUserIdentity, modalOpen, setModalOpen }: NavbarProps) => import("react/jsx-runtime").JSX.Element;
export {};
