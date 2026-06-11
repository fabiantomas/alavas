export default function handler(req, res) {
  const base = "https://" + req.headers.host;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.POLAR_CLIENT_ID,
    redirect_uri: base + "/api/callback",
    scope: "accesslink.read_all",
  });
  res.redirect(302, "https://flow.polar.com/oauth2/authorization?" + params);
}
