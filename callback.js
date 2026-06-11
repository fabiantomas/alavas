export default async function handler(req, res) {
  const code = req.query.code;
  if (!code) return res.status(400).send("Hiányzó code paraméter");

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  try {
    const creds = Buffer.from(
      `${process.env.POLAR_CLIENT_ID}:${process.env.POLAR_CLIENT_SECRET}`
    ).toString("base64");

    const tokenRes = await fetch("https://polarremote.com/v2/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${baseUrl}/api/callback`,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(tokenRes.status).send("Token hiba: " + err);
    }

    const data = await tokenRes.json();
    const token = data.access_token;
    const userId = String(data.x_user_id || "");

    // Felhasználó regisztrálása az AccessLink-hez (idempotens)
    try {
      await fetch("https://www.polaraccesslink.com/v3/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ "member-id": userId }),
      });
    } catch {}

    // Token mentése cookie-ba (httpOnly, személyes app)
    const tokenData = JSON.stringify({ token, userId });
    const encoded = Buffer.from(tokenData).toString("base64");

    res.setHeader("Set-Cookie", [
      `polar_token=${encoded}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
    ]);
    res.redirect(302, "/");
  } catch (e) {
    res.status(500).send("Hiba: " + e.message);
  }
}
