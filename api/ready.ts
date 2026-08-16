import { json, getReadinessStatus, VercelRequest, VercelResponse } from './_lib/http';

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const status = await getReadinessStatus();
  json(res, status.status === 'ready' ? 200 : 503, status);
}
