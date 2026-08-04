export type MonitoringLatencyMetric =
  | 'api'
  | 'gemini'
  | 'simli'
  | 'billing'
  | 'database';

export type MonitoringFailureMetric =
  | 'authentication'
  | 'payment'
  | 'tutor';

export type MonitoringAttributes = Record<string, string | number | boolean | undefined>;

export interface MonitoringProvider {
  observeLatency(metric: MonitoringLatencyMetric, durationMs: number, attributes?: MonitoringAttributes): void;
  incrementFailure(metric: MonitoringFailureMetric, attributes?: MonitoringAttributes): void;
}

const ALLOWED_ATTRIBUTE_NAMES = new Set([
  'provider',
  'route',
  'operation',
  'feature',
  'status',
  'source',
  'reason',
]);

function sanitizeAttributes(attributes?: MonitoringAttributes): Record<string, string> {
  if (!attributes) return {};

  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([key, value]) => ALLOWED_ATTRIBUTE_NAMES.has(key) && value !== undefined)
      .map(([key, value]) => [key, String(value).slice(0, 80)])
  );
}

let provider: MonitoringProvider = {
  observeLatency: () => undefined,
  incrementFailure: () => undefined,
};

export function setMonitoringProvider(nextProvider: MonitoringProvider): void {
  provider = nextProvider;
}

export function observeMonitoringLatency(metric: MonitoringLatencyMetric, durationMs: number, attributes?: MonitoringAttributes): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  provider.observeLatency(metric, durationMs, sanitizeAttributes(attributes));
}

export function incrementMonitoringFailure(metric: MonitoringFailureMetric, attributes?: MonitoringAttributes): void {
  provider.incrementFailure(metric, sanitizeAttributes(attributes));
}

export function startMonitoringTimer(metric: MonitoringLatencyMetric, attributes?: MonitoringAttributes): () => void {
  const startedAt = Date.now();
  return () => observeMonitoringLatency(metric, Date.now() - startedAt, attributes);
}