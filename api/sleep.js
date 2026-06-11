import { getToken, polarGet } from "./_helpers.js";

function toMin(s) { return s != null ? Math.round(s / 60) : null; }
function decH(iso) { if (!iso) return null; const d = new Date(iso); let h = d.getHours() + d.getMinutes() / 60; if (h < 12) h += 24; return Math.round(h * 100) / 100; }
function wakeH(iso) { if (!iso) return null; const d = new Date(iso); return Math.round((d.getHours() + d.getMinutes() / 60) * 100) / 100; }

export default async function handler(req, res) {
  const t = getToken(req);
  if (!t) return res.status(401).json({ error: "Nincs bejelentkezve" });
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: "from és to szükséges" });

  let nights = [];
  const sd = await polarGet(t.token, "/users/self/sleep", { from, to });
  if (sd) {
    nights = (sd.nights || sd.sleep || []).map(n => {
      const d = (n.date || n.sleep_start_time || "").slice(0, 10); if (!d) return null;
      return { date: d, sleep_score: n.sleep_score ?? null, total_sleep_min: toMin(n.total_sleep_time ?? n.total_sleep),
        deep_sleep_min: toMin(n.deep_sleep_time ?? n.deep_sleep), light_sleep_min: toMin(n.light_sleep_time ?? n.light_sleep),
        rem_sleep_min: toMin(n.rem_sleep_time ?? n.rem_sleep), wake_during_min: toMin(n.unrecognized_sleep_time),
        bedtime_hour: decH(n.sleep_start_time), wake_hour: wakeH(n.sleep_end_time),
        sleep_efficiency: n.sleep_efficiency ?? null, continuity: n.continuity ?? null, interruptions: n.interruptions ?? null };
    }).filter(Boolean);
  }

  const recharge = {};
  const nrd = await polarGet(t.token, "/users/self/nightly-recharge", { from, to });
  if (nrd) for (const nr of (nrd["nightly-recharge"] || [])) {
    const d = (nr.date || "").slice(0, 10); if (!d) continue;
    recharge[d] = { ans_charge: nr.ans_charge ?? null, hrv_avg: nr.hrv_avg ?? null,
      breathing_rate: nr.breathing_rate_avg ?? null, resting_hr: nr.heart_rate_avg ?? null };
  }

  const rows = nights.map(n => ({ ...n, ans_charge: null, hrv_avg: null, breathing_rate: null, resting_hr: null, ...(recharge[n.date] || {}) }));
  res.json({ nights: rows });
}
