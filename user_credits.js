// user_credits.js — Recarga de créditos (USD/MXN) con PayPal (API/IPN con modal) + Stripe (tarjeta)
// Móntalo con: app.use('/', require('./user_credits'));
"use strict";

const express = require("express");
const db = require("./db");
const qs = require("querystring");
const https = require("https");
const Stripe = require("stripe"); // Stripe SDK

const router = express.Router();

/* ========== helpers ========== */
function ensureAuth(req,res,next){
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}
function esc(s){
  return String(s==null?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}
function round2(n){ return Math.round((Number(n)||0)*100)/100; }
function baseUrl(req){
  const proto = (req.headers["x-forwarded-proto"]||req.protocol||"http").split(",")[0];
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}
function getPPEnv(){
  const live = db.getSetting("paypal_api_mode","sandbox")==="live";
  return {
    live,
    clientId: db.getSetting("paypal_api_client_id",""),
    secret: db.getSetting("paypal_api_secret",""),
    apiHost: live ? "api-m.paypal.com" : "api-m.sandbox.paypal.com",
  };
}

/* ====== Stripe helper (flexible, sin romper PayPal) ====== */
// Busca la clave en DB y en variables de entorno, soportando varios nombres comunes.
// Si existe, instancia Stripe; si no, devuelve null (para mostrar el mensaje “no configurado”).
function getStripe(){
  // modo opcional
  const modePref = (db.getSetting("stripe_mode","") || process.env.STRIPE_MODE || "").toLowerCase();

  // candidatos en DB (se toma el primero que esté presente)
  const dbCandidates = [
    "stripe_secret_key",
    modePref==="live" ? "stripe_live_secret" : "",
    modePref==="test" ? "stripe_test_secret" : "",
    "stripe_api_secret",
    "stripe_secret",
    "stripe_sk"
  ].map(k => k ? (db.getSetting(k,"") || "").trim() : "").filter(Boolean);

  // candidatos en ENV
  const envCandidates = [
    process.env.STRIPE_SECRET_KEY,
    process.env.STRIPE_API_KEY,
    process.env.STRIPE_SK,
    process.env.STRIPE_LIVE_SECRET,
    process.env.STRIPE_TEST_SECRET
  ].map(v => (v || "").trim()).filter(Boolean);

  const sk = (dbCandidates[0] || envCandidates[0] || "").trim();

  // no bloqueamos por prefijo; Stripe puede rotar formatos.
  return sk ? new Stripe(sk, { apiVersion: "2024-06-20" }) : null;
}

/* ====== PayPal API helpers (auth / create / capture) ====== */
function ppAuthToken(){
  const { clientId, secret, apiHost } = getPPEnv();
  const auth = Buffer.from(clientId + ":" + secret).toString("base64");
  return new Promise((resolve,reject)=>{
    const body = "grant_type=client_credentials";
    const req = https.request({
      host: apiHost,
      method: "POST",
      path: "/v1/oauth2/token",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        "Authorization":"Basic " + auth,
        "Content-Length": Buffer.byteLength(body)
      }
    }, res=>{
      let data=""; res.on("data",c=>data+=c);
      res.on("end", ()=>{
        try{ resolve(JSON.parse(data).access_token || ""); }catch(e){ reject(e); }
      });
    });
    req.on("error", reject); req.write(body); req.end();
  });
}
async function ppCreateOrder(topup, returnUrl, cancelUrl){
  const { apiHost } = getPPEnv();
  const token = await ppAuthToken();
  const payload = JSON.stringify({
    intent: "CAPTURE",
    purchase_units:[
      {
        amount:{ currency_code: topup.currency, value: Number(topup.amount).toFixed(2) },
        custom_id: "TOPUP-"+topup.id
      }
    ],
    application_context:{
      return_url: returnUrl,
      cancel_url: cancelUrl,
      brand_name: db.getSetting("site_name","SkyShop"),
      user_action: "PAY_NOW"
    }
  });
  return new Promise((resolve,reject)=>{
    const req = https.request({
      host: apiHost,
      method: "POST",
      path: "/v2/checkout/orders",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer " + token,
        "Content-Length": Buffer.byteLength(payload)
      }
    }, res=>{
      let data=""; res.on("data",c=>data+=c);
      res.on("end", ()=>{
        try{
          const j = JSON.parse(data);
          const approve = (j.links||[]).find(l=>l.rel==="approve")?.href;
          if (!approve) return reject(new Error("No approve link"));
          resolve({ id:j.id, approve });
        }catch(e){ reject(e); }
      });
    });
    req.on("error", reject); req.write(payload); req.end();
  });
}
async function ppCaptureOrder(orderId){
  const { apiHost } = getPPEnv();
  const token = await ppAuthToken();
  return new Promise((resolve,reject)=>{
    const req = https.request({
      host: apiHost,
      method: "POST",
      path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer " + token
      }
    }, res=>{
      let data=""; res.on("data",c=>data+=c);
      res.on("end", ()=>{
        try{ resolve(JSON.parse(data)); }catch(e){ reject(e); }
      });
    });
    req.on("error", reject); req.end();
  });
}

/* ========== esquema topups (no factura) ========== */
db.prepare(`
  CREATE TABLE IF NOT EXISTS credit_topups(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    currency TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'paid' | 'canceled'
    provider TEXT,
    provider_ref TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    paid_at TEXT,
    meta_json TEXT
  )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS credit_topups_user ON credit_topups(user_id)`).run();
db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS credit_topups_provider_ref ON credit_topups(provider, provider_ref)`).run();

/* ========== UI shared (estilos + top con quick + avatar + drawer) ========== */
function sharedHead(site){
  return `
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(site)} · Comprar créditos</title>
<style>
  :root{
    --bg:#0b1220; --txt:#e5e7eb; --muted:#9ca3af; --card:#111827; --line:#ffffff22;
    --accent:#2563eb; --ok:#16a34a; --danger:#ef4444;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt)}
  body.light{background:#fff;color:#0b1220}
  .wrap{max-width:1100px;margin:0 auto;padding:18px}

  .top{position:sticky;top:0;z-index:6;backdrop-filter:blur(8px);
       background:linear-gradient(#0b1220cc,#0b1220aa);border-bottom:1px solid var(--line)}
  body.light .top{background:linear-gradient(#fff8,#fff6)}
  .nav{max-width:1100px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px}
  .brand{display:flex;align-items:center;gap:10px}
  .brand img{width:36px;height:36px;border-radius:8px;object-fit:cover}
  .brand-name{font-weight:900;letter-spacing:.2px;font-size:18px;
    background:linear-gradient(90deg,#ffffff,#ef4444);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
  body.light .brand-name{background:linear-gradient(90deg,#111,#ef4444);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
  .quick{display:flex;gap:8px;margin-left:6px}
  .qbtn{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;text-decoration:none;font-weight:700;
        background:linear-gradient(90deg,#f43f5e,#fb7185);color:#fff;border:1px solid #ffffff22}
  .qbtn svg{width:16px;height:16px}

  .grow{flex:1}
  .pill{padding:8px 10px;border-radius:999px;background:#ffffff18;border:1px solid #ffffff28;color:inherit;text-decoration:none;cursor:pointer}
  body.light .pill{background:#00000010;border-color:#00000018}

  .avatar{ width:32px; height:32px; border-radius:50%; background:#64748b; color:#fff; display:grid; place-items:center; font-weight:700; overflow:hidden }
  .avatar img{width:100%;height:100%;object-fit:cover;display:block}
  .udock{position:relative;display:flex;gap:8px;align-items:center}
  .udrop{ position:absolute; right:0; top:42px; background:var(--card); border:1px solid var(--line); border-radius:12px;
          padding:10px; width:230px; box-shadow:0 10px 30px #0007; display:none; z-index:8 }
  body.light .udrop{ background:#fff }
  .udrop a{ display:block; padding:8px 10px; border-radius:8px; color:inherit; text-decoration:none }
  .udrop a:hover{ background:#ffffff12 } body.light .udrop a:hover{ background:#0000000a }

  .drawer{position:fixed;inset:0 auto 0 0;width:300px;transform:translateX(-100%);transition:transform .22s ease;z-index:7}
  .drawer.open{transform:none}
  .drawer .panel{height:100%;background:rgba(17,25,40,.85);backdrop-filter:blur(10px);border-right:1px solid var(--line);padding:14px}
  body.light .drawer .panel{background:#fff}
  .scrim{position:fixed;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(1px);opacity:0;visibility:hidden;transition:.18s ease;z-index:6}
  .scrim.show{opacity:1;visibility:visible}
  .navlist a{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #334155;border-radius:10px;margin-bottom:8px;color:inherit;text-decoration:none}
  .navlist a:hover{border-color:#64748b}
  .navlist svg{width:18px;height:18px;opacity:.95}

  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
  body.light .card{background:#fff;border-color:#00000018}
  .muted{color:var(--muted)}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .input, select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:inherit}
  body.light .input, body.light select{background:#fff;border-color:#00000022;color:inherit}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media(max-width:720px){ .grid{grid-template-columns:1fr} }
  .quickchips{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .chip{padding:6px 10px;border-radius:999px;border:1px solid var(--line);cursor:pointer}

  .paygrid{display:flex;gap:10px;flex-wrap:wrap}
  .paybtn{display:inline-flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);
          text-decoration:none;cursor:pointer;font-weight:800}
  .paybtn svg{width:20px;height:20px}
  .paybtn.paypal{background:#003087;color:#fff;border-color:#00226b}
  .paybtn.paypal:hover{filter:brightness(1.05)}
  .paybtn.stripe{background:#635bff;color:#fff;border-color:#4e48e0}
  .paybtn.stripe:hover{filter:brightness(1.05)}

  .modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;place-items:center;z-index:30}
  .modal.show{display:grid}
  .panel{background:#0b1325;border:1px solid #ffffff22;border-radius:16px;max-width:520px;width:92%;padding:14px}
  body.light .panel{background:#fff;border-color:#00000018}
  .opt{display:flex;align-items:center;gap:10px;border:1px solid #ffffff22;border-radius:12px;padding:12px;margin:8px 0;cursor:pointer;background:#0f172a}
  body.light .opt{background:#f8fafc;border-color:#00000018}
</style>`;
}
function drawerHtml(isAdmin){
  return `
  <div class="drawer" id="drawer">
    <div class="panel">
      <h3 style="margin:0 0 10px">Menú</h3>
      <nav class="navlist">
        <a href="/"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3 1 8h2v5h4V9h2v4h4V8h2L8 3z"/></svg>Inicio</a>
        <a href="/invoices"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>Mis facturas</a>
        <a href="/services"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0  0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>Mis servicios</a>
        <a href="/tickets"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5a2 2 0  0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0-1 1 1 1 0 0 0 1 1v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a1 1 0 0 0 1-1 1 1 0 0 0-1-1V5Z"/></svg>Soporte</a>
        <a href="/profile"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0  1 0 0-6 3 3 0  0 0 0 6Zm-5 7v-1a5 5 0  0 1 10 0v1H3z"/></svg>Mi perfil</a>
        ${isAdmin ? `<a href="/admin"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M7 1h2l1 3h3l-2 2 1 3-3-1-2 2-2-2-3 1 1-3L1 4h3l1-3z"/></svg>Admin</a>` : ``}
        <a href="/logout"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h3v2H6v8h3v2H4V2h2zm7 6-3-3v2H7v2h3v2l3-3z"/></svg>Salir</a>
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>`;
}
function topBar(site, logo, u){
  const avatarUrl = (u.avatar_url || "").trim();
  const avatarLetter = String(u.name||"?").charAt(0).toUpperCase();
  const avatarHtml = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="avatar">` : `${esc(avatarLetter)}`;
  const isAdmin = !!u.is_admin;

  return `
  <header class="top">
    <nav class="nav">
      <button id="menuBtn" class="burger" aria-label="Abrir menú"><span></span></button>
      <div class="brand">
        ${logo?`<img src="${esc(logo)}" alt="logo">`:``}
        <div class="brand-name">${esc(site)}</div>
        <div class="quick">
          <a class="qbtn" href="/"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3 1 8h2v5h4V9h2v4h4V8h2L8 3z"/></svg>Inicio</a>
          <a class="qbtn" href="/invoices"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>Facturas</a>
          <a class="qbtn" href="/services"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0  0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>Servicios</a>
        </div>
      </div>
      <div class="grow"></div>
      <button id="mode" class="pill" type="button">🌙</button>

      <div id="ua" class="pill udock">
        <div class="avatar">${avatarHtml}</div>
        <span>${esc(u.username||"")}</span>
        <div id="udrop" class="udrop">
          <div style="padding:6px 8px; font-weight:700">${esc(u.name||"")} ${esc(u.surname||"")}</div>
          <a href="/profile">Mi perfil</a>
          <a href="/invoices">Mis facturas</a>
          <a href="/services">Mis servicios</a>
          <a href="/tickets">Tickets</a>
          ${isAdmin ? `<a href="/admin">Administración</a>` : ``}
          <a href="/logout">Salir</a>
        </div>
      </div>
    </nav>
  </header>`;
}
function sharedTopJs(){
  return `
<script>
  (function(){
    // Drawer
    const drawer=document.getElementById('drawer');
    const scrim=document.getElementById('scrim');
    const btn=document.getElementById('menuBtn');
    function open(){drawer.classList.add('open');scrim.classList.add('show');}
    function close(){drawer.classList.remove('open');scrim.classList.remove('show');}
    btn?.addEventListener('click',open); scrim?.addEventListener('click',close);
    window.addEventListener('keydown',e=>{ if(e.key==='Escape') close(); });

    // Tema
    const mbtn=document.getElementById('mode');
    function apply(m){ const light=(m==='light'); document.body.classList.toggle('light',light); mbtn.textContent=light?'☀️':'🌙'; localStorage.setItem('ui:mode',light?'light':'dark'); }
    apply(localStorage.getItem('ui:mode')||'dark');
    mbtn?.addEventListener('click', ()=>apply(document.body.classList.contains('light')?'dark':'light'));

    // User dropdown
    (function(){
      const a=document.getElementById('ua'); const d=document.getElementById('udrop');
      let open=false;
      a?.addEventListener('click',(e)=>{ e.stopPropagation(); open=!open; d.style.display=open?'block':'none'; });
      document.addEventListener('click',()=>{ if(open){ open=false; d.style.display='none'; }});
    })();
  })();
</script>`;
}

/* ========== Página UI: elegir moneda/monto + PayPal modal + Stripe ========== */
router.get("/comprar-creditos", ensureAuth, (req,res)=>{
  const site = db.getSetting("site_name","SkyShop");
  const logo = db.getSetting("logo_url","");
  const u = req.session.user;

  const qCurrency = String(req.query.currency||"").toUpperCase();
  const sel = (qCurrency==="USD" || qCurrency==="MXN") ? qCurrency : "USD";

  const balUSD = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='USD'`).get(u.id)?.balance || 0;
  const balMXN = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='MXN'`).get(u.id)?.balance || 0;

  // PayPal flags/URLs
  const ppApiEnabled = db.getSetting("paypal_api_enabled","0")==="1"
                    && !!db.getSetting("paypal_api_client_id","")
                    && !!db.getSetting("paypal_api_secret","");
  const ppIpnEnabled = db.getSetting("paypal_ipn_enabled","0")==="1"
                    && !!db.getSetting("paypal_ipn_email","");
  const ppEmail   = db.getSetting("paypal_ipn_email","");
  const ppModeLive = db.getSetting("paypal_api_mode","sandbox")==="live";
  const webscr = ppModeLive
    ? "https://www.paypal.com/cgi-bin/webscr"
    : "https://www.sandbox.paypal.com/cgi-bin/webscr";

  const base = baseUrl(req);
  const notify = `${base}/comprar-creditos/paypal/ipn`;

  res.type("html").send(`<!doctype html>
<html lang="es">
${sharedHead(site)}
<body>
  ${topBar(site, logo, u)}
  ${drawerHtml(!!u.is_admin)}
  <main class="wrap">
    <section class="card">
      <h2 style="margin:0 0 6px">Comprar créditos</h2>
      <p class="muted">Elige moneda y monto. No se genera factura; se abona directo a tu saldo.</p>

      <form id="f">
        <div class="grid">
          <div>
            <div class="muted">Moneda</div>
            <select name="currency" class="input" id="curSel">
              <option value="USD"${sel==='USD'?' selected':''}>USD (Saldo: $ ${Number(balUSD).toFixed(2)})</option>
              <option value="MXN"${sel==='MXN'?' selected':''}>MXN (Saldo: MXN ${Number(balMXN).toFixed(2)})</option>
            </select>
          </div>
          <div>
            <div class="muted">Monto</div>
            <input class="input" name="amount" id="amount" type="number" step="0.01" min="0.01" placeholder="0.00" required>
            <div class="quickchips" id="quick"></div>
          </div>
        </div>

        <div class="row" style="margin-top:14px">
          <a class="pill" href="/">← Volver</a>
          <button class="pill" type="reset">Limpiar</button>

          <!-- PayPal abre modal (o elige automático si solo hay uno activo) -->
          <button id="paypalBtn" class="paybtn paypal" type="button" title="Pagar con PayPal">
            ${paypalIcon()} PayPal
          </button>

          <!-- Stripe tarjeta (POST seguro) -->
          <button id="stripeBtn" class="paybtn stripe" type="button" title="Pagar con tarjeta">
            ${stripeIcon()} Stripe (tarjeta)
          </button>
        </div>
      </form>

      ${(!ppApiEnabled && !ppIpnEnabled) ? `<div class="muted" style="margin-top:6px">PayPal no está configurado por el administrador.</div>` : ``}
    </section>
  </main>

  <!-- PayPal API (se envía con el topup_id) -->
  <form id="ppApiForm" method="post" action="/comprar-creditos/paypal/api/create" style="display:none">
    <input type="hidden" name="topup_id" value="">
  </form>

  <!-- PayPal IPN (webscr directo) -->
  <form id="ppIpnForm" method="post" action="${webscr}" style="display:none">
    <input type="hidden" name="cmd" value="_xclick">
    <input type="hidden" name="business" value="${esc(ppEmail)}">
    <input type="hidden" name="item_name" value="Recarga de créditos">
    <input type="hidden" name="amount" value="">
    <input type="hidden" name="currency_code" value="">
    <input type="hidden" name="invoice" value="">
    <input type="hidden" name="custom" value="">
    <input type="hidden" name="notify_url" value="${notify}">
    <input type="hidden" name="return" value="">
    <input type="hidden" name="cancel_return" value="">
    <input type="hidden" name="no_shipping" value="1">
    <input type="hidden" name="rm" value="1">
  </form>

  <!-- Stripe (POST -> crea sesión de Checkout) -->
  <form id="stripeForm" method="post" action="/comprar-creditos/stripe/start" style="display:none">
    <input type="hidden" name="topup_id" value="">
  </form>

  <!-- Modal selector PayPal -->
  <div id="ppModal" class="modal" aria-hidden="true">
    <div class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px">
        <h3 style="margin:0">Elige cómo pagar con PayPal</h3>
        <button id="ppClose" class="pill" type="button">✕</button>
      </div>
      ${ppApiEnabled ? `
        <div class="opt" id="ppOptApi">
          ${paypalIcon()} <div><b>PayPal (API / Checkout)</b><br><small>Redirección a PayPal y confirmación automática.</small></div>
        </div>` : ``}
      ${ppIpnEnabled ? `
        <div class="opt" id="ppOptIpn">
          ${paypalIcon()} <div><b>PayPal por correo (IPN)</b><br><small>Pago directo al correo ${esc(ppEmail)}.</small></div>
        </div>` : ``}
      ${(!ppApiEnabled && !ppIpnEnabled) ? `<div class="muted">PayPal no está disponible.</div>` : ``}
    </div>
  </div>

${sharedTopJs()}
<script>
  (function(){
    const cur = document.getElementById('curSel');
    const quick = document.getElementById('quick');
    const amount = document.getElementById('amount');
    const form = document.getElementById('f');

    const paypalBtn = document.getElementById('paypalBtn');
    const stripeBtn = document.getElementById('stripeBtn');
    const apiForm = document.getElementById('ppApiForm');
    const ipnForm = document.getElementById('ppIpnForm');
    const stripeForm = document.getElementById('stripeForm');

    const m = document.getElementById('ppModal');
    const apiReady = ${ppApiEnabled ? 'true' : 'false'};
    const ipnReady = ${ppIpnEnabled ? 'true' : 'false'};
    const base = ${JSON.stringify(base)};
    const notify = ${JSON.stringify(notify)};

    let currentTopup = null; // {id, amount, currency}

    function drawQuick(){
      const c = cur.value;
      const opts = c==='USD' ? [1,5,10,20,50] : [5,10,50,100,200];
      quick.innerHTML = opts.map(v=>'<span class="chip" data-v="'+v+'">'+(c==='USD'?'$ ':'MXN ')+v+'</span>').join('');
      quick.querySelectorAll('.chip').forEach(ch=>{
        ch.addEventListener('click', ()=>{ amount.value = ch.getAttribute('data-v'); amount.focus(); });
      });
    }
    cur.addEventListener('change', drawQuick);
    drawQuick();

    async function ensureTopup(){
      const val = parseFloat(amount.value);
      if (!(val>0)) { alert('Escribe un monto válido.'); throw new Error('invalid'); }
      const params = new URLSearchParams();
      params.set('currency', cur.value);
      params.set('amount', String(val.toFixed(2)));

      const r = await fetch('/comprar-creditos/create?json=1', {
        method: 'POST',
        body: params,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        credentials: 'same-origin'
      });
      const j = await r.json();
      if (!j || !j.ok) { alert((j && j.error) || 'Error creando recarga'); throw new Error('create-failed'); }
      currentTopup = { id:j.id, amount: val.toFixed(2), currency: cur.value };
      return currentTopup;
    }

    // Modal helpers
    function open(){ m.classList.add('show'); m.setAttribute('aria-hidden','false'); }
    function close(){ m.classList.remove('show'); m.setAttribute('aria-hidden','true'); }
    document.getElementById('ppClose')?.addEventListener('click', close);
    m?.addEventListener('click', (e)=>{ if(e.target.id==='ppModal') close(); });
    window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });

    // PayPal click
    paypalBtn?.addEventListener('click', async ()=>{
      if (!apiReady && !ipnReady){ alert('PayPal no está disponible.'); return; }
      try{
        await ensureTopup();
        if (apiReady && ipnReady) { open(); }
        else if (apiReady) { payWithApi(); }
        else { payWithIpn(); }
      }catch(e){}
    });

    // Stripe click (POST seguro)
    stripeBtn?.addEventListener('click', async ()=>{
      try{
        const t = currentTopup || await ensureTopup();
        stripeForm.topup_id.value = String(t.id);
        stripeForm.submit();
      }catch(e){}
    });

    // Opciones del modal
    document.getElementById('ppOptApi')?.addEventListener('click', payWithApi);
    document.getElementById('ppOptIpn')?.addEventListener('click', payWithIpn);

    function payWithApi(){
      if (!currentTopup) return;
      apiForm.topup_id.value = String(currentTopup.id);
      apiForm.submit();
    }
    function payWithIpn(){
      if (!currentTopup) return;
      try{
        const f = ipnForm;
        const id = currentTopup.id;
        const suffix = Date.now().toString(36);
        f.amount.value = String(Number(currentTopup.amount).toFixed(2));
        f.currency_code.value = currentTopup.currency;
        f.invoice.value = 'TOPUP-' + String(id) + '-' + suffix;
        f.custom.value = String(id);
        f.notify_url.value = notify;
        f.return.value = base + '/comprar-creditos/confirm/' + String(id);
        f.cancel_return.value = base + '/comprar-creditos/confirm/' + String(id) + '?canceled=1';
        f.submit();
      }catch(e){
        alert('Error iniciando PayPal: ' + e.message);
      }finally{
        close();
      }
    }

    // Evitar submit real del form
    form.addEventListener('submit', (e)=> e.preventDefault());
  })();
</script>
</body></html>`);
});

/* ========== crea topup (JSON o redirect) ========== */
router.post(
  "/comprar-creditos/create",
  ensureAuth,
  express.urlencoded({extended:false}),
  express.json(),
  async (req,res)=>{
    const u = req.session.user;
    const currency = String((req.body && req.body.currency) || "").toUpperCase();
    let amount = round2((req.body && req.body.amount) || 0);

    if (!["USD","MXN"].includes(currency)) {
      if (req.query.json==="1") return res.json({ok:false,error:"Moneda inválida."});
      return res.status(400).send("Moneda inválida.");
    }
    if (!(amount>0)) {
      if (req.query.json==="1") return res.json({ok:false,error:"Monto inválido (usa 0.01 o más)."});
      return res.status(400).send("Monto inválido (usa 0.01 o más).");
    }

    const ins = db.prepare(
      `INSERT INTO credit_topups(user_id,currency,amount,status) VALUES(?,?,?,'pending')`
    ).run(u.id, currency, amount);

    if (req.query.json==="1") {
      const apiReady = db.getSetting("paypal_api_enabled","0")==="1"
                    && !!db.getSetting("paypal_api_client_id","")
                    && !!db.getSetting("paypal_api_secret","");
      return res.json({ ok:true, id: ins.lastInsertRowid, apiReady });
    }
    return res.redirect(302, `/comprar-creditos/pagar/${ins.lastInsertRowid}`);
  }
);

/* ========== (opcional) Pantalla extra — Stripe/PayPal también visibles ========== */
router.get("/comprar-creditos/pagar/:id", ensureAuth, (req,res)=>{
  const site = db.getSetting("site_name","SkyShop");
  const logo = db.getSetting("logo_url","");
  const u = req.session.user;
  const id = Number(req.params.id||0);

  const t = db.prepare(`SELECT * FROM credit_topups WHERE id=? AND user_id=? LIMIT 1`).get(id, u.id);
  if (!t) return res.status(404).send("Recarga no encontrada.");
  if (t.status === 'paid') return res.redirect(`/comprar-creditos/confirm/${t.id}`);

  const ppApiEnabled = db.getSetting("paypal_api_enabled","0")==="1"
                    && !!db.getSetting("paypal_api_client_id","")
                    && !!db.getSetting("paypal_api_secret","");
  const ppIpnEnabled = db.getSetting("paypal_ipn_enabled","0")==="1"
                    && !!db.getSetting("paypal_ipn_email","");
  const ppEmail   = db.getSetting("paypal_ipn_email","");
  const ppModeLive = db.getSetting("paypal_api_mode","sandbox")==="live";
  const webscr = ppModeLive
    ? "https://www.paypal.com/cgi-bin/webscr"
    : "https://www.sandbox.paypal.com/cgi-bin/webscr";
  const base = baseUrl(req);
  const notify = `${base}/comprar-creditos/paypal/ipn`;

  res.type("html").send(`<!doctype html>
<html lang="es">
${sharedHead(site)}
<body>
  ${topBar(site, logo, u)}
  ${drawerHtml(!!u.is_admin)}
  <main class="wrap">
    <section class="card">
      <h2 style="margin:0 0 6px">Recarga: ${t.currency} ${Number(t.amount).toFixed(2)}</h2>
      <p class="muted">ID de recarga: #${t.id}</p>

      <div class="paygrid" style="margin-top:12px">
        <form id="stripeForm2" method="post" action="/comprar-creditos/stripe/start">
          <input type="hidden" name="topup_id" value="${t.id}">
          <button class="paybtn stripe" type="submit" title="Pagar con tarjeta">
            ${stripeIcon()} Stripe (tarjeta)
          </button>
        </form>
        <button id="paypalBtn" class="paybtn paypal" type="button" title="Pagar con PayPal">
          ${paypalIcon()} PayPal
        </button>
        <a class="pill" href="/comprar-creditos">Cambiar monto</a>
      </div>
    </section>
  </main>

  <!-- PayPal API -->
  <form id="ppApiForm" method="post" action="/comprar-creditos/paypal/api/create" style="display:none">
    <input type="hidden" name="topup_id" value="${t.id}">
  </form>

  <!-- PayPal IPN -->
  <form id="ppIpnForm" method="post" action="${webscr}" style="display:none">
    <input type="hidden" name="cmd" value="_xclick">
    <input type="hidden" name="business" value="${esc(ppEmail)}">
    <input type="hidden" name="item_name" value="Recarga de créditos (${t.currency})">
    <input type="hidden" name="amount" value="${Number(t.amount).toFixed(2)}">
    <input type="hidden" name="currency_code" value="${t.currency}">
    <input type="hidden" name="invoice" value="">
    <input type="hidden" name="custom" value="${t.id}">
    <input type="hidden" name="notify_url" value="${notify}">
    <input type="hidden" name="return" value="${base}/comprar-creditos/confirm/${t.id}">
    <input type="hidden" name="cancel_return" value="${base}/comprar-creditos/confirm/${t.id}?canceled=1">
    <input type="hidden" name="no_shipping" value="1">
    <input type="hidden" name="rm" value="1">
  </form>

  <div id="ppModal" class="modal" aria-hidden="true">
    <div class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px">
        <h3 style="margin:0">Elige cómo pagar con PayPal</h3>
        <button id="ppClose" class="pill" type="button">✕</button>
      </div>
      ${ppApiEnabled ? `
        <div class="opt" id="ppOptApi">
          ${paypalIcon()} <div><b>PayPal (API / Checkout)</b><br><small>Redirección a PayPal y confirmación automática.</small></div>
        </div>` : ``}
      ${ppIpnEnabled ? `
        <div class="opt" id="ppOptIpn">
          ${paypalIcon()} <div><b>PayPal por correo (IPN)</b><br><small>Pago directo al correo configurado.</small></div>
        </div>` : ``}
      ${(!ppApiEnabled && !ppIpnEnabled) ? `<div class="muted">PayPal no está disponible.</div>` : ``}
    </div>
  </div>

${sharedTopJs()}
<script>
  (function(){
    const btn = document.getElementById('paypalBtn');
    const apiForm = document.getElementById('ppApiForm');
    const ipnForm = document.getElementById('ppIpnForm');
    const m = document.getElementById('ppModal');
    const apiReady = ${ppApiEnabled ? 'true' : 'false'};
    const ipnReady = ${ppIpnEnabled ? 'true' : 'false'};

    function open(){ m.classList.add('show'); m.setAttribute('aria-hidden','false'); }
    function close(){ m.classList.remove('show'); m.setAttribute('aria-hidden','true'); }
    document.getElementById('ppClose')?.addEventListener('click', close);
    m?.addEventListener('click', (e)=>{ if(e.target.id==='ppModal') close(); });
    window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });

    document.getElementById('ppOptApi')?.addEventListener('click', ()=> apiForm.submit());
    document.getElementById('ppOptIpn')?.addEventListener('click', ()=> ipnForm.submit());

    btn?.addEventListener('click', ()=>{
      if (!apiReady && !ipnReady){ alert('PayPal no está disponible.'); return; }
      if (apiReady && ipnReady) open();
      else if (apiReady) apiForm.submit();
      else ipnForm.submit();
    });
  })();
</script>
</body></html>`);
});

/* ========== Stripe start (crea sesión de Checkout para topup) ========== */
router.post(
  "/comprar-creditos/stripe/start",
  ensureAuth,
  express.urlencoded({extended:false}),
  async (req,res)=>{
    const u = req.session.user;
    const id = Number(req.body.topup_id||0);
    if (!id) return res.status(400).send("Falta topup_id");

    const t = db.prepare(`SELECT * FROM credit_topups WHERE id=? AND user_id=? LIMIT 1`).get(id, u.id);
    if (!t) return res.status(404).send("Recarga no encontrada.");
    if (t.status === 'paid') return res.redirect(302, `/comprar-creditos/confirm/${t.id}`);

    const stripe = getStripe();
    if (!stripe) return res.status(400).send("Stripe no está configurado.");

    const base = baseUrl(req);
    try{
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: String(t.currency||"USD").toLowerCase(), // usd/mxn
            product_data: {
              name: `Recarga de créditos (${t.currency})`,
              description: `Usuario #${u.id} · Topup #${t.id}`
            },
            unit_amount: Math.round(Number(t.amount)*100) // centavos
          },
          quantity: 1
        }],
        metadata: {
          kind: "credit_topup",
          topup_id: String(t.id),
          user_id: String(u.id)
        },
        success_url: `${base}/comprar-creditos/stripe/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/comprar-creditos/confirm/${t.id}?canceled=1`
      });

      // Guarda ref de Stripe (por si el usuario no vuelve)
      db.prepare(`UPDATE credit_topups SET provider='stripe', provider_ref=? WHERE id=? AND provider_ref IS NULL`)
        .run(session.id, t.id);

      return res.redirect(303, session.url);
    }catch(err){
      console.error("Stripe start error:", err);
      return res.status(500).send("No se pudo iniciar Stripe");
    }
  }
);

/* ========== Stripe return (confirma y acredita saldo) ========== */
router.get("/comprar-creditos/stripe/return", ensureAuth, async (req,res)=>{
  const stripe = getStripe();
  const sid = String(req.query.session_id||"").trim();
  if (!stripe || !sid) return res.redirect("/comprar-creditos");

  const u = req.session.user;

  try{
    const sess = await stripe.checkout.sessions.retrieve(sid, { expand: ["payment_intent"] });
    const topupId = Number(sess?.metadata?.topup_id || 0);
    if (!topupId) return res.redirect("/comprar-creditos");

    const t = db.prepare(`SELECT * FROM credit_topups WHERE id=? AND user_id=?`).get(topupId, u.id);
    if (!t) return res.status(404).send("Recarga no encontrada.");

    if (sess.payment_status === "paid" && t.status !== "paid"){
      const pi = typeof sess.payment_intent === "object" ? sess.payment_intent.id : (sess.payment_intent || sid);

      const tx = db.transaction(()=>{
        db.prepare(`
          UPDATE credit_topups
          SET status='paid', provider='stripe', provider_ref=?, paid_at=datetime('now')
          WHERE id=? AND status<>'paid'
        `).run(pi, t.id);

        db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`)
          .run(t.user_id, t.currency);
        db.prepare(`UPDATE credits SET balance=balance+? WHERE user_id=? AND currency=?`)
          .run(t.amount, t.user_id, t.currency);
      });
      tx();
    }

    return res.redirect(302, `/comprar-creditos/confirm/${topupId}`);
  }catch(err){
    console.error("Stripe return error:", err);
    return res.redirect(302, `/comprar-creditos`);
  }
});

/* ========== PayPal API: create / return / cancel para TOPUPS ========== */
router.post("/comprar-creditos/paypal/api/create", ensureAuth, express.urlencoded({extended:false}), async (req,res)=>{
  const u = req.session.user;
  const id = Number(req.body.topup_id||0);
  const t = db.prepare(`SELECT * FROM credit_topups WHERE id=? AND user_id=? LIMIT 1`).get(id, u.id);
  if (!t) return res.status(404).send("Recarga no encontrada.");

  const { clientId, secret } = getPPEnv();
  if (!clientId || !secret) return res.status(400).send("PayPal API no está configurado.");

  try{
    const base = baseUrl(req);
    const ret = `${base}/comprar-creditos/paypal/api/return?topup_id=${t.id}`;
    const cancel = `${base}/comprar-creditos/paypal/api/cancel?topup_id=${t.id}`;
    const ord = await ppCreateOrder(t, ret, cancel);
    db.prepare(`UPDATE credit_topups SET provider='paypal_api', provider_ref=? WHERE id=? AND provider_ref IS NULL`).run(ord.id, t.id);
    return res.redirect(303, ord.approve);
  }catch(e){
    console.error("PayPal create error:", e);
    return res.status(500).send("No se pudo iniciar PayPal.");
  }
});

router.get("/comprar-creditos/paypal/api/return", ensureAuth, async (req,res)=>{
  const u = req.session.user;
  const id = Number(req.query.topup_id||0);
  const token = String(req.query.token||"").trim(); // orderId
  const t = db.prepare(`SELECT * FROM credit_topups WHERE id=? AND user_id=?`).get(id, u.id);
  if (!t) return res.status(404).send("Recarga no encontrada.");

  try{
    const cap = await ppCaptureOrder(token);
    const capId = cap?.purchase_units?.[0]?.payments?.captures?.[0]?.id || token;

    const tx = db.transaction(()=>{
      db.prepare(`UPDATE credit_topups SET status='paid', provider='paypal_api', provider_ref=?, paid_at=datetime('now') WHERE id=? AND status<>'paid'`)
        .run(capId, t.id);

      db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`)
        .run(t.user_id, t.currency);
      db.prepare(`UPDATE credits SET balance=balance+? WHERE user_id=? AND currency=?`)
        .run(t.amount, t.user_id, t.currency);
    });
    tx();

    return res.redirect(302, `/comprar-creditos/confirm/${t.id}`);
  }catch(e){
    console.error("PayPal capture error:", e);
    return res.redirect(302, `/comprar-creditos/confirm/${t.id}`);
  }
});

router.get("/comprar-creditos/paypal/api/cancel", ensureAuth, (req,res)=>{
  const id = Number(req.query.topup_id||0);
  if (!id) return res.redirect("/comprar-creditos");
  try{
    db.prepare(`UPDATE credit_topups SET status='canceled' WHERE id=? AND status='pending'`).run(id);
  }catch(e){}
  return res.redirect(302, `/comprar-creditos/confirm/${id}?canceled=1`);
});

/* ========== Confirmación/éxito de la recarga ========== */
router.get("/comprar-creditos/confirm/:id", ensureAuth, (req,res)=>{
  const site = db.getSetting("site_name", "SkyShop");
  const logo = db.getSetting("logo_url", "");
  const u = req.session.user;
  const id = Number(req.params.id||0);
  const t = db.prepare(`SELECT * FROM credit_topups WHERE id=? AND user_id=?`).get(id, u.id);
  if (!t) return res.status(404).send("Recarga no encontrada.");

  if (String(req.query.json||"") === "1"){
    return res.json({ ok:true, status:t.status, paid:t.status==='paid' });
  }

  const paid = t.status==='paid';
  const balUSD = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='USD'`).get(u.id)?.balance || 0;
  const balMXN = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='MXN'`).get(u.id)?.balance || 0;

  const waitingHtml = `<!doctype html><html lang="es">
${sharedHead(site)}
<body>
  ${topBar(site, logo, u)}
  ${drawerHtml(!!u.is_admin)}
  <main class="wrap">
    <section class="card">
      <h2>Esperando confirmación…</h2>
      <p class="muted">No cierres esta ventana. Actualizaremos el estado automáticamente.</p>
      <a class="pill" href="/">Volver al panel</a>
    </section>
  </main>
${sharedTopJs()}
<script>
  (function(){
    const started = Date.now(); const maxMs = 5*60*1000;
    async function tick(){
      try{
        const r = await fetch(location.pathname + '?json=1', { credentials:'same-origin' });
        const j = await r.json(); if (j && j.ok && j.paid){ location.replace(location.pathname); return; }
      }catch(e){}
      if (Date.now()-started < maxMs) setTimeout(tick, 3000);
    }
    setTimeout(tick, 1500);
  })();
</script></body></html>`;

  const okHtml = `<!doctype html><html lang="es">
${sharedHead(site)}
<body>
  ${topBar(site, logo, u)}
  ${drawerHtml(!!u.is_admin)}
  <main class="wrap">
    <section class="card">
      <h2>¡Recarga acreditada!</h2>
      <p>Se agregaron <b>${esc(t.currency)} ${Number(t.amount).toFixed(2)}</b> a tu saldo.</p>
      <div class="muted">Recarga #${t.id} · ${t.provider ? ('Pago: '+esc(t.provider)+' ('+esc(t.provider_ref||'')+')') : ''}</div>
      <h3>Tu saldo actual</h3>
      <ul>
        <li>USD: <b>$ ${Number(balUSD).toFixed(2)}</b></li>
        <li>MXN: <b>MXN ${Number(balMXN).toFixed(2)}</b></li>
      </ul>
      <div class="row">
        <a class="paybtn paypal" href="/comprar-creditos?currency=${esc(t.currency)}">${paypalIcon()} Recargar otra vez</a>
        <a class="pill" href="/">Ir al panel</a>
      </div>
    </section>
  </main>
${sharedTopJs()}
</body></html>`;

  res.type("html").send(paid ? okHtml : waitingHtml);
});

/* ========== PayPal IPN para recargas ========== */
const ipnParser = express.urlencoded({ extended:false });
router.post("/comprar-creditos/paypal/ipn", ipnParser, async (req,res)=>{
  const body = req.body || {};
  const custom = String(body.custom||"").trim();
  const topupId = /^\d+$/.test(custom) ? Number(custom) : 0;

  res.status(200).send("OK"); // responder rápido a PayPal
  if (!topupId) return;

  try{
    const verified = await verifyPayPalIPN(body, db.getSetting("paypal_api_mode","sandbox")==="live");
    if (!verified) return;
  }catch(e){ return; }

  const status = String(body.payment_status||"").toLowerCase();
  if (status !== "completed") return;

  const txn = String(body.txn_id||"").trim() || String(body.txnId||"").trim();
  if (!txn) return;

  const mcCurrency = String(body.mc_currency||body.currency||"").toUpperCase();
  const gross = Number(body.mc_gross||body.amount||0);

  const t = db.prepare(`SELECT * FROM credit_topups WHERE id=?`).get(topupId);
  if (!t || t.status === 'paid') return;

  if (mcCurrency !== t.currency) return;
  if (Math.abs(Number(gross) - Number(t.amount)) > 0.01) return;

  try{
    const tx = db.transaction(()=>{
      db.prepare(`
        UPDATE credit_topups
        SET status='paid', provider='paypal_ipn', provider_ref=?, paid_at=datetime('now')
        WHERE id=? AND status<>'paid'
      `).run(txn, t.id);

      db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`)
        .run(t.user_id, t.currency);
      db.prepare(`UPDATE credits SET balance=balance+? WHERE user_id=? AND currency=?`)
        .run(t.amount, t.user_id, t.currency);
    });
    tx();
  }catch(e){ /* noop */ }
});

/* ===== PayPal IPN verification (postback) ===== */
function verifyPayPalIPN(params, live){
  return new Promise((resolve)=>{
    const payload = 'cmd=_notify-validate&' + qs.stringify(params);
    const opts = {
      host: live ? 'ipnpb.paypal.com' : 'ipnpb.sandbox.paypal.com',
      method: 'POST',
      path: '/cgi-bin/webscr',
      headers: {
        'Content-Length': Buffer.byteLength(payload),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };
    const req = https.request(opts, (res)=>{
      let data = '';
      res.on('data', (c)=> data += c);
      res.on('end', ()=> resolve(String(data||'').trim() === 'VERIFIED'));
    });
    req.on('error', ()=> resolve(false));
    req.write(payload);
    req.end();
  });
}

/* ====== Iconos (SVG inline) ====== */
function paypalIcon(){
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7.1 20.8H5.3c-.6 0-1-.6-.9-1.2l1.9-12.2c.1-.5.5-.9 1-.9h7.3c3.1 0 4.9 1.6 4.4 4.2-.4 2.3-2.1 3.6-4.4 3.8h-3c-.5 0-.9.3-1 .8l-.7 4.2c-.1.6-.6 1-1.1 1h-1.7z"/>
  </svg>`;
}
function stripeIcon(){
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.6 7.5c-1.4-.6-3.2-1-5.2-1-5 0-8.5 2.5-8.5 6.1 0 2.6 2.5 4.2 4.3 4.2 1.8 0 2.9-.7 3.6-1.7v1.4c0 .5.4.9.9.9h2.1c.5 0 .9-.4.9-.9V8.3c0-.3-.2-.6-.5-.8zM15 13.4c-.5.7-1.4 1.3-2.5 1.3-1.1 0-1.9-.6-1.9-1.6 0-1.5 1.7-2.3 3.8-2.3.2 0 .4 0 .6.1v2.5z"/>
  </svg>`;
}

module.exports = router;
