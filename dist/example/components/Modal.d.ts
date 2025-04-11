import { ReactNode } from 'react';
type ModalProps = {
    isOpen: boolean;
    onClose: () => void;
    children: ReactNode;
};
export declare const Modal: ({ isOpen, onClose, children }: ModalProps) => import("react/jsx-runtime").JSX.Element | null;
export {};
