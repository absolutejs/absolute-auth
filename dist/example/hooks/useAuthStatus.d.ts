export declare const useAuthStatus: () => {
    userIdentity: {
        given_name: string | null;
        family_name: string | null;
        email: string | null;
        created_at: Date;
        auth_sub: string;
        picture: string | null;
    } | null;
    setUserIdentity: import("react").Dispatch<import("react").SetStateAction<{
        given_name: string | null;
        family_name: string | null;
        email: string | null;
        created_at: Date;
        auth_sub: string;
        picture: string | null;
    } | null>>;
};
