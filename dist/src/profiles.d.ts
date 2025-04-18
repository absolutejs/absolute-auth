export type ProfileRequest = {
    endpoint: string;
    method?: 'GET' | 'POST';
    authIn: 'header' | 'query';
    tokenParam?: string;
    headers?: Record<string, string>;
    body?: any;
};
export declare function fetchUserProfile(provider: string, accessToken: string): Promise<any>;
export declare const profileConfigs: Record<string, ProfileRequest>;
