import { json, getLivenessStatus, VercelRequest, VercelResponse } from './_lib/http';

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  json(res, 200, getLivenessStatus());
}
