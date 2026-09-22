import type { Change } from '@absolutejs/changelog';

export const change: Change = {
 kind: 'breaking',
 migration: { instruction: 'Custom MFAStore implementations must implement atomic saveTotpEnrollment. Setup now resumes pending enrollments. TOTP verification preserves existing recovery codes; an empty backupCodes array means existing codes remain unchanged. First-issuance responses can be replayed for ten minutes after a valid TOTP using an encrypted receipt in factor JSON. No SQL migration is required.', manual: true },
 summary: 'Make TOTP setup and verification retry-safe across instances; preserve recovery codes when adding devices, resume pending QR codes, and include device labels in authenticator account names.',
 symbols: ['MFAStore', 'TotpMfaFactor']
};
