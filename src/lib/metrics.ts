import client from 'prom-client';

// Prometheus metrics for the API and worker. Scraped from inside the Docker network only.
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpDuration = new client.Histogram({
  name: 'skystats_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const upstreamCalls = new client.Counter({
  name: 'skystats_upstream_calls_total',
  help: 'Calls to Hypixel, Mojang, Discord and Stripe',
  labelNames: ['upstream', 'outcome'] as const,
  registers: [registry],
});

export const jobRuns = new client.Counter({
  name: 'skystats_job_runs_total',
  help: 'Background job runs',
  labelNames: ['queue', 'outcome'] as const,
  registers: [registry],
});

export const sseClients = new client.Gauge({ name: 'skystats_sse_clients', help: 'Open live bazaar streams', registers: [registry] });
