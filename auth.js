export default function handler(req, res) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.POLAR_CLIENT_ID,
    redirect_uri: `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/callback`,
    scope: "accesslink.read_all",
  });
  res.redirect(302, `https://flow.polar.com/oauth2/authorization?${params}`);
}
