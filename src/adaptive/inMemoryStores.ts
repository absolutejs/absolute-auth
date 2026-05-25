import type {
	KnownDevice,
	KnownDeviceStore,
	LoginAttempt,
	LoginHistoryStore
} from './types';

const deviceKey = (userId: string, deviceId: string) => `${userId}:${deviceId}`;

export const createInMemoryKnownDeviceStore = (): KnownDeviceStore => {
	const devices = new Map<string, KnownDevice>();

	return {
		findDevice: async (userId, deviceId) =>
			devices.get(deviceKey(userId, deviceId)),
		listDevices: async (userId) =>
			Array.from(devices.values())
				.filter((device) => device.userId === userId)
				.sort((left, right) => right.lastSeenAt - left.lastSeenAt),
		saveDevice: async (device) => {
			devices.set(deviceKey(device.userId, device.deviceId), {
				...device
			});
		}
	};
};

export const createInMemoryLoginHistoryStore = (): LoginHistoryStore => {
	const attempts: LoginAttempt[] = [];

	return {
		listRecent: async (userId, limit) =>
			attempts
				.filter((attempt) => attempt.userId === userId)
				.sort((left, right) => right.timestamp - left.timestamp)
				.slice(0, limit),
		recordAttempt: async (attempt) => {
			attempts.push({ ...attempt });
		}
	};
};
