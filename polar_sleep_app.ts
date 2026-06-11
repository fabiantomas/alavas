#!/usr/bin/env npx ts-node
/**
 * ═══════════════════════════════════════════════════════
 *  POLAR SLEEP — helyi PWA
 * ═══════════════════════════════════════════════════════
 *
 *  Indítás:  npx ts-node polar_sleep_app.ts
 *  Megnyit:  http://localhost:3000
 *
 *  Egyetlen fájl: szerver + UI + Polar API + PWA manifest.
 *  A client_secret sosem kerül a böngészőbe.
 */

import * as http from "http";
import * as fs from "fs";
import * as url from "url";
import { exec } from "child_process";
import axios from "axios";

// ── Konfiguráció ──────────────────────────────────────
const CLIENT_ID     = "POLAR_CLIENT_ID_IDE";
const CLIENT_SECRET = "POLAR_CLIENT_SECRET_IDE";
const PORT          = 3000;
const REDIRECT_URI  = `http://localhost:${PORT}/callback`;
// ──────────────────────────────────────────────────────

const AUTH_URL  = "https://flow.polar.com/oauth2/authorization";
const TOKEN_URL = "https://polarremote.com/v2/oauth2/token";
const V3        = "https://www.polaraccesslink.com/v3";
const V4        = "https://www.polaraccesslink.com/v4";
const CACHE     = ".polar_token.json";

let TOKEN: string | null = null;
let USER_ID: string | null = null;

// Token betöltés ha van
if (fs.existsSync(CACHE)) {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE, "utf-8"));
    TOKEN = c.token; USER_ID = c.userId;
  } catch {}
}

// ── Polar API segéd ───────────────────────────────────
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function polarGet(path: string, params?: any): Promise<any> {
  if (!TOKEN) throw new Error("Nincs token");
  for (let i = 0; i < 3; i++) {
    try {
      const base = path.startsWith("/v4") ? "" : V3;
      const fullUrl = path.startsWith("http") ? path : (path.startsWith("/v4") ? V4 + path.slice(3) : base + path);
      const r = await axios.get(fullUrl, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
        params, timeout: 15000,
      });
      return r.data;
    } catch (e: any) {
      if (e.response?.status === 429) { await wait(10000); continue; }
      if (e.response?.status === 404) return null;
      if (i === 2) return null;
      await wait(2000);
    }
  }
  return null;
}

// ── Alvásadat parser ──────────────────────────────────
function toMin(s?: number) { return s != null ? Math.round(s / 60) : null; }
function decH(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso); let h = d.getHours() + d.getMinutes() / 60;
  if (h < 12) h += 24; return Math.round(h * 100) / 100;
}
function wakeH(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso); return Math.round((d.getHours() + d.getMinutes() / 60) * 100) / 100;
}

function parseSleep(data: any) {
  const nights = data?.nights ?? data?.sleep ?? [];
  return nights.map((n: any) => {
    const d = (n.date ?? n.sleep_start_time ?? "").slice(0, 10);
    if (!d) return null;
    return {
      date: d, sleep_score: n.sleep_score ?? null,
      total_sleep_min: toMin(n.total_sleep_time ?? n.total_sleep),
      deep_sleep_min: toMin(n.deep_sleep_time ?? n.deep_sleep),
      light_sleep_min: toMin(n.light_sleep_time ?? n.light_sleep),
      rem_sleep_min: toMin(n.rem_sleep_time ?? n.rem_sleep),
      wake_during_min: toMin(n.unrecognized_sleep_time),
      bedtime_hour: decH(n.sleep_start_time), wake_hour: wakeH(n.sleep_end_time),
      sleep_efficiency: n.sleep_efficiency ?? null,
      continuity: n.continuity ?? null, interruptions: n.interruptions ?? null,
      ans_charge: null as number | null, hrv_avg: null as number | null,
      breathing_rate: null as number | null, resting_hr: null as number | null,
    };
  }).filter(Boolean);
}

function parseRecharge(data: any) {
  const list = data?.["nightly-recharge"] ?? data?.nightlyRechargeResults?.nightlyRechargeResults ?? [];
  const m = new Map<string, any>();
  for (const nr of list) {
    const d = (nr.date ?? nr.sleepResultDate ?? "").slice(0, 10);
    if (!d) continue;
    m.set(d, {
      ans_charge: nr.ans_charge ?? nr.ansStatus ?? null,
      hrv_avg: nr.hrv_avg ?? nr.meanNightlyRecoveryRmssd ?? null,
      breathing_rate: nr.breathing_rate_avg ?? null,
      resting_hr: nr.heart_rate_avg ?? null,
    });
  }
  return m;
}

// ── Adatletöltés batchekben ───────────────────────────
async function fetchSleepData(from: string, to: string, onProgress: (pct: number, msg: string) => void) {
  const all = new Map<string, any>();
  const start = new Date(from), end = new Date(to);
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  const batchSize = 28;
  let fetched = 0;

  let cursor = new Date(from);
  while (cursor < end) {
    const bEnd = new Date(cursor); bEnd.setDate(bEnd.getDate() + batchSize);
    if (bEnd > end) bEnd.setTime(end.getTime());
    const params = { from: cursor.toISOString().split("T")[0], to: bEnd.toISOString().split("T")[0] };

    onProgress(Math.round(fetched / totalDays * 100), `${params.from} → ${params.to}`);

    // Alvás
    let nights: any[] = [];
    const sd = await polarGet("/users/self/sleep", params);
    if (sd) nights = parseSleep(sd);
    if (nights.length === 0) {
      const sd4 = await polarGet(`/v4/data/sleeps`, params);
      if (sd4) {
        const n4 = sd4?.nightSleeps ?? [];
        nights = n4.map((n: any) => {
          const d = n.sleepDate; if (!d) return null;
          const hyp = (n.sleepResult ?? {}).hypnogram ?? {};
          return { date: d, sleep_score: null, total_sleep_min: null, deep_sleep_min: null,
            light_sleep_min: null, rem_sleep_min: null, wake_during_min: null,
            bedtime_hour: decH(hyp.sleepStart), wake_hour: wakeH(hyp.sleepEnd),
            sleep_efficiency: null, continuity: null, interruptions: null,
            ans_charge: null, hrv_avg: null, breathing_rate: null, resting_hr: null };
        }).filter(Boolean);
      }
    }

    // Recharge
    const nrd = await polarGet("/users/self/nightly-recharge", params);
    const recharge = nrd ? parseRecharge(nrd) : new Map();

    for (const night of nights) {
      const nr = recharge.get(night.date);
      if (nr) Object.assign(night, nr);
      all.set(night.date, { ...(all.get(night.date) ?? {}), ...night });
    }
    for (const [d, nr] of recharge) {
      if (!all.has(d)) all.set(d, { date: d, sleep_score: null, total_sleep_min: null,
        deep_sleep_min: null, light_sleep_min: null, rem_sleep_min: null, wake_during_min: null,
        bedtime_hour: null, wake_hour: null, sleep_efficiency: null, continuity: null,
        interruptions: null, ...nr });
    }

    fetched += batchSize;
    cursor = new Date(bEnd); cursor.setDate(cursor.getDate() + 1);
    await wait(1500);
  }

  onProgress(100, "Kész!");
  return [...all.values()].sort((a: any, b: any) => a.date.localeCompare(b.date));
}

// ── HTTP szerver ───────────────────────────────────────
let downloadProgress = { pct: 0, msg: "", done: false, data: null as any[] | null };

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url!, true);
  const path = parsed.pathname!;
  const q = parsed.query;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");

  // ── Statikus ────────────────────────────────────────
  if (path === "/" || path === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML); return;
  }

  if (path === "/manifest.json") {
    res.writeHead(200, { "Content-Type": "application/manifest+json" });
    res.end(JSON.stringify({
      name: "Polar Sleep", short_name: "Sleep", start_url: "/",
      display: "standalone", background_color: "#ffffff", theme_color: "#185FA5",
      icons: [{ src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌙</text></svg>", sizes: "any", type: "image/svg+xml" }],
    })); return;
  }

  if (path === "/sw.js") {
    res.writeHead(200, { "Content-Type": "application/javascript" });
    res.end("self.addEventListener('fetch', e => e.respondWith(fetch(e.request)));"); return;
  }

  // ── Auth ────────────────────────────────────────────
  if (path === "/auth") {
    const p = new URLSearchParams({
      response_type: "code", client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI, scope: "accesslink.read_all",
    });
    res.writeHead(302, { Location: `${AUTH_URL}?${p}` }); res.end(); return;
  }

  if (path === "/callback") {
    const code = q.code as string;
    if (!code) { res.writeHead(400); res.end("Nincs code"); return; }
    try {
      const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
      const r = await axios.post(TOKEN_URL,
        new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI }),
        { headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" } });
      TOKEN = r.data.access_token; USER_ID = String(r.data.x_user_id);
      fs.writeFileSync(CACHE, JSON.stringify({ token: TOKEN, userId: USER_ID }));
      // Regisztráció
      try { await axios.post(`${V3}/users`, { "member-id": USER_ID },
        { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } }); } catch {}
      res.writeHead(302, { Location: "/" }); res.end();
    } catch (e: any) {
      res.writeHead(500); res.end("Auth hiba: " + (e.response?.data ?? e.message));
    }
    return;
  }

  // ── API ─────────────────────────────────────────────
  if (path === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ connected: !!TOKEN, userId: USER_ID })); return;
  }

  if (path === "/api/fetch") {
    if (!TOKEN) { res.writeHead(401); res.end("Nincs token"); return; }
    const from = q.from as string; const to = q.to as string;
    if (!from || !to) { res.writeHead(400); res.end("from és to szükséges"); return; }

    downloadProgress = { pct: 0, msg: "Indítás...", done: false, data: null };
    fetchSleepData(from, to, (pct, msg) => {
      downloadProgress.pct = pct; downloadProgress.msg = msg;
    }).then(data => {
      downloadProgress.done = true; downloadProgress.data = data;
    }).catch(e => {
      downloadProgress.done = true; downloadProgress.msg = "Hiba: " + e.message;
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ started: true })); return;
  }

  if (path === "/api/progress") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(downloadProgress)); return;
  }

  if (path === "/api/data") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(downloadProgress.data ?? [])); return;
  }

  res.writeHead(404); res.end("404");
});

server.listen(PORT, () => {
  console.log(`\n  🌙 Polar Sleep → http://localhost:${PORT}\n`);
  const cmd = process.platform === "win32" ? `start http://localhost:${PORT}`
    : process.platform === "darwin" ? `open http://localhost:${PORT}`
    : `xdg-open http://localhost:${PORT}`;
  exec(cmd);
});

// ═══════════════════════════════════════════════════════
//  FRONTEND HTML
// ═══════════════════════════════════════════════════════

const HTML = `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#185FA5">
<link rel="manifest" href="/manifest.json">
<title>Polar Sleep</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8f8f6;color:#1a1a1a;line-height:1.6}
.wrap{max-width:720px;margin:0 auto;padding:24px 20px}
h1{font-size:22px;font-weight:500;margin-bottom:4px}
.sub{font-size:14px;color:#666;margin-bottom:32px}
.card{background:#fff;border:1px solid #e5e5e3;border-radius:12px;padding:20px 24px;margin-bottom:16px}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
label{font-size:13px;color:#666}
input[type=date]{font-size:14px;padding:8px 12px;border:1px solid #ddd;border-radius:8px;background:#fff}
button{font-size:14px;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;font-weight:500;transition:all .15s}
.btn-primary{background:#185FA5;color:#fff}
.btn-primary:hover{background:#0C447C}
.btn-primary:disabled{background:#aaa;cursor:not-allowed}
.btn-outline{background:none;border:1px solid #ddd;color:#333}
.btn-outline:hover{background:#f0f0ee}
.btn-connect{background:#E24B4A;color:#fff}
.btn-connect:hover{background:#A32D2D}
.progress-wrap{margin:16px 0}
.progress-bar{height:6px;background:#e5e5e3;border-radius:3px;overflow:hidden}
.progress-fill{height:100%;background:#185FA5;border-radius:3px;transition:width .3s}
.progress-text{font-size:12px;color:#888;margin-top:6px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:16px 0}
.stat{background:#f4f4f2;border-radius:8px;padding:12px}
.stat-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.04em}
.stat-val{font-size:20px;font-weight:500;margin-top:2px}
.stat-sub{font-size:11px;color:#999;margin-top:1px}
.status{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:4px 12px;border-radius:20px}
.status-on{background:#eaf3de;color:#3B6D11}
.status-off{background:#fcebeb;color:#A32D2D}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.dot-on{background:#3B6D11}.dot-off{background:#A32D2D}
.export-row{display:flex;gap:8px;margin-top:12px}
.chart-wrap{position:relative;height:220px;margin:12px 0}
.hidden{display:none}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
th{text-align:left;padding:8px 6px;border-bottom:1px solid #e5e5e3;font-weight:500;color:#666;font-size:11px;text-transform:uppercase}
td{padding:6px;border-bottom:1px solid #f0f0ee}
.scroll-x{overflow-x:auto}
.tab-row{display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap}
.tab{padding:6px 14px;font-size:13px;border:1px solid #ddd;border-radius:8px;background:none;cursor:pointer;color:#666}
.tab.on{background:#185FA5;color:#fff;border-color:#185FA5}
</style>
</head>
<body>
<div class="wrap">
  <h1>🌙 Polar Sleep</h1>
  <p class="sub">Alvásadatok letöltése és exportálása</p>

  <div class="card" id="auth-card">
    <div class="row" style="justify-content:space-between">
      <div>
        <div style="font-size:15px;font-weight:500">Polar fiók</div>
        <div id="auth-status" style="margin-top:6px"></div>
      </div>
      <button id="auth-btn" class="btn-connect" onclick="location.href='/auth'">Csatlakozás</button>
    </div>
  </div>

  <div class="card" id="fetch-card">
    <div style="font-size:15px;font-weight:500;margin-bottom:12px">Időszak kiválasztása</div>
    <div class="row">
      <div><label>Kezdő dátum</label><br><input type="date" id="from"></div>
      <div><label>Végdátum</label><br><input type="date" id="to"></div>
      <button class="btn-primary" id="fetch-btn" onclick="startFetch()" disabled>Letöltés</button>
    </div>
    <div class="row" style="margin-top:8px;gap:6px">
      <button class="btn-outline" onclick="setRange(30)">30 nap</button>
      <button class="btn-outline" onclick="setRange(90)">90 nap</button>
      <button class="btn-outline" onclick="setRange(180)">180 nap</button>
      <button class="btn-outline" onclick="setRange(365)">1 év</button>
    </div>
    <div class="progress-wrap hidden" id="progress">
      <div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>
      <div class="progress-text" id="progress-text">Indítás...</div>
    </div>
  </div>

  <div class="hidden" id="results">
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div style="font-size:15px;font-weight:500" id="result-title">Eredmények</div>
        <div class="export-row">
          <button class="btn-outline" onclick="exportCSV()">CSV</button>
          <button class="btn-outline" onclick="exportJSON()">JSON</button>
        </div>
      </div>
      <div class="stats" id="stats"></div>
    </div>

    <div class="card">
      <div class="tab-row">
        <button class="tab on" onclick="showTab(0,this)">Alváspontszám</button>
        <button class="tab" onclick="showTab(1,this)">Fázisok</button>
        <button class="tab" onclick="showTab(2,this)">Időzítés</button>
        <button class="tab" onclick="showTab(3,this)">HRV és pulzus</button>
      </div>
      <div class="chart-wrap"><canvas id="ch0"></canvas></div>
      <div class="chart-wrap hidden"><canvas id="ch1"></canvas></div>
      <div class="chart-wrap hidden"><canvas id="ch2"></canvas></div>
      <div class="chart-wrap hidden"><canvas id="ch3"></canvas></div>
    </div>

    <div class="card">
      <div style="font-size:15px;font-weight:500;margin-bottom:8px">Napi adatok</div>
      <div class="scroll-x">
        <table id="data-table"><thead></thead><tbody></tbody></table>
      </div>
    </div>
  </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<script>
let DATA=[];let CHARTS=[];

async function init(){
  const r=await fetch('/api/status').then(r=>r.json());
  const el=document.getElementById('auth-status');
  const btn=document.getElementById('auth-btn');
  if(r.connected){
    el.innerHTML='<span class="status status-on"><span class="dot dot-on"></span>Csatlakoztatva</span>';
    btn.textContent='Újracsatlakozás';btn.className='btn-outline';
    document.getElementById('fetch-btn').disabled=false;
  }else{
    el.innerHTML='<span class="status status-off"><span class="dot dot-off"></span>Nincs csatlakoztatva</span>';
    btn.className='btn-connect';
  }
  setRange(365);
}

function setRange(days){
  const to=new Date();const from=new Date();from.setDate(to.getDate()-days);
  document.getElementById('from').value=from.toISOString().slice(0,10);
  document.getElementById('to').value=to.toISOString().slice(0,10);
}

async function startFetch(){
  const from=document.getElementById('from').value;
  const to=document.getElementById('to').value;
  if(!from||!to)return;
  document.getElementById('fetch-btn').disabled=true;
  document.getElementById('progress').classList.remove('hidden');
  document.getElementById('results').classList.add('hidden');

  await fetch('/api/fetch?from='+from+'&to='+to);
  const poll=setInterval(async()=>{
    const p=await fetch('/api/progress').then(r=>r.json());
    document.getElementById('progress-fill').style.width=p.pct+'%';
    document.getElementById('progress-text').textContent=p.pct+'% — '+p.msg;
    if(p.done){
      clearInterval(poll);
      DATA=await fetch('/api/data').then(r=>r.json());
      document.getElementById('fetch-btn').disabled=false;
      if(DATA.length>0)showResults();
      else document.getElementById('progress-text').textContent='Nem érkezett adat. Próbáld újracsatlakoztatni a Polar fiókot.';
    }
  },1500);
}

function avg(arr){const v=arr.filter(x=>x!=null);return v.length?Math.round(v.reduce((a,b)=>a+b)/v.length*10)/10:null}
function fmtH(h){if(h==null)return'–';const hh=h>=24?h-24:h;return Math.floor(hh)+':'+(Math.round((hh%1)*60)+'').padStart(2,'0')}

function showResults(){
  document.getElementById('results').classList.remove('hidden');
  document.getElementById('result-title').textContent=DATA.length+' éjszaka ('+DATA[0].date+' → '+DATA[DATA.length-1].date+')';

  const s=document.getElementById('stats');
  const metrics=[
    ['Alváspontszám',avg(DATA.map(d=>d.sleep_score)),'/ 100'],
    ['Alvásidő',avg(DATA.map(d=>d.total_sleep_min)),'perc'],
    ['Mély alvás',avg(DATA.map(d=>d.deep_sleep_min)),'perc'],
    ['REM',avg(DATA.map(d=>d.rem_sleep_min)),'perc'],
    ['HRV',avg(DATA.map(d=>d.hrv_avg)),'ms'],
    ['ANS charge',avg(DATA.map(d=>d.ans_charge)),''],
    ['Lefekvés',fmtH(avg(DATA.map(d=>d.bedtime_hour))),''],
    ['Ébredés',fmtH(avg(DATA.map(d=>d.wake_hour))),''],
  ];
  s.innerHTML=metrics.map(([l,v,u])=>'<div class="stat"><div class="stat-label">'+l+'</div><div class="stat-val">'+(v??'–')+'</div><div class="stat-sub">'+u+'</div></div>').join('');

  drawCharts();
  drawTable();
}

function showTab(idx,btn){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  btn.classList.add('on');
  document.querySelectorAll('.chart-wrap').forEach((c,i)=>{c.classList.toggle('hidden',i!==idx)});
}

function drawCharts(){
  CHARTS.forEach(c=>c.destroy());CHARTS=[];
  const labels=DATA.map(d=>d.date.slice(5));
  const opt={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
    scales:{x:{ticks:{autoSkip:true,maxTicksLimit:15,maxRotation:45}},y:{beginAtZero:false}}};

  CHARTS.push(new Chart(document.getElementById('ch0'),{type:'line',data:{labels,datasets:[
    {label:'Alváspontszám',data:DATA.map(d=>d.sleep_score),borderColor:'#185FA5',tension:.3,pointRadius:0,borderWidth:1.5,spanGaps:true}
  ]},options:opt}));

  CHARTS.push(new Chart(document.getElementById('ch1'),{type:'bar',data:{labels,datasets:[
    {label:'Mély',data:DATA.map(d=>d.deep_sleep_min),backgroundColor:'#185FA5',borderRadius:1},
    {label:'REM',data:DATA.map(d=>d.rem_sleep_min),backgroundColor:'#534AB7',borderRadius:1},
    {label:'Könnyű',data:DATA.map(d=>d.light_sleep_min),backgroundColor:'rgba(24,95,165,.2)',borderRadius:1},
  ]},options:{...opt,scales:{...opt.scales,x:{...opt.scales.x,stacked:true},y:{stacked:true,beginAtZero:true}}}}));

  CHARTS.push(new Chart(document.getElementById('ch2'),{type:'line',data:{labels,datasets:[
    {label:'Lefekvés',data:DATA.map(d=>d.bedtime_hour),borderColor:'#534AB7',tension:.3,pointRadius:0,borderWidth:1.5,spanGaps:true},
    {label:'Ébredés',data:DATA.map(d=>d.wake_hour),borderColor:'#BA7517',tension:.3,pointRadius:0,borderWidth:1.5,spanGaps:true},
  ]},options:{...opt,scales:{...opt.scales,y:{...opt.scales.y,ticks:{callback:v=>fmtH(v)}}}}}));

  CHARTS.push(new Chart(document.getElementById('ch3'),{type:'line',data:{labels,datasets:[
    {label:'HRV',data:DATA.map(d=>d.hrv_avg),borderColor:'#0F6E56',tension:.3,pointRadius:0,borderWidth:1.5,spanGaps:true},
    {label:'Nyugalmi pulzus',data:DATA.map(d=>d.resting_hr),borderColor:'#A32D2D',tension:.3,pointRadius:0,borderWidth:1.5,spanGaps:true,borderDash:[4,3]},
  ]},options:opt}));
}

function drawTable(){
  const cols=['date','sleep_score','total_sleep_min','deep_sleep_min','rem_sleep_min','hrv_avg','ans_charge','resting_hr'];
  const names=['Dátum','Pont','Alvás','Mély','REM','HRV','ANS','Pulzus'];
  const thead=document.querySelector('#data-table thead');
  const tbody=document.querySelector('#data-table tbody');
  thead.innerHTML='<tr>'+names.map(n=>'<th>'+n+'</th>').join('')+'</tr>';
  tbody.innerHTML=DATA.slice().reverse().slice(0,60).map(r=>'<tr>'+cols.map(c=>'<td>'+(r[c]??'–')+'</td>').join('')+'</tr>').join('');
}

function exportCSV(){
  const cols=Object.keys(DATA[0]);
  const csv=[cols.join(','),...DATA.map(r=>cols.map(c=>{const v=String(r[c]??'');return v.includes(',')?'"'+v+'"':v}).join(','))].join('\\n');
  dl(csv,'polar_sleep.csv','text/csv');
}
function exportJSON(){dl(JSON.stringify(DATA,null,2),'polar_sleep.json','application/json')}
function dl(content,name,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click()}

if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');
init();
</script>
</body></html>`;
