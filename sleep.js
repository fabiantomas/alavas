import { getToken, polarGet } from "./_helpers.js";

function toMin(s) { return s != null ? Math.round(s / 60) : null; }
function decH(iso) {
  if (!iso) return null;
  const d = new Date(iso); let h = d.getHours() + d.getMinutes() / 60;
  if (h < 12) h += 24; return Math.round(h * 100) / 100;
}
function wakeH(iso) {
  if (!iso) return null;
  const d = new Date(iso); return Math.round((d.getHours() + d.getMinutes() / 60) * 100) / 100;
}

export default async function handler(req, res) {
  const t = getToken(req);
  if (!t) return res.status(401).json({ error: "Nincs bejelentkezve" });

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: "from és to szükséges" });

  const params = { from, to };
  const rows = [];

  // ── Alvás: v3 → v4 fallback ──
  let sleepData = await polarGet(t.token, "/users/self/sleep", params);
  let nights = [];

  if (sleepData) {
    nights = (sleepData.nights || sleepData.sleep || []).map(n => {
      const d = (n.date || n.sleep_start_time || "").slice(0, 10);
      if (!d) return null;
      return {
        date: d,
        sleep_score: n.sleep_score ?? null,
        total_sleep_min: toMin(n.total_sleep_time ?? n.total_sleep),
        deep_sleep_min: toMin(n.deep_sleep_time ?? n.deep_sleep),
        light_sleep_min: toMin(n.light_sleep_time ?? n.light_sleep),
        rem_sleep_min: toMin(n.rem_sleep_time ?? n.rem_sleep),
        wake_during_min: toMin(n.unrecognized_sleep_time),
        bedtime_hour: decH(n.sleep_start_time),
        wake_hour: wakeH(n.sleep_end_time),
        sleep_efficiency: n.sleep_efficiency ?? null,
        continuity: n.continuity ?? null,
        interruptions: n.interruptions ?? null,
      };
    }).filter(Boolean);
  }

  if (nights.length === 0) {
    const v4 = await polarGet(t.token, "/v4/data/sleeps", params);
    if (v4?.nightSleeps) {
      nights = v4.nightSleeps.map(n => {
        const d = n.sleepDate; if (!d) return null;
        const hyp = (n.sleepResult || {}).hypnogram || {};
        return {
          date: d, sleep_score: null,
          total_sleep_min: null, deep_sleep_min: null, light_sleep_min: null,
          rem_sleep_min: null, wake_during_min: null,
          bedtime_hour: decH(hyp.sleepStart), wake_hour: wakeH(hyp.sleepEnd),
          sleep_efficiency: null, continuity: null, interruptions: null,
        };
      }).filter(Boolean);
    }
  }

  // ── Nightly Recharge ──
  const rechargeMap = {};
  const nrd = await polarGet(t.token, "/users/self/nightly-recharge", params);
  if (nrd) {
    const list = nrd["nightly-recharge"] || [];
    for (const nr of list) {
      const d = (nr.date || nr.sleepResultDate || "").slice(0, 10);
      if (!d) continue;
      rechargeMap[d] = {
        ans_charge: nr.ans_charge ?? nr.ansStatus ?? null,
        hrv_avg: nr.hrv_avg ?? nr.meanNightlyRecoveryRmssd ?? null,
        breathing_rate: nr.breathing_rate_avg ?? null,
        resting_hr: nr.heart_rate_avg ?? null,
      };
    }
  }

  // ── Merge ──
  for (const night of nights) {
    const nr = rechargeMap[night.date];
    rows.push({ ...night, ans_charge: null, hrv_avg: null, breathing_rate: null, resting_hr: null, ...nr });
  }
  // Recharge adatok amikhez nincs sleep
  for (const [d, nr] of Object.entries(rechargeMap)) {
    if (!rows.find(r => r.date === d)) {
      rows.push({ date: d, sleep_score: null, total_sleep_min: null, deep_sleep_min: null,
        light_sleep_min: null, rem_sleep_min: null, wake_during_min: null,
        bedtime_hour: null, wake_hour: null, sleep_efficiency: null,
        continuity: null, interruptions: null, ...nr });
    }
  }

  res.json({ nights: rows.sort((a, b) => a.date.localeCompare(b.date)) });
}
