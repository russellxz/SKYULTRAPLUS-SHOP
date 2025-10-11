// admin_store.js — Resumen de la tienda (solo Admin) — ahora cuenta servicios activos/cancelados
"use strict";

const express = require("express");
const db = require("./db");

const router = express.Router();

/* ===== middleware ===== */
function ensureAdmin(req, res, next) {
  const u = req.session && req.session.user;
  if (!u) return res.redirect("/login");
  if (!u.is_admin) return res.redirect("/");
  next();
}

/* ===== schema defensivo (services) ===== */
function ensureSchema() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS services(
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      period_minutes INTEGER NOT NULL,
      next_invoice_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      canceled_at TEXT,
      UNIQUE(user_id, product_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `).run();
  try { db.prepare(`ALTER TABLE services ADD COLUMN canceled_at TEXT`).run(); } catch {}
}
ensureSchema();

/* ===== API: /admin/api/store/summary =====
   - ingresos totales (por moneda) de facturas pagadas
   - facturas pendientes (pending/unpaid/overdue)
   - servicios activos y cancelados (NO catálogo)
   - (opcional) catálogo: products.active=1/0 por si lo quieres mostrar luego
*/
router.get("/api/store/summary", ensureAdmin, (req, res) => {
  // Ingresos por moneda
  const totals = db.prepare(`
    SELECT currency, ROUND(COALESCE(SUM(amount),0),2) AS total
    FROM invoices
    WHERE status='paid'
    GROUP BY currency
  `).all();

  const revenue = {};
  for (const r of totals) revenue[r.currency] = Number(r.total || 0);

  // Facturas pendientes
  const pending = db.prepare(`
    SELECT COUNT(*) AS n
    FROM invoices
    WHERE status IN ('pending','unpaid','overdue')
  `).get()?.n || 0;

  // Servicios activos / cancelados (lo que realmente cambia con compras/cancelaciones)
  const servicesActive   = db.prepare(`SELECT COUNT(*) AS n FROM services WHERE status='active'`).get()?.n || 0;
  const servicesCanceled = db.prepare(`SELECT COUNT(*) AS n FROM services WHERE status='canceled'`).get()?.n || 0;

  // (Opcional: catálogo, por si luego lo quieres mostrar en otra tile)
  const productsActive  = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE active=1`).get()?.n || 0;
  const productsPaused  = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE active=0`).get()?.n || 0;

  res.json({
    revenue,
    pending: Number(pending),
    services_active: Number(servicesActive),
    services_canceled: Number(servicesCanceled),
    products_active_catalog: Number(productsActive),
    products_inactive_catalog: Number(productsPaused),
    ts: new Date().toISOString()
  });
});

/* ===== PAGE: /admin/store ===== (con el mismo menú que admin.js) */
router.get("/store", ensureAdmin, (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");

  res.type("html").send(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Admin · Resumen tienda</title>
<style>
  :root{
    --bg:#0b1220; --card:#111827; --txt:#e5e7eb; --muted:#9aa4b2; --line:#ffffff22;
    --accent:#ec4899; --accent2:#f472b6; --ok:#16a34a; --warn:#f59e0b; --err:#ef4444;
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
  .btn.pink{background:linear-gradient(90deg,var(--accent),var(--accent2));border:0}
  .btn.link{background:transparent;border:0;color:#60a5fa;text-decoration:underline;cursor:pointer}
  .btn[disabled]{opacity:.6;cursor:not-allowed}
  .wrap{max-width:1100px;margin:0 auto;padding:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px}

  /* Drawer (mismo de admin.js) */
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

  /* Tiles */
  .tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:10px}
  @media(max-width:780px){.tiles{grid-template-columns:1fr}}
  .tile{position:relative;background:linear-gradient(180deg,#1f2937,#111827);
        border:1px solid var(--line); border-radius:16px; padding:14px; overflow:hidden}
  .tile .k{font-size:28px;font-weight:900;letter-spacing:.2px}
  .tile .s{font-size:13px;color:var(--muted)}
  .tile .ico{position:absolute;right:12px;top:12px;opacity:.25}
  .tile .ico svg{width:36px;height:36px}
  .tile.warn{background:linear-gradient(180deg,#3b2f13,#1f2937)}
  .tile.ok{background:linear-gradient(180deg,#0b2a1a,#111827)}
  .tile.err{background:linear-gradient(180deg,#2a0b0b,#111827)}

  /* Modo claro bonito */
  body.light .tile{background:#fff;border-color:#00000012;color:#111;box-shadow:0 10px 25px rgba(0,0,0,.06)}
  body.light .tile .s{color:#667085}
  body.light .tile.warn{background:#fff7ed;color:#9a3412}
  body.light .tile.ok{background:#f0fdf4;color:#065f46}
  body.light .tile.err{background:#fef2f2;color:#7f1d1d}
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
      <a class="btn" style="background:#ef4444;border-color:#b91c1c" href="/logout">Salir</a>
    </div>
  </div>

  <!-- Drawer con el mismo menú de admin.js -->
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
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>

  <div class="wrap">
    <h2 style="margin:6px 0">Resumen de tu tienda</h2>
    <p class="muted">Métricas clave en tiempo real.</p>

    <section class="card">
      <div class="tiles">
        <div class="tile" id="tRevenue">
          <div class="k" id="revMain">$0.00</div>
          <div class="s" id="revSub">Ingresos Totales</div>
          <div class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a1 1 0 0 1 1 1v1.06c2.28.3 4 1.72 4 3.94 0 2.6-2.38 3.74-4.9 4.37-2.2.56-3.1 1-3.1 1.99 0 .8.72 1.42 2 1.64V17a1 1 0 1 1-2 0v-.96c-2.42-.4-4-1.96-4-4.04 0-2.63 2.38-3.76 4.9-4.39C12.1 7.06 13 6.6 13 5.6c0-.86-.76-1.44-2-1.66V3a1 1 0 0 1 1-1Z"/></svg>
          </div>
        </div>

        <div class="tile warn" id="tPending">
          <div class="k" id="penMain">0</div>
          <div class="s">Facturas Pendientes</div>
          <div class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2h10l3 4v13a3 3 0 0 1-3 3H7a3 3 0  0 1-3-3V5l3-3Zm8 7H9v2h6V9Zm0 4H9v2h6v-2Z"/></svg>
          </div>
        </div>

        <div class="tile ok" id="tActive">
          <div class="k" id="actMain">0</div>
          <div class="s">Servicios Activos</div>
          <div class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l9-5 9 5v10l-9 5-9-5V7Zm9 3 7-3.9V9l-7 3.9V10ZM5 9V6.1L12 10v2.9L5 9Zm7 5.1L19 10v2l-7 3.9V14.1Z"/></svg>
          </div>
        </div>

        <div class="tile err" id="tCanceled">
          <div class="k" id="canMain">0</div>
          <div class="s">Servicios Cancelados</div>
          <div class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 10.6 5.66-5.66 1.41 1.41L13.41 12l5.66 5.66-1.41 1.41L12 13.41l-5.66 5.66-1.41-1.41L10.59 12 4.93 6.34l1.41-1.41L12 10.59Z"/></svg>
          </div>
        </div>
      </div>

      <div class="row" style="margin-top:14px">
        <button id="refresh" class="btn pink" type="button">Actualizar</button>
        <a class="btn ghost" href="/admin/invoices">Ver facturas</a>
        <a class="btn ghost" href="/admin/products">Catálogo</a>
      </div>
    </section>
  </div>

<script>
(function(){
  /* ===== Tema ===== */
  var modeBtn = document.getElementById('modeBtn');
  function applyMode(m){
    var light = (m==='light');
    document.body.classList.toggle('light', light);
    modeBtn.textContent = light ? '☀️' : '🌙';
    localStorage.setItem('ui:mode', light ? 'light':'dark');
  }
  applyMode(localStorage.getItem('ui:mode') || 'dark');
  modeBtn.addEventListener('click', function(){
    applyMode(document.body.classList.contains('light') ? 'dark' : 'light');
  });

  /* ===== Drawer ===== */
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');
  var menuBtn = document.getElementById('menuBtn');
  function openDrawer(){ drawer.classList.add('open'); scrim.classList.add('show'); }
  function closeDrawer(){ drawer.classList.remove('open'); scrim.classList.remove('show'); }
  menuBtn.addEventListener('click', openDrawer);
  scrim.addEventListener('click', closeDrawer);
  window.addEventListener('keydown', function(e){ if(e.key==='Escape') closeDrawer(); });

  /* ===== Marca item activo del menú (igual que admin.js) ===== */
  (function(){
    var path = location.pathname;
    document.querySelectorAll('#sidenav a').forEach(function(a){
      var re = new RegExp(a.getAttribute('data-match'));
      if (re.test(path)) a.classList.add('active');
    });
  })();

  /* ===== Carga de métricas ===== */
  var revMain = document.getElementById('revMain');
  var revSub  = document.getElementById('revSub');
  var penMain = document.getElementById('penMain');
  var actMain = document.getElementById('actMain');
  var canMain = document.getElementById('canMain');
  var btn     = document.getElementById('refresh');

  function fmt(n){ return Number(n||0).toFixed(2); }

  async function loadSummary(){
    try{
      btn.disabled = true;
      var r = await fetch('/admin/api/store/summary', { cache:'no-store', credentials:'same-origin' });
      var data = await r.json();

      // Ingresos (si hay varias monedas, mostramos líneas)
      var parts = [];
      if (data.revenue && typeof data.revenue === 'object'){
        var keys = Object.keys(data.revenue);
        if (keys.length === 0){ parts.push('$0.00'); }
        for (var i=0;i<keys.length;i++){
          var k = keys[i];
          var sym = (k==='USD') ? '$' : (k==='MXN' ? 'MXN ' : (k+' '));
          parts.push(sym + fmt(data.revenue[k]));
        }
      }
      revMain.textContent = parts.join(' · ') || '$0.00';
      revSub.textContent  = 'Ingresos Totales';

      penMain.textContent = String(data.pending||0);
      actMain.textContent = String(data.services_active||0);
      canMain.textContent = String(data.services_canceled||0);
    }catch(e){
      revMain.textContent = '—';
      penMain.textContent = '—';
      actMain.textContent = '—';
      canMain.textContent = '—';
    }finally{
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', loadSummary);
  loadSummary();
  setInterval(loadSummary, 30000);
})();
</script>
</body>
</html>`);
});

module.exports = router;