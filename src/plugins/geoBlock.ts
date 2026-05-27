// Geo-block plugin — gate credential login on the request's country (from
// `x-client-country` or `cf-ipcountry`). Pair with `isMfaRequired` (force MFA in
// blocked countries) OR fail closed by throwing in your own login handler.
//
// ~25 lines; one Set lookup.

const readCountry = (headers: Record<string, string | undefined>) =>
	headers['x-client-country']?.toUpperCase() ??
	headers['cf-ipcountry']?.toUpperCase();

export type GeoBlockOptions =
	| { allowCountries: readonly string[]; denyCountries?: never }
	| { allowCountries?: never; denyCountries: readonly string[] };

// Returns `true` when the request should be BLOCKED (i.e. the user is in a deny-listed
// country, or not in the allow-list). The consumer uses the return to either force
// MFA via `isMfaRequired` or to reject the login outright.
export const geoBlockPlugin = (options: GeoBlockOptions) => {
	const allow =
		options.allowCountries === undefined
			? undefined
			: new Set(options.allowCountries.map((country) => country.toUpperCase()));
	const deny =
		options.denyCountries === undefined
			? undefined
			: new Set(options.denyCountries.map((country) => country.toUpperCase()));

	return (headers: Record<string, string | undefined>) => {
		const country = readCountry(headers);
		if (country === undefined) return false;
		if (deny !== undefined) return deny.has(country);
		if (allow !== undefined) return !allow.has(country);

		return false;
	};
};
