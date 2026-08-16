import { text, metricsRegistry, VercelRequest, VercelResponse } from './_lib/http';

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  text(res, 200, metricsRegistry.toPrometheusText(), 'text/plain; version=0.0.4');
}
