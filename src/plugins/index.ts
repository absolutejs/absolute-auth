// First-party plugins for `@absolutejs/auth`.
//
// These are intentionally tiny — each is a named function that returns a value
// matching one of the existing hook signatures (AuditSink, isMfaRequired, the
// onCredentialsLoginSuccess shape, etc.). The package's value is its hooks, NOT
// any framework on top of them; this directory exists to demonstrate that "plugin"
// just means "a function you drop into a hook." Copy any of these and modify when
// you need something the shipped set doesn't cover.
//
// Each file is self-contained, ~20-40 LOC. No plugin registry, no lifecycle
// abstraction, no install command.

export { denyDisposableEmailPlugin } from './denyDisposableEmail';
export type { DenyDisposableEmailDecision } from './denyDisposableEmail';
export { discordAlertPlugin } from './discordAlert';
export type { DiscordAlertOptions } from './discordAlert';
export { geoBlockPlugin } from './geoBlock';
export type { GeoBlockOptions } from './geoBlock';
export { pagerdutyAlertPlugin } from './pagerdutyAlert';
export type {
	PagerDutyAlertOptions,
	PagerDutySeverity
} from './pagerdutyAlert';
export { posthogIdentifyPlugin } from './posthogIdentify';
export type { PosthogIdentifyOptions } from './posthogIdentify';
export { slackAlertPlugin } from './slackAlert';
export type { SlackAlertOptions } from './slackAlert';
