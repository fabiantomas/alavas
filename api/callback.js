export default async function handler(req, res) {
  const code = req.query.code;
  if (!code) return res.status(400).send("Nincs code");
  const base = "https://" + req.headers.host;
  try {
    const creds = Buffer.from(process.env.POLAR_CLIENT_ID + ":" + process.env.POLAR_CLIENT_SECRET).toString("base64");
    const r = await fetch("https://polarremote.com/v2/oauth2/token", {
      method: "POST",
      headers: { Authorization: "Basic " + creds, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: base + "/api/callback" }),
    });
    if (!r.ok) return res.status(r.status).send(await r.text());
    const data = await r.json();
    const token = data.access_token, userId = String(data.x_user_id || "");
    try { await fetch("https://www.polaraccesslink.com/v3/users", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ "member-id": userId }),
    }); } catch {}
    const encoded = Buffer.from(JSON.stringify({ token, userId })).toString("base64");
    res.setHeader("Set-Cookie", "polar_token=" + encoded + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000");
    res.redirect(302, "/");
  } catch (e) { res.status(500).send("Hiba: " + e.message); }
}
