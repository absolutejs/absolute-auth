// OpenTelemetry instrumentation for the package. OTel is the CNCF vendor-neutral standard
// for distributed tracing (the OpenTracing + OpenCensus merger); pipe the spans into
// Datadog / Honeycomb / Grafana Tempo / Sentry / Jaeger / New Relic / whichever APM you
// already pay for. `@opentelemetry/api` is an OPTIONAL peer dep — consumers that don't
// configure tracing never load it. Consumers that do pass `tracing.tracerProvider` once
// to `auth()`, and every wrapped call site becomes a real span; everything else stays
// noop with no runtime cost beyond a function call.
//
// Span names follow the `auth.<surface>.<flow>` convention (e.g. `auth.credentials.login`,
// `auth.oauth.callback`, `auth.mfa.challenge`, `auth.webhook.deliver`). Standard attribute
// names: `auth.flow` (the high-level operation), `auth.user.sub` (when known), `auth.session.id`
// (when known), `auth.provider` (OAuth provider name), and the usual `http.method` /
// `http.status_code` when meaningful.

import type {
	Attributes,
	Span,
	Tracer,
	TracerProvider
} from '@opentelemetry/api';

export type TracingConfig = {
	/** Plug in your `@opentelemetry/sdk-trace-node` (or `-web` / `-bun`) TracerProvider
	 *  here. When omitted, every `withSpan` call short-circuits and the package never
	 *  loads `@opentelemetry/api`. */
	tracerProvider: TracerProvider;
	/** Service name attribute attached to every span. Defaults to `@absolutejs/auth`. */
	serviceName?: string;
};

const DEFAULT_SERVICE_NAME = '@absolutejs/auth';

type SpanWork<Result> = (span: Span | undefined) => Promise<Result>;
type WithSpanFn = <Result>(
	name: string,
	attributes: Attributes | undefined,
	work: SpanWork<Result>
) => Promise<Result>;

const noopWithSpan: WithSpanFn = (_name, _attributes, work) => work(undefined);

let activeWithSpan: WithSpanFn = noopWithSpan;

// Reset hook for tests — restores the noop implementation. Not part of the public API
// surface beyond tests / advanced re-init scenarios.
export const __resetTracingForTests = () => {
	activeWithSpan = noopWithSpan;
};

// One-shot initializer. Called from `auth()` when `tracing` is configured. Dynamic-imports
// `@opentelemetry/api` so consumers without the dep installed pay nothing.
export const initTracing = async (config: TracingConfig) => {
	const otel = await import('@opentelemetry/api');
	const tracer: Tracer = config.tracerProvider.getTracer(
		config.serviceName ?? DEFAULT_SERVICE_NAME
	);

	activeWithSpan = async (name, attributes, work) => {
		const span = tracer.startSpan(name, { attributes });
		try {
			const result = await otel.context.with(
				otel.trace.setSpan(otel.context.active(), span),
				() => work(span)
			);
			span.setStatus({ code: otel.SpanStatusCode.OK });

			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'unknown';
			if (error instanceof Error) span.recordException(error);
			span.setStatus({ code: otel.SpanStatusCode.ERROR, message });
			throw error;
		} finally {
			span.end();
		}
	};
};

// Wrap an async unit of work in a span. No-op when `initTracing` hasn't been called,
// so adding `withSpan(...)` at a call site is zero-cost for consumers without tracing.
// The optional `span` argument lets the work add attributes mid-flight (e.g. `auth.user.sub`
// when it's resolved from a lookup) without re-importing OTel at the call site.
export const withSpan: WithSpanFn = (name, attributes, work) =>
	activeWithSpan(name, attributes, work);
