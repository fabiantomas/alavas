import { getToken } from "./_helpers.js";
export default function handler(req, res) {
  const t = getToken(req);
  res.json({ connected: !!t, userId: t?.userId || null });
}
