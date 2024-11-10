import os from 'os';

export const getLocalIPAddress = () => {
	const interfaces = os.networkInterfaces();
	for (const name in interfaces) {
		for (const iface of interfaces[name]!) {
			if (iface.family === 'IPv4' && !iface.internal) {
				return iface.address; // Return the first non-internal IPv4 address
			}
		}
	}

	console.warn('No IP address found, falling back to localhost');

	return 'localhost'; // Fallback to localhost if no IP found
};
