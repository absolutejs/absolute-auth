export declare const useAuthStatus: () => {
    handleLogOut: () => Promise<void>;
    setUser: import("react").Dispatch<import("react").SetStateAction<{
        given_name: string | null;
        family_name: string | null;
        email: string | null;
        created_at: Date;
        auth_sub: string;
        picture: string | null;
    } | undefined>>;
    user: {
        given_name: string | null;
        family_name: string | null;
        email: string | null;
        created_at: Date;
        auth_sub: string;
        picture: string | null;
    } | undefined;
};
