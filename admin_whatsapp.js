// admin_whatsapp.js — panel de WhatsApp (tema claro/oscuro + owner + pairing)
"use strict";

const express = require("express");
const router = express.Router();
const whatsapp = require("./whatsapp"); // <- asegúrate que exista ./whatsapp.js
const db = require("./db");

/* ====== middleware (solo admin) ====== */
function ensureAdmin(req, res, next) {
  const u = req.session && req.session.user;
  if (!u) return res.redirect("/login");
  if (!u.is_admin) return res.redirect("/");
  next();
}
router.use(express.urlencoded({ extended: true }));

/* ===== helpers ===== */
function setSetting(key, value) {
  if (typeof db.setSetting === "function") return db.setSetting(key, value);
  db.prepare(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)`).run();
  db.prepare(`
    INSERT INTO settings(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, String(value ?? ""));
}

/** Normaliza a dígitos; acepta cualquier país. Sólo corrige 🇲🇽 52→521 */
function normalizeDial(input) {
  let s = String(input || "").replace(/\D/g, "");
  if (!s) return "";
  if (s.startsWith("52") && !s.startsWith("521") && s.length >= 12) s = "521" + s.slice(2);
  return s;
}

/* ===== PAGE ===== */
router.get("/admin/whatsapp", ensureAdmin, async (_req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  const st = (await whatsapp.getStatus().catch(() => ({ connected: false, number: "" }))) || { connected: false, number: "" };
  const owner = db.getSetting("owner_whatsapp", "");

  res.type("html").send(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Admin · WhatsApp</title>
<style>
  :root{--bg:#0b1220;--card:#111827;--txt:#e5e7eb;--muted:#9aa4b2;--line:#ffffff22;--accent:#2563eb;--danger:#ef4444;--ok:#16a34a}
  *{box-sizing:border-box} html,body{height:100%}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt)}
  body.light{background:#f7f7fb;color:#0b1220}
  body.light .topbar,body.light .drawer .panel,body.light .card{background:#fff}
  body.light .topbar,body.light .card{border-color:#00000018}
  body.light .muted{color:#667085}
  .topbar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(17,25,40,.6);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
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
  .burger span:before{top:-6px}.burger span:after{top:6px}
  .drawer{position:fixed;inset:0 auto 0 0;width:280px;transform:translateX(-100%);transition:transform .22s ease;z-index:6}
  .drawer.open{transform:none}
  .drawer .panel{height:100%;background:rgba(17,25,40,.8);backdrop-filter:blur(10px);border-right:1px solid var(--line);padding:14px}
  .scrim{position:fixed;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(1px);opacity:0;visibility:hidden;transition:.18s ease;z-index:5}
  .scrim.show{opacity:1;visibility:visible}
  .nav a{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #334155;border-radius:10px;margin-bottom:8px;color:inherit;text-decoration:none}
  .nav a:hover{border-color:#64748b}
  .nav a.active{border-color:#1d4ed8}
  .nav a svg{width:18px;height:18px;flex:0 0 18px;opacity:.95}
  .wrap{max-width:1200px;margin:0 auto;padding:14px}
  .title{margin:10px 0 6px 0}
  .muted{color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:12px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:inherit}
  body.light .input{background:#fff;border-color:#00000022}
  label{font-size:12px;color:var(--muted);display:block;margin:0 0 4px}
  .nowrap{white-space:nowrap}
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
      <a class="btn ghost" href="/">← Dashboard</a>
      <a class="btn red" href="/logout">Salir</a>
    </div>
  </div>

  <div class="drawer" id="drawer">
    <div class="panel">
      <h3 style="margin:0 0 10px">Menú</h3>
      <nav class="nav" id="sidenav">
        <a href="/admin" data-match="^/admin/?$">Usuarios</a>
        <a href="/admin/mail" data-match="^/admin/mail">Correo (SMTP)</a>
        <a href="/admin/brand" data-match="^/admin/brand">Logo y nombre</a>
        <a href="/admin/store" data-match="^/admin/store">Resumen tienda</a>
        <a href="/admin/products" data-match="^/admin/products">Productos</a>
        <a href="/admin/invoices" data-match="^/admin/invoices">Facturas</a>
        <a href="/admin/tickets" data-match="^/admin/tickets">Tickets</a>
        <a href="/admin/whatsapp" data-match="^/admin/whatsapp">WhatsApp</a>
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>

  <div class="wrap">
    <h2 class="title">WhatsApp · Bot y notificaciones</h2>
    <p class="muted">Vincula el número del bot y define el número del dueño para recibir avisos.</p>

    <section class="card">
      <h3 style="margin:8px 0">Estado</h3>
      <div class="grid2">
        <div>
          <div class="muted">Conexión</div>
          <div style="font-weight:800;margin-top:4px;">${st.connected ? "✅ Conectado" : "❌ Desconectado"}</div>
        </div>
        <div>
          <div class="muted">Número del bot</div>
          <div style="font-weight:800;margin-top:4px;">${st.number || "—"}</div>
        </div>
      </div>
      <div style="height:10px"></div>
      <div class="grid2">
        <div>
          <div class="muted">Dueño (recibe avisos)</div>
          <div style="font-weight:800;margin-top:4px;">${owner || "—"}</div>
        </div>
        <div>
          <div class="muted">Formato de números</div>
          <div class="muted" style="margin-top:4px;line-height:1.4">
            • Escribe <b>solo dígitos</b>, sin + ni espacios (cualquier país).<br>
            • México: usa <b>521</b> + 10 dígitos (ej: <code>5215512345678</code>).<br>
            • Ej.: Panamá <code>5076XXXXXXXX</code>, Argentina <code>54911XXXXXXXX</code>.
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h3 style="margin:8px 0">Número del dueño (avisos)</h3>
      <form method="post" action="/admin/whatsapp/owner" class="grid2">
        <div>
          <label>Teléfono (solo dígitos)</label>
          <input class="input" name="owner" value="${owner || ""}" placeholder="Ej: 5215512345678" required>
        </div>
        <div style="display:flex;align-items:flex-end;gap:8px">
          <button class="btn ok" type="submit">Guardar</button>
          <a class="btn ghost" href="/admin/whatsapp">Cancelar</a>
        </div>
      </form>
    </section>

    <section class="card">
      <h3 style="margin:8px 0">Vincular bot por código (8 caracteres)</h3>
      <form method="post" action="/admin/whatsapp/pair" class="grid2">
        <div>
          <label>Número a vincular (WhatsApp del teléfono)</label>
          <input class="input" required name="phone" placeholder="Ej: 5076XXXXXXX">
        </div>
        <div style="display:flex;align-items:flex-end;gap:8px">
          <button class="btn blue" type="submit">Generar código</button>
          <a class="btn ghost" href="/admin/whatsapp">Refrescar</a>
        </div>
      </form>
      ${st.connected ? "" : "<p class='muted' style='margin-top:8px'>En tu teléfono: Ajustes → Dispositivos vinculados → <b>Vincular con número de teléfono</b>.</p>"}
    </section>

    <section class="card">
      <h3 style="margin:8px 0">Prueba rápida</h3>
      <form method="post" action="/admin/whatsapp/test" class="grid2">
        <div>
          <label>Enviar a (solo dígitos)</label>
          <input class="input" required name="to" placeholder="Ej: 54911XXXXXXXX" value="${owner || ""}">
        </div>
        <div>
          <label>Mensaje</label>
          <input class="input" required name="text" placeholder="hola desde bot" value="Hola, prueba desde ${site}">
        </div>
        <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn ok" type="submit">Enviar</button>
        </div>
      </form>
    </section>

    <section class="card">
      <h3 style="margin:8px 0">Desvincular</h3>
      <form method="post" action="/admin/whatsapp/logout">
        <button class="btn red" type="submit">Cerrar sesión del bot</button>
      </form>
    </section>
  </div>

<script>
(function(){
  var modeBtn=document.getElementById('modeBtn');
  function applyMode(m){var light=(m==='light');document.body.classList.toggle('light',light);modeBtn.textContent=light?'☀️':'🌙';localStorage.setItem('ui:mode',light?'light':'dark')}
  applyMode(localStorage.getItem('ui:mode')||'dark');
  modeBtn.addEventListener('click',function(){applyMode(document.body.classList.contains('light')?'dark':'light')});
  var drawer=document.getElementById('drawer');var scrim=document.getElementById('scrim');var menuBtn=document.getElementById('menuBtn');
  function openDrawer(){drawer.classList.add('open');scrim.classList.add('show')}
  function closeDrawer(){drawer.classList.remove('open');scrim.classList.remove('show')}
  menuBtn.addEventListener('click',openDrawer);scrim.addEventListener('click',closeDrawer);
  window.addEventListener('keydown',function(e){if(e.key==='Escape')closeDrawer()});
  (function(){var path=location.pathname;document.querySelectorAll('#sidenav a').forEach(function(a){var re=new RegExp(a.getAttribute('data-match'));if(re.test(path))a.classList.add('active')})})();
})();
</script>
</body>
</html>`);
});

/* ===== Guardar número del dueño ===== */
router.post("/admin/whatsapp/owner", ensureAdmin, (req, res) => {
  try {
    const owner = normalizeDial(req.body.owner || "");
    if (!owner) return res.status(400).send(`Número inválido.<p><a href="/admin/whatsapp">Volver</a></p>`);
    setSetting("owner_whatsapp", owner);
    res.redirect("/admin/whatsapp");
  } catch (e) {
    res.status(500).send(`Error: ${e.message}<p><a href="/admin/whatsapp">Volver</a></p>`);
  }
});

/* ===== Vincular por código (pairing) ===== */
router.post("/admin/whatsapp/pair", ensureAdmin, async (req, res) => {
  const phoneDigits = normalizeDial(req.body.phone || "");
  if (!phoneDigits) return res.status(400).send(`<p>Número inválido.</p><p><a href="/admin/whatsapp">Volver</a></p>`);
  try {
    let code = await whatsapp.requestPairingCode(phoneDigits);
    if (code === null) {
      const st = await whatsapp.getStatus();
      return res.send(`<p>Ya está conectado como ${st.number}.</p><p><a href="/admin/whatsapp">Volver</a></p>`);
    }
    const pretty = String(code).match(/.{1,4}/g)?.join("-") || String(code);
    console.log("[WA] Código de vinculación:", pretty, "para", phoneDigits);
    res.send(`<p>Código generado: <b>${pretty}</b></p><p><a href="/admin/whatsapp">Volver</a></p>`);
  } catch (e) {
    res.status(500).send(`<p>Error: ${e.message}</p><p><a href="/admin/whatsapp">Volver</a></p>`);
  }
});

/* ===== Desvincular ===== */
router.post("/admin/whatsapp/logout", ensureAdmin, async (_req, res) => {
  try { await whatsapp.logout(); } catch {}
  res.redirect("/admin/whatsapp");
});

/* ===== Prueba rápida ===== */
router.post("/admin/whatsapp/test", ensureAdmin, async (req, res) => {
  try {
    const to = normalizeDial(req.body.to || "");
    const text = String(req.body.text || "Hola!");
    await whatsapp.sendText(to, text);
    res.send(`<p>Enviado a ${to}</p><p><a href="/admin/whatsapp">Volver</a></p>`);
  } catch (e) {
    res.status(500).send(`<p>Error: ${e.message}</p><p><a href="/admin/whatsapp">Volver</a></p>`);
  }
});

module.exports = router;