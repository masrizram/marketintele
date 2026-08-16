import { json, getHealthStatus, VercelRequest, VercelResponse } from './_lib/http';

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const status = await getHealthStatus();
  json(res, 200, status);
}
