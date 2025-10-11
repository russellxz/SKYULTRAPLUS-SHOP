// services.js — Mis servicios (activos/cancelados, ver info y cancelar) con encabezado unificado (perfil/facturas)
"use strict";

const express = require("express");
const db = require("./db");

const router = express.Router();

/* ==== body parser para este router (necesario para /services/cancel) ==== */
router.use(express.json());

/* ===== helpers ===== */
function ensureAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}
function esc(s){
  return String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

function ensureSchema() {
  // Tabla base (para instalaciones viejas)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS services(
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      period_minutes INTEGER NOT NULL,
      next_invoice_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT,
      canceled_at TEXT,
      UNIQUE(user_id, product_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `).run();

  // Columnas defensivas por si ya existía la tabla
  try { db.prepare(`ALTER TABLE services ADD COLUMN created_at  TEXT`).run(); } catch {}
  try { db.prepare(`ALTER TABLE services ADD COLUMN canceled_at TEXT`).run(); } catch {}
}
ensureSchema();

/* ===== GET /services ===== */
router.get("/services", ensureAuth, (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  const logo = db.getSetting("logo_url", "");
  const u = req.session.user;
  const isAdmin = !!u.is_admin;

  // avatar (igual a perfil/facturas)
  const avatarUrl = u.avatar_url ? esc(u.avatar_url) : "";
  const avatarLetter = esc((u.name || "?").charAt(0).toUpperCase());

  const rows = db.prepare(`
    SELECT
      s.id               AS service_id,
      s.user_id,
      s.product_id,
      s.period_minutes,
      s.next_invoice_at,
      s.status,
      s.canceled_at,
      p.name, p.description, p.image_path, p.price, p.currency,
      (SELECT MIN(created_at)
         FROM invoices i
        WHERE i.user_id = s.user_id
          AND (i.product_id = s.product_id OR i.service_id = s.id)) AS started_at
    FROM services s
    JOIN products p ON p.id = s.product_id
    WHERE s.user_id = ?
    ORDER BY s.id DESC
  `).all(u.id);

  const active   = rows.filter(r => (r.status || "active").toLowerCase() === "active");
  const canceled = rows.filter(r => (r.status || "active").toLowerCase() === "canceled");

  const cycle = (pm) => (
    pm === 3 ? "TEST · 3 min" :
    pm === 10080 ? "Semanal" :
    pm === 21600 ? "Cada 15 días" : "Mensual"
  );

  const card = (r, isCanceled) => {
    const started    = r.started_at      ? new Date(r.started_at).toLocaleString()      : "—";
    const nextAt     = r.next_invoice_at ? new Date(r.next_invoice_at).toLocaleString() : "—";
    const canceledAt = r.canceled_at     ? new Date(r.canceled_at).toLocaleString()     : "—";
    const badge      = isCanceled ? "gray" : "green";

    return `
    <article class="card">
      <div class="thumb">
        ${r.image_path ? `<img src="${esc(r.image_path)}" alt="${esc(r.name)}" class="pimg" loading="lazy">`
                       : `<div class="placeholder">🛒</div>`}
      </div>
      <div class="body">
        <div class="head">
          <h3 class="title" title="${esc(r.name)}">${esc(r.name)}</h3>
          <span class="status ${badge}">${isCanceled ? "Cancelado" : "Activo"}</span>
        </div>
        <div class="muted">${esc(r.description || "")}</div>
        <div class="row">
          <span class="chip">Ciclo: ${esc(cycle(Number(r.period_minutes || 43200)))}</span>
          <span class="chip">Precio: ${esc(r.currency)} ${Number(r.price).toFixed(2)}</span>
        </div>
        <div class="dates">
          <div><b>Activo desde:</b> ${esc(started)}</div>
          ${isCanceled
            ? `<div><b>Cancelado el:</b> ${esc(canceledAt)}</div>`
            : `<div><b>Próxima factura:</b> ${esc(nextAt)}</div>`}
        </div>
        <div class="actions">
          ${isCanceled
            ? `<span class="muted">Este servicio fue cancelado.</span>`
            : `
              <a class="btn ghost" href="/services/view/${r.product_id}">Ver producto</a>
              <button class="btn danger" data-cancel="${r.service_id}">
                Cancelar servicio
              </button>`}
        </div>
      </div>
    </article>`;
  };

  const gridActive   = active.map(r => card(r,false)).join("");
  const gridCanceled = canceled.map(r => card(r,true)).join("");

  const empty = `
    <div class="empty">
      <div class="empty-title">Sin servicios aún</div>
      <div class="empty-sub">Cuando compres un producto, aparecerá aquí para su gestión.</div>
      <a class="btn" href="/">← Volver al Dashboard</a>
    </div>`;

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site)} · Mis servicios</title>
<style>
  :root{
    --bg:#0b1220; --txt:#e5e7eb; --muted:#9ca3af; --card:#111827; --line:#ffffff15;
    --accent:#f43f5e; --accent2:#fb7185; --ok:#16a34a; --danger:#ef4444;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt);min-height:100vh;overflow-x:hidden;}

  /* Fondo oscuro: estrellas */
  .sky{ position:fixed; inset:0; pointer-events:none; z-index:0; overflow:hidden; }
  .star{ position:absolute; width:2px; height:2px; background:#fff; border-radius:50%; opacity:.9; animation: twinkle 3s linear infinite; }
  .shoot{ position:absolute; width:140px; height:2px; background:linear-gradient(90deg,#fff,transparent);
          transform:rotate(18deg); filter:drop-shadow(0 0 6px #ffffff55); animation: shoot 5.5s linear infinite; }
  @keyframes twinkle{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
  @keyframes shoot{0%{transform:translate(-10vw,-10vh) rotate(18deg)}100%{transform:translate(110vw,110vh) rotate(18deg)}}

  /* Modo claro: emojis flotando */
  body.light{ background:#ffffff; color:#0b1220; }
  .icons{ position:fixed; inset:0; z-index:0; pointer-events:none; display:none; }
  body.light .icons{ display:block; }
  .icons span{ position:absolute; font-size:34px; opacity:.24; filter:saturate(120%) drop-shadow(0 0 1px #00000010); animation: floatUp linear infinite; }
  @media(min-width:900px){ .icons span{ font-size:40px; } }
  @keyframes floatUp{ 0%{ transform:translateY(20vh); opacity:0 } 10%{opacity:.24} 90%{opacity:.24} 100%{ transform:translateY(-30vh); opacity:0 } }

  /* Top bar unificada */
  .top{ position:sticky; top:0; z-index:6; backdrop-filter:blur(8px);
        background:linear-gradient(#0b1220cc,#0b1220aa); border-bottom:1px solid var(--line); }
  body.light .top{ background:linear-gradient(#fff8,#fff6); }
  .nav{ max-width:1100px; margin:0 auto; padding:10px 16px; display:flex; align-items:center; gap:12px; }
  .brand{ display:flex; align-items:center; gap:10px; }
  .brand img{ width:36px; height:36px; border-radius:8px; object-fit:cover; ${logo ? '' : 'display:none;'} }
  .brand-name{ font-weight:900; letter-spacing:.2px; font-size:18px;
    background:linear-gradient(90deg,#ffffff,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent; }
  body.light .brand-name{ background:linear-gradient(90deg,#111,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent; }

  .quick{ display:flex; gap:8px; margin-left:6px; }
  .qbtn{ display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:999px; text-decoration:none; font-weight:700;
         background:linear-gradient(90deg,var(--accent),var(--accent2)); color:#fff; border:1px solid #ffffff22; }
  .qbtn svg{ width:16px; height:16px; }

  .grow{flex:1}
  .pill{ padding:8px 12px; border-radius:999px; background:#ffffff18; border:1px solid #ffffff28; color:inherit; text-decoration:none; cursor:pointer; }
  body.light .pill{ background:#00000010; border-color:#00000018; }

  /* Drawer + burger */
  .burger{width:40px;height:40px;display:grid;place-items:center;border-radius:10px;border:1px solid #334155;background:transparent;cursor:pointer}
  .burger span{width:20px;height:2px;background:currentColor;position:relative;display:block}
  .burger span:before,.burger span:after{content:"";position:absolute;left:0;right:0;height:2px;background:currentColor}
  .burger span:before{top:-6px} .burger span:after{top:6px}
  .drawer{position:fixed;inset:0 auto 0 0;width:300px;transform:translateX(-100%);transition:transform .22s ease;z-index:7}
  .drawer.open{transform:none}
  .drawer .panel{height:100%;background:rgba(17,25,40,.85);backdrop-filter:blur(10px);border-right:1px solid var(--line);padding:14px}
  body.light .drawer .panel{background:#fff}
  .scrim{position:fixed;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(1px);opacity:0;visibility:hidden;transition:.18s ease;z-index:6}
  .scrim.show{opacity:1;visibility:visible}
  .navlist a{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #334155;border-radius:10px;margin-bottom:8px;color:inherit;text-decoration:none}
  .navlist a:hover{border-color:#64748b}
  .navlist svg{width:18px;height:18px;opacity:.95}

  /* Avatar + dropdown */
  .avatar{ width:32px; height:32px; border-radius:50%; background:#64748b; color:#fff; display:grid; place-items:center; font-weight:700; overflow:hidden; }
  .avatar img{width:100%;height:100%;object-fit:cover;display:block}
  .udrop{ position:absolute; right:16px; top:60px; background:var(--card); border:1px solid var(--line); border-radius:12px;
          padding:10px; width:230px; box-shadow:0 10px 30px #0007; display:none; z-index:8 }
  body.light .udrop{ background:#fff; }
  .udrop a{ display:block; padding:8px 10px; border-radius:8px; color:inherit; text-decoration:none; }
  .udrop a:hover{ background:#ffffff12 } body.light .udrop a:hover{ background:#0000000a }

  /* Página */
  .wrap{ position:relative; z-index:1; max-width:1100px; margin:0 auto; padding:18px 16px 60px; }
  .title{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin:12px 0 8px; }
  .subtitle{ margin:18px 4px 8px; font-weight:800; opacity:.9 }
  .muted{ color:var(--muted) } body.light .muted{ color:#666 }

  .grid{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
  @media(max-width:900px){ .grid{ grid-template-columns:1fr; } }

  .card{ background:var(--card); border:1px solid var(--line); border-radius:16px; overflow:hidden; display:grid; grid-template-columns:240px 1fr; }
  @media(max-width:700px){ .card{ grid-template-columns:1fr; } }
  body.light .card{ background:#fff; }
  .thumb{ background:#0f172a; aspect-ratio:1; display:flex; align-items:center; justify-content:center; }
  .pimg{ width:100%; height:100%; object-fit:cover; display:block; }
  .placeholder{ font-size:48px; opacity:.5 }
  .body{ padding:12px; display:flex; flex-direction:column; gap:10px; }
  .head{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .title{ margin:0; font-size:20px; }
  .status{ padding:4px 8px; border-radius:999px; font-size:12px; border:1px solid #ffffff22; }
  .status.green{ background:#052e16; color:#a7f3d0; border-color:#14532d; }
  .status.gray{ background:#111827; color:#cbd5e1; border-color:#334155; }
  body.light .status.green{ background:#dcfce7; color:#065f46; border-color:#065f46; }
  body.light .status.gray{ background:#e5e7eb; color:#111827; border-color:#9ca3af; }

  .row{ display:flex; gap:8px; flex-wrap:wrap; }
  .chip{ display:inline-block; padding:6px 8px; border-radius:999px; border:1px solid #ffffff24; background:#0b1325; color:#cbd5e1; font-size:12px; }
  body.light .chip{ background:#f8fafc; color:#0b1220; border-color:#00000018; }
  .dates{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  @media(max-width:560px){ .dates{ grid-template-columns:1fr; } }

  .actions{ display:flex; gap:10px; flex-wrap:wrap; margin-top:auto; }
  .btn{ display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:10px 12px; border-radius:10px; color:#fff; text-decoration:none; border:0; cursor:pointer;
        background:linear-gradient(90deg,var(--accent),var(--accent2)); font-weight:700; }
  .btn.ghost{ background:#ffffff18; border:1px solid #ffffff28; color:inherit; }
  body.light .btn.ghost{ background:#00000010; border-color:#00000018; }
  .btn.danger{ background:linear-gradient(90deg,#ef4444,#f97316); }
  .btn[disabled]{ opacity:.6; cursor:not-allowed; }

  .empty{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:24px; text-align:center; }
  .empty-title{ font-weight:800; font-size:18px; margin-bottom:6px; }
  .empty-sub{ color:#9ca3af; margin-bottom:12px; }
</style>
<body>
  <div class="sky" id="sky"></div>
  <div class="icons" id="icons"></div>

  <!-- Drawer -->
  <div class="drawer" id="drawer">
    <div class="panel">
      <h3 style="margin:0 0 10px">Menú</h3>
      <nav class="navlist">
        <a href="/"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3 1 8h2v5h4V9h2v4h4V8h2L8 3z"/></svg>Inicio</a>
        <a href="/invoices"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>Mis facturas</a>
        <a href="/services"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>Mis servicios</a>
        ${isAdmin ? `<a href="/admin"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M7 1h2l1 3h3l-2 2 1 3-3-1-2 2-2-2-3 1 1-3L1 4h3l1-3z"/></svg>Admin</a>` : ``}
        <a href="/logout"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h3v2H6v8h3v2H4V2h2zm7 6-3-3v2H7v2h3v2l3-3z"/></svg>Salir</a>
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>

  <header class="top">
    <nav class="nav">
      <button id="menuBtn" class="burger" aria-label="Abrir menú"><span></span></button>
      <div class="brand">
        ${logo ? `<img src="${esc(logo)}" alt="logo">` : ``}
        <div class="brand-name">${esc(site)}</div>
        <div class="quick">
          <a class="qbtn" href="/"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3 1 8h2v5h4V9h2v4h4V8h2L8 3z"/></svg>Inicio</a>
          <a class="qbtn" href="/invoices"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>Facturas</a>
          <a class="qbtn" href="/services"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>Servicios</a>
        </div>
      </div>
      <div class="grow"></div>
      <button id="mode" class="pill" type="button" aria-label="Cambiar tema">🌙</button>
      <div id="ua" class="pill" style="display:flex;gap:8px;align-items:center;position:relative;cursor:pointer">
        <div class="avatar">${avatarUrl ? `<img src="${avatarUrl}" alt="avatar">` : `${avatarLetter}`}</div>
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
  </header>

  <main class="wrap">
    <div class="title">
      <h2 style="margin:0">Mis servicios</h2>
      <span class="muted">Administra tus compras y renovaciones.</span>
    </div>

    ${rows.length ? '' : `${empty}`}

    ${active.length ? `<h3 class="subtitle">Servicios activos</h3>
      <section class="grid" aria-label="Activos">${gridActive}</section>` : ''}

    ${canceled.length ? `<h3 class="subtitle">Productos cancelados</h3>
      <section class="grid" aria-label="Cancelados">${gridCanceled}</section>` : ''}

  </main>

<script>
  // Drawer
  (function(){
    const drawer = document.getElementById('drawer');
    const scrim  = document.getElementById('scrim');
    const btn    = document.getElementById('menuBtn');
    function open(){ drawer.classList.add('open'); scrim.classList.add('show'); }
    function close(){ drawer.classList.remove('open'); scrim.classList.remove('show'); }
    btn?.addEventListener('click', open);
    scrim?.addEventListener('click', close);
    window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });
  })();

  // Estrellas (oscuro)
  (function(){
    const sky = document.getElementById('sky');
    for(let i=0;i<90;i++){
      const s = document.createElement('div');
      s.className = 'star';
      s.style.top  = (Math.random()*100).toFixed(2)+'%';
      s.style.left = (Math.random()*100).toFixed(2)+'%';
      s.style.opacity = (0.35 + Math.random()*0.65).toFixed(2);
      s.style.transform = 'scale(' + (0.6 + Math.random()*1.6).toFixed(2) + ')';
      s.style.animationDelay = (Math.random()*3).toFixed(2)+'s';
      sky.appendChild(s);
    }
    for(let i=0;i<2;i++){
      const sh = document.createElement('div');
      sh.className = 'shoot';
      sh.style.top  = (Math.random()*25).toFixed(2)+'%';
      sh.style.left = (Math.random()*60).toFixed(2)+'%';
      sh.style.animationDelay = (1 + Math.random()*5).toFixed(2)+'s';
      sky.appendChild(sh);
    }
  })();

  // Emojis flotantes (claro)
  (function(){
    const icons = document.getElementById('icons');
    const set = ['🎵','🎬','🎮','📷','🎧','📱','💾','🛒','📺','📀','💡','🚀'];
    for(let i=0;i<24;i++){
      const sp = document.createElement('span');
      sp.textContent = set[i % set.length];
      sp.style.left = (Math.random()*100).toFixed(2)+'%';
      sp.style.top  = (Math.random()*100).toFixed(2)+'%';
      sp.style.animationDuration = (20 + Math.random()*18).toFixed(1)+'s';
      sp.style.animationDelay    = (Math.random()*8).toFixed(1)+'s';
      icons.appendChild(sp);
    }
  })();

  // Tema 🌙/☀️
  (function(){
    const btn   = document.getElementById('mode');
    const sky   = document.getElementById('sky');
    const icons = document.getElementById('icons');
    function apply(mode){
      const light = (mode==='light');
      document.body.classList.toggle('light', light);
      sky.style.display   = light ? 'none'  : 'block';
      icons.style.display = light ? 'block' : 'none';
      btn.textContent = light ? '☀️' : '🌙';
      localStorage.setItem('mode', light ? 'light' : 'dark');
    }
    apply(localStorage.getItem('mode') || 'dark');
    btn.addEventListener('click', ()=> apply(document.body.classList.contains('light')?'dark':'light'));
  })();

  // Dropdown usuario
  (function(){
    const a = document.getElementById('ua');
    const d = document.getElementById('udrop');
    let open = false;
    a.addEventListener('click', (e)=>{ e.stopPropagation(); open=!open; d.style.display = open? 'block':'none'; });
    document.addEventListener('click', ()=>{ if(open){ open=false; d.style.display='none'; }});
  })();

  // Cancelar servicio (listener + fetch con JSON)
  (function(){
    document.addEventListener('click', async (e)=>{
      const btn = e.target.closest('button[data-cancel]');
      if (!btn) return;
      const id = Number(btn.getAttribute('data-cancel') || 0);
      if (!id) return;
      if (!confirm('¿Seguro que quieres cancelar este servicio? Se eliminarán TODAS las facturas de este producto y pasará a cancelados.')) return;
      btn.disabled = true;
      try{
        const r = await fetch('/services/cancel', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          credentials:'same-origin',
          body: JSON.stringify({ service_id:id })
        });
        const t = await r.text();
        if (t !== 'OK') { alert(t); btn.disabled=false; return; }
        location.reload();
      }catch(err){
        alert('Error: '+err.message); btn.disabled=false;
      }
    });
  })();
</script>
</body>
</html>`);
});

/* ===== GET /services/view/:pid =====
   SOLO permite ver la info si el servicio está ACTIVO (con modo claro/oscuro + encabezado unificado) */
router.get("/services/view/:pid", ensureAuth, (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  const logo = db.getSetting("logo_url", "");
  const u = req.session.user;
  const uid  = u.id;
  const pid  = Number(req.params.pid || 0);
  const isAdmin = !!u.is_admin;
  const avatarUrl = u.avatar_url ? esc(u.avatar_url) : "";
  const avatarLetter = esc((u.name || "?").charAt(0).toUpperCase());

  const row = db.prepare(`
    SELECT s.status, s.period_minutes, s.next_invoice_at,
           p.name, p.description, p.image_path, p.price, p.currency, p.reveal_info,
           (SELECT MIN(created_at) FROM invoices i
             WHERE i.user_id=s.user_id AND (i.product_id=s.product_id OR i.service_id=s.id)) AS started_at
    FROM services s
    JOIN products p ON p.id = s.product_id
    WHERE s.user_id=? AND s.product_id=? LIMIT 1
  `).get(uid, pid);

  if (!row) return res.status(404).type("text/plain").send("Servicio no encontrado para este producto.");

  const status = (row.status || "active").toLowerCase();
  if (status === "canceled") {
    // Bloqueamos la vista de info si está cancelado (manteniendo encabezado unificado)
    return res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(row.name)} · Cancelado</title>
<style>
  :root{ --bg:#0b1220; --txt:#e5e7eb; --line:#ffffff22; --card:#111827; --muted:#9ca3af; --accent:#f43f5e; --accent2:#fb7185; }
  *{box-sizing:border-box} body{margin:0;font-family:system-ui;background:var(--bg);color:var(--txt);min-height:100vh;overflow-x:hidden}
  .wrap{max-width:760px;margin:0 auto;padding:20px 16px}
  .card{background:#111827;border:1px solid var(--line);border-radius:14px;padding:16px}
  body.light{background:#fff;color:#0b1220}
  .pill{padding:8px 12px;border-radius:999px;background:#ffffff18;border:1px solid #ffffff28;color:inherit;text-decoration:none;cursor:pointer}
  body.light .pill{background:#00000010;border-color:#00000018}

  /* Encabezado igual */
  .top{position:sticky;top:0;z-index:6;backdrop-filter:blur(8px);background:linear-gradient(#0b1220cc,#0b1220aa);border-bottom:1px solid var(--line)}
  body.light .top{background:linear-gradient(#fff8,#fff6)}
  .nav{max-width:1100px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px}
  .brand{display:flex;align-items:center;gap:10px}
  .brand img{width:36px;height:36px;border-radius:8px;object-fit:cover;${logo ? '' : 'display:none;'}}
  .brand-name{font-weight:900;letter-spacing:.2px;font-size:18px;background:linear-gradient(90deg,#ffffff,#ef4444);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
  body.light .brand-name{background:linear-gradient(90deg,#111,#ef4444);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
  .quick{display:flex;gap:8px;margin-left:6px}
  .qbtn{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;text-decoration:none;font-weight:700;background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff;border:1px solid #ffffff22}
  .qbtn svg{width:16px;height:16px}
  .grow{flex:1}
  .avatar{width:32px;height:32px;border-radius:50%;background:#64748b;color:#fff;display:grid;place-items:center;font-weight:700;overflow:hidden}
  .avatar img{width:100%;height:100%;object-fit:cover;display:block}
  .udrop{position:absolute;right:16px;top:60px;background:#111827;border:1px solid var(--line);border-radius:12px;padding:10px;width:230px;box-shadow:0 10px 30px #0007;display:none;z-index:8}
  body.light .udrop{background:#fff}
  .udrop a{display:block;padding:8px 10px;border-radius:8px;color:inherit;text-decoration:none}
  .udrop a:hover{background:#ffffff12} body.light .udrop a:hover{background:#0000000a}
</style>
<body>
  <header class="top">
    <nav class="nav">
      <div class="brand">
        ${logo ? `<img src="${esc(logo)}" alt="logo">` : ``}
        <div class="brand-name">${esc(site)}</div>
        <div class="quick">
          <a class="qbtn" href="/">Inicio</a>
          <a class="qbtn" href="/invoices">Facturas</a>
          <a class="qbtn" href="/services">Servicios</a>
        </div>
      </div>
      <div class="grow"></div>
      <a class="pill" href="/services">← Mis servicios</a>
    </nav>
  </header>
  <div class="wrap">
    <div class="card">
      <h2 style="margin:0 0 8px">Producto cancelado</h2>
      <p style="margin:0 0 6px">Este servicio fue cancelado. La información del producto ya no está disponible.</p>
      <p style="margin:0"><a class="pill" href="/services">← Volver a Mis servicios</a></p>
    </div>
  </div>
</body>
</html>`);
  }

  const started = row.started_at ? new Date(row.started_at).toLocaleString() : "—";
  const nextAt  = row.next_invoice_at ? new Date(row.next_invoice_at).toLocaleString() : "—";
  const cycle = (pm) => (
    pm === 3 ? "TEST · 3 min" :
    pm === 10080 ? "Semanal" :
    pm === 21600 ? "Cada 15 días" : "Mensual"
  );

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site)} · ${esc(row.name)}</title>
<style>
  :root{ --bg:#0b1220; --txt:#e5e7eb; --line:#ffffff22; --card:#111827; --muted:#9ca3af; --accent:#f43f5e; --accent2:#fb7185; }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui;background:var(--bg);color:var(--txt);min-height:100vh;overflow-x:hidden}
  .sky{ position:fixed; inset:0; pointer-events:none; z-index:0; overflow:hidden; }
  .star{ position:absolute; width:2px; height:2px; background:#fff; border-radius:50%; opacity:.9; animation: twinkle 3s linear infinite; }
  .shoot{ position:absolute; width:140px; height:2px; background:linear-gradient(90deg,#fff,transparent);
          transform:rotate(18deg); filter:drop-shadow(0 0 6px #ffffff55); animation: shoot 5.5s linear infinite; }
  @keyframes twinkle{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
  @keyframes shoot{0%{transform:translate(-10vw,-10vh) rotate(18deg)}100%{transform:translate(110vw,110vh) rotate(18deg)}}
  body.light{ background:#fff; color:#0b1220 }
  .icons{ position:fixed; inset:0; z-index:0; pointer-events:none; display:none; }
  body.light .icons{ display:block; }
  .icons span{ position:absolute; font-size:34px; opacity:.24; animation: floatUp linear infinite; }
  @keyframes floatUp{ 0%{ transform:translateY(20vh); opacity:0 } 10%{opacity:.24} 90%{opacity:.24} 100%{ transform:translateY(-30vh); opacity:0 } }

  /* Top unificado */
  .top{ position:sticky; top:0; z-index:6; backdrop-filter:blur(8px);
        background:linear-gradient(#0b1220cc,#0b1220aa); border-bottom:1px solid var(--line); }
  body.light .top{ background:linear-gradient(#fff8,#fff6); }
  .nav{ max-width:1000px; margin:0 auto; padding:10px 16px; display:flex; align-items:center; gap:12px; }
  .brand{ display:flex; align-items:center; gap:10px; }
  .brand img{ width:36px; height:36px; border-radius:8px; object-fit:cover; ${logo ? '' : 'display:none;'} }
  .brand-name{ font-weight:900; letter-spacing:.2px; font-size:18px;
    background:linear-gradient(90deg,#ffffff,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent; }
  body.light .brand-name{ background:linear-gradient(90deg,#111,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent; }
  .quick{display:flex;gap:8px;margin-left:6px}
  .qbtn{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;text-decoration:none;font-weight:700;background:linear-gradient(90deg,#f43f5e,#fb7185);color:#fff;border:1px solid #ffffff22}
  .qbtn svg{width:16px;height:16px}
  .grow{flex:1}
  .pill{ padding:8px 12px; border-radius:999px; background:#ffffff18; border:1px solid #ffffff28; color:inherit; text-decoration:none; cursor:pointer; }
  body.light .pill{ background:#00000010; border-color:#00000018; }
  .avatar{ width:32px; height:32px; border-radius:50%; background:#64748b; color:#fff; display:grid; place-items:center; font-weight:700; overflow:hidden; }
  .avatar img{width:100%;height:100%;object-fit:cover;display:block}
  .udrop{ position:absolute; right:16px; top:60px; background:#111827; border:1px solid var(--line); border-radius:12px; padding:10px; width:230px; box-shadow:0 10px 30px #0007; display:none; z-index:8 }
  body.light .udrop{ background:#fff; }
  .udrop a{ display:block; padding:8px 10px; border-radius:8px; color:inherit; text-decoration:none; }
  .udrop a:hover{ background:#ffffff12 } body.light .udrop a:hover{ background:#0000000a }

  .wrap{ position:relative; z-index:1; max-width:1000px; margin:0 auto; padding:18px 16px 60px; }
  .grid{ display:grid; grid-template-columns:320px 1fr; gap:16px; }
  @media(max-width:860px){ .grid{ grid-template-columns:1fr; } }
  .card{ background:#111827; border:1px solid var(--line); border-radius:16px; padding:14px; }
  body.light .card{ background:#fff; }
  .img{ width:100%; aspect-ratio:1; object-fit:cover; border-radius:12px; background:#0f172a; }
  .title{ margin:0 0 6px; font-size:24px; }
  .muted{ opacity:.85 }
  .chip{ display:inline-block; padding:6px 8px; border-radius:999px; border:1px solid #ffffff24; background:#0b1325; color:#cbd5e1; font-size:12px; }
  body.light .chip{ background:#f8fafc; color:#0b1220; border-color:#00000018; }
  .btn{ display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:10px 12px; border-radius:10px; color:#fff; text-decoration:none;
        background:linear-gradient(90deg,#f43f5e,#fb7185); font-weight:700; }
</style>
<body>
  <header class="top">
    <nav class="nav">
      <div class="brand">
        ${logo ? `<img src="${esc(logo)}" alt="logo">` : ``}
        <div class="brand-name">${esc(site)}</div>
        <div class="quick">
          <a class="qbtn" href="/">Inicio</a>
          <a class="qbtn" href="/invoices">Facturas</a>
          <a class="qbtn" href="/services">Servicios</a>
        </div>
      </div>
      <div class="grow"></div>
      <button id="mode" class="pill" type="button" aria-label="Cambiar tema">🌙</button>
      <div id="ua" class="pill" style="display:flex;gap:8px;align-items:center;position:relative;cursor:pointer">
        <div class="avatar">${avatarUrl ? `<img src="${avatarUrl}" alt="avatar">` : `${avatarLetter}`}</div>
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
  </header>

  <main class="wrap">
    <div class="grid">
      <div class="card">
        ${row.image_path ? `<img class="img" src="${esc(row.image_path)}" alt="${esc(row.name)}">` : `<div class="img" style="display:grid;place-items:center;font-size:40px">🛒</div>`}
      </div>
      <section class="card">
        <h1 class="title">${esc(row.name)}</h1>
        <div class="muted" style="margin-bottom:8px">${esc(row.description || "")}</div>
        <div class="muted" style="margin:6px 0 10px">
          <span class="chip">Ciclo: ${esc(cycle(Number(row.period_minutes||43200)))}</span>
          <span class="chip">Precio: ${esc(row.currency)} ${Number(row.price).toFixed(2)}</span>
          <span class="chip">Estado: Activo</span>
        </div>
        <div class="muted" style="margin:0 0 12px">
          <div><b>Activo desde:</b> ${esc(started)}</div>
          <div><b>Próxima factura:</b> ${esc(nextAt)}</div>
        </div>

        <h3 style="margin:0 0 6px">Información del producto</h3>
        <pre style="white-space:pre-wrap;background:#0b1325;color:#cbd5e1;border:1px solid #ffffff24;padding:12px;border-radius:12px">${esc(row.reveal_info || "—")}</pre>

        <div style="margin-top:12px"><a class="btn" href="/services">← Volver a Mis servicios</a></div>
      </section>
    </div>
  </main>

<script>
  // Tema + dropdown (mismo comportamiento)
  (function(){
    const btn=document.getElementById('mode');
    function apply(mode){
      const light=(mode==='light');
      document.body.classList.toggle('light',light);
      btn.textContent = light ? '☀️' : '🌙';
      localStorage.setItem('mode', light ? 'light' : 'dark');
    }
    apply(localStorage.getItem('mode') || 'dark');
    btn.addEventListener('click', ()=> apply(document.body.classList.contains('light')?'dark':'light'));
  })();
  (function(){
    const a = document.getElementById('ua');
    const d = document.getElementById('udrop');
    let open = false;
    a?.addEventListener('click', (e)=>{ e.stopPropagation(); open=!open; d.style.display = open? 'block':'none'; });
    document.addEventListener('click', ()=>{ if(open){ open=false; d.style.display='none'; }});
  })();
</script>
</body>
</html>`);
});

/* ===== POST /services/cancel =====
   Marca el servicio como 'canceled' y borra TODAS sus facturas (NO tocamos next_invoice_at para evitar NOT NULL).
*/
router.post("/services/cancel", ensureAuth, (req, res) => {
  const uid = req.session.user.id;
  const service_id = Number(req.body?.service_id || 0);
  if (!service_id) return res.status(400).send("Falta service_id");

  const svc = db.prepare(`SELECT id, user_id, product_id, status FROM services WHERE id=?`).get(service_id);
  if (!svc || svc.user_id !== uid) return res.status(404).send("Servicio no encontrado");

  try{
    const tx = db.transaction(() => {
      // Marcar cancelado con timestamp
      db.prepare(`UPDATE services SET status='canceled', canceled_at=? WHERE id=?`)
        .run(new Date().toISOString(), service_id);

      // Borrar todas las facturas asociadas a este producto/servicio del usuario
      db.prepare(`DELETE FROM invoices WHERE user_id=? AND (service_id=? OR product_id=?)`)
        .run(uid, service_id, svc.product_id);
    });
    tx();
    res.send("OK");
  }catch(e){
    res.status(500).send("ERR: " + (e?.message || "cancel"));
  }
});

module.exports = router;