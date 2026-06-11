export function getToken(req) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(/polar_token=([^;]+)/);
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(match[1], "base64").toString());
  } catch {
    return null;
  }
}

export async function polarGet(token, path, params) {
  const base = path.startsWith("/v4")
    ? "https://www.polaraccesslink.com/v4"
    : "https://www.polaraccesslink.com/v3";
  const cleanPath = path.startsWith("/v4") ? path.slice(3) : path;
  const url = new URL(cleanPath, base);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!r.ok) return null;
  return r.json();
}
