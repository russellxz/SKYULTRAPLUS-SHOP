// admin_stripe.js — Admin: configuración de Stripe (UI claro/oscuro + guardar settings)
"use strict";

const express = require("express");
const db = require("./db");

const router = express.Router();

/* ========= middleware ========= */
function ensureAdmin(req, res, next) {
  const u = req.session && req.session.user;
  if (!u) return res.redirect("/login");
  if (!u.is_admin) return res.redirect("/");
  next();
}

/* ========= settings helpers ========= */
function ensureSettingsSchema() {
  // Esquema defensivo (si ya existe, no pasa nada)
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS settings(
      key TEXT PRIMARY KEY,
      value TEXT
    )`).run();
  } catch {}
}
ensureSettingsSchema();

function getS(k, d = "") {
  try { return db.getSetting ? db.getSetting(k, d) : (db.prepare(`SELECT value FROM settings WHERE key=?`).get(k)?.value ?? d); }
  catch { return d; }
}
function setS(k, v) {
  try {
    if (db.setSetting) return db.setSetting(k, v);
    db.prepare(`INSERT INTO settings(key,value) VALUES(?,?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, String(v ?? ""));
  } catch (e) {
    console.error("[stripe:settings] set error:", e?.message || e);
  }
}
function absoluteBase(req){
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host  = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
}
const mask = (s) => {
  s = String(s || "");
  if (s.length <= 6) return s ? "••••" : "";
  return s.slice(0, 2) + "••••" + s.slice(-4);
};

/* ========= UI ========= */
router.get("/stripe", ensureAdmin, (req, res) => {
  const site = getS("site_name", "SkyShop");

  const enabled = getS("stripe_enabled", "0") === "1";
  const pk = getS("stripe_pk", "");
  const sk = getS("stripe_sk", "");
  const wh = getS("stripe_webhook_secret", "");
  const currency = (getS("stripe_currency", "USD") || "USD").toUpperCase() === "MXN" ? "MXN" : "USD";

  const webhookUrl = absoluteBase(req) + "/pay/stripe/webhook";
  const ok = req.query.ok === "1" ? `<div class="note ok">Guardado ✔</div>` : "";

  res.type("html").send(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Admin · Stripe</title>
<style>
  :root{
    --bg:#0b1220; --card:#111827; --txt:#e5e7eb; --muted:#9aa4b2; --line:#ffffff22;
    --accent:#2563eb; --danger:#ef4444; --ok:#16a34a;
  }
  *{box-sizing:border-box} html,body{height:100%}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt)}
  body.light{background:#f7f7fb;color:#0b1220}
  body.light .topbar, body.light .drawer .panel, body.light .card{background:#fff}
  body.light .topbar, body.light .card{border-color:#00000018}
  body.light .muted{color:#667085}
  .topbar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;justify-content:space-between;
          padding:10px 12px;background:rgba(17,25,40,.6);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
  .brand{font-weight:900}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;border:1px solid #334155;background:#1f2a44;color:#fff;cursor:pointer;text-decoration:none}
  .btn.ghost{background:transparent;border-color:#334155;color:inherit}
  .btn.blue{background:var(--accent);border-color:#1d4ed8}
  .btn.red{background:var(--danger);border-color:#b91c1c}
  .btn.ok{background:var(--ok);border-color:#15803d}
  .burger{width:40px;height:40px;display:grid;place-items:center;border-radius:10px;border:1px solid #334155;background:transparent;cursor:pointer}
  .burger span{width:20px;height:2px;background:currentColor;position:relative;display:block}
  .burger span:before,.burger span:after{content:"";position:absolute;left:0;right:0;height:2px;background:currentColor}
  .burger span:before{top:-6px} .burger span:after{top:6px}

  .drawer{position:fixed;inset:0 auto 0 0;width:280px;transform:translateX(-100%);transition:transform .22s ease;z-index:6}
  .drawer.open{transform:none}
  .drawer .panel{height:100%;background:rgba(17,25,40,.8);backdrop-filter:blur(10px);border-right:1px solid var(--line);padding:14px}
  .scrim{position:fixed;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(1px);opacity:0;visibility:hidden;transition:.18s ease;z-index:5}
  .scrim.show{opacity:1;visibility:visible}

  .nav a{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #334155;border-radius:10px;margin-bottom:8px;color:inherit;text-decoration:none}
  .nav a:hover{border-color:#64748b}
  .nav a.active{border-color:#1d4ed8}
  .nav a svg{width:18px;height:18px;flex:0 0 18px;opacity:.95}

  .wrap{max-width:880px;margin:0 auto;padding:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}
  .title{margin:10px 0 6px 0}
  .muted{color:var(--muted)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .input,select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:inherit}
  body.light .input, body.light select{background:#fff;border-color:#00000022}
  label{font-size:14px;margin-bottom:6px;display:block}
  .note{border:1px solid var(--line);padding:10px;border-radius:10px;margin:10px 0;color:#e5e7eb}
  .note.ok{background:#16a34a22;border-color:#16a34a55}
  .note.err{background:#ef444422;border-color:#ef444455}
  .row.end{justify-content:flex-end}
  .hint{font-size:12px;opacity:.9}
  .switch{display:flex;align-items:center;gap:8px}
  .switch input{width:18px;height:18px}
  .mono{font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
  @media(max-width:760px){ .grid{grid-template-columns:1fr} }
</style>
</head>
<body>
  <div class="topbar">
    <div class="row">
      <button id="menuBtn" class="burger" aria-label="Abrir menú"><span></span></button>
      <div class="brand">${site} · Admin</div>
    </div>
    <div class="row">
      <button id="modeBtn" class="btn ghost" type="button">🌙</button>
      <a class="btn ghost" href="/admin">← Admin</a>
      <a class="btn red" href="/logout">Salir</a>
    </div>
  </div>

  <div class="drawer" id="drawer">
    <div class="panel">
      <h3 style="margin:0 0 10px">Menú</h3>
      <nav class="nav" id="sidenav">
        <a href="/admin" data-match="^/admin/?$"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7v-1a5 5 0 0 1 10 0v1H3z"/></svg>Usuarios</a>
        <a href="/admin/mail" data-match="^/admin/mail"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3h13A1.5 1.5 0 0 1 16 4.5v7A1.5 1.5 0 0 1 14.5 13h-13A1.5 1.5 0 0 1 0 11.5v-7A1.5 1.5 0 0 1 1.5 3Zm.5 1.8 6 3.7 6-3.7V5L8 8.7 2 5v-.2Z"/></svg>Correo (SMTP)</a>
        <a href="/admin/brand" data-match="^/admin/brand"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm1 8h10l-3.2-4-2.3 3L6 8 3 11Zm6-6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>Logo y nombre</a>
        <a href="/admin/store" data-match="^/admin/store"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>Resumen tienda</a>
        <a href="/admin/products" data-match="^/admin/products"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 4.5 8 1l6 3.5V12l-6 3.5L2 12V4.5Zm6 1L4 3.3v2.9l4 2.3 4-2.3V3.3L8 5.5Z"/></svg>Productos</a>
        <a href="/admin/invoices" data-match="^/admin/invoices"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>Facturas</a>
        <a href="/admin/tickets" data-match="^/admin/tickets"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0-1 1 1 1 0 0 0 1 1v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a1 1 0 0 0 1-1 1 1 0 0 0-1-1V5Z"/></svg>Tickets</a>
        <a href="/admin/paypal" data-match="^/admin/paypal"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1z"/></svg>PayPal</a>
        <a href="/admin/stripe" data-match="^/admin/stripe"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1c3.9 0 7 3.1 7 7s-3.1 7-7 7S1 11.9 1 8 4.1 1 8 1z"/></svg>Stripe</a>
        <a href="/admin/whatsapp" data-match="^/admin/whatsapp"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M13 1a2 2 0 0 1 2 2v8l-4-2-4 2V3a2 2 0 0 1 2-2h4z"/></svg>WhatsApp</a>
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>

  <div class="wrap">
    ${ok}
    <section class="card">
      <h2 class="title" style="margin:6px 0">Configurar Stripe</h2>
      <p class="muted" style="margin-top:0">Guarda tus claves de Stripe. El webhook se muestra abajo.</p>

      <form method="post" action="/admin/stripe">
        <div class="row" style="justify-content:space-between;margin:8px 0 12px">
          <label class="switch">
            <input type="checkbox" name="enabled" value="1" ${enabled ? "checked":""}>
            <span>Stripe habilitado</span>
          </label>
          <div>
            <label>Moneda por defecto</label>
            <select class="input" name="currency" style="width:160px">
              <option value="USD" ${currency==='USD'?'selected':''}>USD</option>
              <option value="MXN" ${currency==='MXN'?'selected':''}>MXN</option>
            </select>
          </div>
        </div>

        <div class="grid">
          <div>
            <label>Publishable Key (pk_...)</label>
            <input class="input mono" name="pk" value="${pk}" placeholder="pk_live_xxx o pk_test_xxx">
          </div>
          <div>
            <label>Secret Key (sk_...)</label>
            <input class="input mono" name="sk" type="password" value="${sk}" placeholder="sk_live_xxx o sk_test_xxx">
          </div>
          <div>
            <label>Webhook Secret (whsec_...)</label>
            <input class="input mono" name="wh" type="password" value="${wh}" placeholder="whsec_xxx">
          </div>
          <div>
            <label>Claves (vista rápida)</label>
            <div class="note">
              <div>PK: ${pk ? mask(pk) : "—"}</div>
              <div>SK: ${sk ? mask(sk) : "—"}</div>
              <div>WH: ${wh ? mask(wh) : "—"}</div>
            </div>
          </div>
        </div>

        <div class="note">
          <div class="row" style="justify-content:space-between;gap:8px;align-items:center">
            <div>
              <div><b>Webhook URL</b></div>
              <div class="mono" id="whurl">${webhookUrl}</div>
              <div class="hint muted">Configura este endpoint en tu Dashboard de Stripe (&ldquo;Developers &rarr; Webhooks&rdquo;)</div>
            </div>
            <button id="copyBtn" class="btn ghost" type="button" title="Copiar">Copiar</button>
          </div>
        </div>

        <div class="row end" style="margin-top:10px">
          <button class="btn ok" type="submit">Guardar</button>
        </div>
      </form>
    </section>
  </div>

<script>
(function(){
  /* Tema */
  var modeBtn=document.getElementById('modeBtn');
  function applyMode(m){var l=(m==='light');document.body.classList.toggle('light',l);modeBtn.textContent=l?'☀️':'🌙';localStorage.setItem('ui:mode',l?'light':'dark')}
  applyMode(localStorage.getItem('ui:mode')||'dark');
  modeBtn.addEventListener('click',()=>applyMode(document.body.classList.contains('light')?'dark':'light'));

  /* Drawer */
  var drawer=document.getElementById('drawer'), scrim=document.getElementById('scrim');
  document.getElementById('menuBtn').addEventListener('click',()=>{drawer.classList.add('open');scrim.classList.add('show')});
  scrim.addEventListener('click',()=>{drawer.classList.remove('open');scrim.classList.remove('show')});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'){drawer.classList.remove('open');scrim.classList.remove('show')}});

  /* Marca activo */
  (function(){var p=location.pathname;document.querySelectorAll('#sidenav a').forEach(a=>{var re=new RegExp(a.getAttribute('data-match')); if(re.test(p)) a.classList.add('active')})})();

  /* Copiar webhook */
  document.getElementById('copyBtn').addEventListener('click', async ()=>{
    try{
      var t=document.getElementById('whurl').textContent.trim();
      await navigator.clipboard.writeText(t);
      var btn=document.getElementById('copyBtn'); var old=btn.textContent; btn.textContent='Copiado';
      setTimeout(()=>btn.textContent=old,900);
    }catch{}
  });
})();
</script>
</body>
</html>`);
});

/* ========= POST guardar ========= */
router.post("/stripe", ensureAdmin, express.urlencoded({ extended: true }), (req, res) => {
  const enabled = req.body?.enabled ? "1" : "0";
  const pk = String(req.body?.pk || "").trim();
  const sk = String(req.body?.sk || "").trim();
  const wh = String(req.body?.wh || "").trim();
  const currency = (String(req.body?.currency || "USD").toUpperCase() === "MXN") ? "MXN" : "USD";

  try{
    setS("stripe_enabled", enabled);
    setS("stripe_pk", pk);
    setS("stripe_sk", sk);
    setS("stripe_webhook_secret", wh);
    setS("stripe_currency", currency);
    return res.redirect("/admin/stripe?ok=1");
  }catch(e){
    console.error("[admin/stripe] save:", e?.message || e);
    return res.status(500).type("text/plain").send("No se pudo guardar la configuración.");
  }
});

module.exports = router;