type MetricsSink = {
  incrementProviderRetry(provider: string): void;
  observeProviderLatency(provider: string, durationMs: number): void;
  recordProviderCircuitState(provider: string, state: string): void;
  recordProviderFailure(provider: string): void;
  recordProviderRequest(provider: string, outcome: 'success' | 'failed'): void;
  recordProviderSuccess(provider: string): void;
};

type MetricsGlobal = typeof globalThis & { __mentoMetrics?: MetricsSink };

function getMetricsSink(): MetricsSink | undefined {
  return (globalThis as MetricsGlobal).__mentoMetrics;
}

export function incrementProviderRetry(provider: string): void {
  getMetricsSink()?.incrementProviderRetry(provider);
}

export function observeProviderLatency(provider: string, durationMs: number): void {
  getMetricsSink()?.observeProviderLatency(provider, durationMs);
}

export function recordProviderCircuitState(provider: string, state: string): void {
  getMetricsSink()?.recordProviderCircuitState(provider, state);
}

export function recordProviderFailure(provider: string): void {
  getMetricsSink()?.recordProviderFailure(provider);
}

export function recordProviderRequest(provider: string, outcome: 'success' | 'failed'): void {
  getMetricsSink()?.recordProviderRequest(provider, outcome);
}

export function recordProviderSuccess(provider: string): void {
  getMetricsSink()?.recordProviderSuccess(provider);
}
