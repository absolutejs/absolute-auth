import { createAuthCredentials } from "../../src";

export const authCredentials = createAuthCredentials({
    '42': {
        clientId: process.env.FORTY_TWO_CLIENT_ID,
        clientSecret: process.env.FORTY_TWO_CLIENT_SECRET,
        redirectUri: process.env.FORTY_TWO_REDIRECT_URI,
    }
})