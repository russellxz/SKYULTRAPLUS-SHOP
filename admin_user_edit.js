// admin_user_edit.js — Editor de usuario para admin (oscuro/claro + menú lateral)
// - Ver/editar: nombre, apellido, usuario, correo, password
// - Ver: avatar, teléfono
// - Listar: productos activos/cancelados, facturas pagadas/pendientes (schema-agnóstico)
"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("./db");

const router = express.Router();

/* ───────── Helpers ───────── */
function ensureAdmin(req, res, next){
  const u = req.session && req.session.user;
  if (!u) return res.redirect("/login");
  if (!u.is_admin) return res.redirect("/");
  next();
}
function esc(s){
  return String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}
function tableExists(name){
  try{
    return !!db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name);
  }catch{ return false; }
}
function getColumns(name){
  try{
    return db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name);
  }catch{ return []; }
}

/* ───────── PAGE: /admin/users/:id/edit ───────── */
router.get("/users/:id/edit", ensureAdmin, (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  const uid = Number(req.params.id || 0);
  const u = db.prepare(`
    SELECT id, username, email, name, surname, phone, avatar_url, created_at
    FROM users WHERE id=?
  `).get(uid);

  if (!u) return res.status(404).type("text/plain").send("Usuario no encontrado");

  res.type("html").send(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(site)} · Admin · Editar @${esc(u.username)}</title>
<style>
  :root{
    --bg:#0b1220; --card:#111827; --txt:#e5e7eb; --muted:#9aa4b2; --line:#ffffff22;
    --accent:#2563eb; --danger:#ef4444; --ok:#16a34a;
  }
  *{box-sizing:border-box}
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

  .wrap{max-width:1200px;margin:0 auto;padding:14px}
  .grid{display:grid;grid-template-columns:2fr 1.6fr;gap:14px}
  @media(max-width:960px){ .grid{grid-template-columns:1fr} }
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
  .muted{color:var(--muted)}
  .label{font-size:12px;color:var(--muted);margin:4px 0}
  .input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:inherit}
  body.light .input{background:#fff;border-color:#00000022}
  .roww{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .full{grid-column:1/-1}
  .avatar{width:86px;height:86px;border-radius:50%;background:#374151;display:grid;place-items:center;font-weight:900;font-size:28px;overflow:hidden;color:#fff}
  .avatar img{width:100%;height:100%;object-fit:cover;display:block}
  .list{display:flex;flex-direction:column;gap:8px}
  .item{display:flex;justify-content:space-between;gap:10px;padding:10px;border:1px solid var(--line);border-radius:12px;background:#0f172a}
  body.light .item{background:#fff}
  .pill{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;border:1px solid #ffffff22;background:#ffffff15}
  body.light .pill{background:#00000010;border-color:#00000018}
  .right{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
  .small{font-size:12px}
</style>
</head>
<body>
  <div class="topbar">
    <div class="row">
      <button id="menuBtn" class="burger" aria-label="Abrir menú"><span></span></button>
      <div class="brand">${esc(site)} · Admin · Editar usuario</div>
    </div>
    <div class="row">
      <button id="modeBtn" class="btn ghost" type="button">🌙</button>
      <a class="btn ghost" href="/admin">← Volver a usuarios</a>
      <a class="btn red" href="/logout">Salir</a>
    </div>
  </div>

  <div class="drawer" id="drawer">
    <div class="panel">
      <h3 style="margin:0 0 10px">Menú</h3>
      <nav class="nav" id="sidenav">
        <a href="/admin" data-match="^/admin/?$">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7v-1a5 5 0 0 1 10 0v1H3z"/></svg>
          Usuarios
        </a>
        <a href="/admin/mail" data-match="^/admin/mail">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3h13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 14.5 13h-13A1.5 1.5 0  0 1 0 11.5v-7A1.5 1.5 0 0 1 1.5 3Zm.5 1.8 6 3.7 6-3.7V5L8 8.7 2 5v-.2Z"/></svg>
          Correo (SMTP)
        </a>
        <a href="/admin/brand" data-match="^/admin/brand">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm1 8h10l-3.2-4-2.3 3L6 8 3 11Zm6-6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>
          Logo y nombre
        </a>
        <a href="/admin/store" data-match="^/admin/store">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>
          Resumen tienda
        </a>
        <a href="/admin/products" data-match="^/admin/products">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 4.5 8 1l6 3.5V12l-6 3.5L2 12V4.5Zm6 1L4 3.3v2.9l4 2.3 4-2.3V3.3L8 5.5Z"/></svg>
          Productos
        </a>
        <a href="/admin/invoices" data-match="^/admin/invoices">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>
          Facturas
        </a>
        <a href="/admin/tickets" data-match="^/admin/tickets">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0-1 1 1 1 0 0 0 1 1v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a1 1 0 0 0 1-1 1 1 0 0 0-1-1V5Z"/></svg>
          Tickets
        </a>
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>

  <div class="wrap">
    <div class="grid">
      <!-- Columna izquierda: datos -->
      <section class="card">
        <h3 style="margin:4px 0 12px">Datos del usuario</h3>
        <div class="row" style="display:flex;gap:12px;align-items:center;margin-bottom:10px">
          <div class="avatar" id="ava">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="avatar">` : esc((u.name||"?").charAt(0).toUpperCase())}</div>
          <div>
            <div style="font-weight:900">@${esc(u.username)}</div>
            <div class="small muted">ID ${u.id} · ${esc((u.created_at||"").toString())}</div>
          </div>
        </div>

        <div class="roww">
          <div>
            <div class="label">Nombre</div>
            <input id="name" class="input" value="${esc(u.name||"")}">
          </div>
          <div>
            <div class="label">Apellido</div>
            <input id="surname" class="input" value="${esc(u.surname||"")}">
          </div>
          <div>
            <div class="label">Usuario</div>
            <input id="username" class="input" value="${esc(u.username||"")}">
          </div>
          <div>
            <div class="label">Correo</div>
            <input id="email" class="input" type="email" value="${esc(u.email||"")}">
          </div>
          <div class="full">
            <div class="label">Teléfono (solo lectura)</div>
            <input class="input" value="${esc(u.phone || "")}" readonly>
          </div>

          <div class="full"><hr style="border:0;border-top:1px solid var(--line)"></div>

          <div>
            <div class="label">Nueva contraseña</div>
            <input id="pw1" class="input" type="password" placeholder="••••••">
          </div>
          <div>
            <div class="label">Repite la contraseña</div>
            <input id="pw2" class="input" type="password" placeholder="••••••">
          </div>

          <div class="full right">
            <button id="saveBtn" class="btn ok" type="button">Guardar cambios</button>
          </div>
          <div id="msg" class="full small"></div>
        </div>
      </section>

      <!-- Columna derecha: listados -->
      <section class="card">
        <h3 style="margin:4px 0 12px">Resumen</h3>
        <div class="list">
          <div class="item">
            <div><b>Productos activos</b></div>
            <div id="countActive" class="pill">—</div>
          </div>
          <div class="item">
            <div><b>Productos cancelados</b></div>
            <div id="countCancelled" class="pill">—</div>
          </div>
          <div class="item">
            <div><b>Facturas pagadas</b></div>
            <div id="countPaid" class="pill">—</div>
          </div>
          <div class="item">
            <div><b>Facturas pendientes</b></div>
            <div id="countPending" class="pill">—</div>
          </div>
        </div>

        <div style="height:10px"></div>
        <div class="small muted">Listados</div>
        <div class="right" style="margin-top:8px">
          <a class="btn blue" href="#" id="seeInvoices">Ver facturas</a>
          <a class="btn blue" href="#" id="seeServices">Ver productos</a>
        </div>

        <div id="lists" style="margin-top:10px"></div>
      </section>
    </div>
  </div>

<script>
(function(){
  /* ===== Tema (persistente) ===== */
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
  var drawer=document.getElementById('drawer'), scrim=document.getElementById('scrim'), menuBtn=document.getElementById('menuBtn');
  function openDrawer(){ drawer.classList.add('open'); scrim.classList.add('show'); }
  function closeDrawer(){ drawer.classList.remove('open'); scrim.classList.remove('show'); }
  menuBtn.addEventListener('click', openDrawer); scrim.addEventListener('click', closeDrawer);
  window.addEventListener('keydown', function(e){ if(e.key==='Escape') closeDrawer(); });

  /* ===== Marca item activo del menú ===== */
  (function(){
    var path = location.pathname;
    document.querySelectorAll('#sidenav a').forEach(function(a){
      var re = new RegExp(a.getAttribute('data-match'));
      if (re.test(path)) a.classList.add('active');
    });
  })();

  /* ===== Guardar cambios ===== */
  const msg = document.getElementById('msg');
  document.getElementById('saveBtn').addEventListener('click', async ()=>{
    msg.textContent='';
    const payload = {
      name: document.getElementById('name').value.trim(),
      surname: document.getElementById('surname').value.trim(),
      username: document.getElementById('username').value.trim(),
      email: document.getElementById('email').value.trim(),
      pw1: document.getElementById('pw1').value,
      pw2: document.getElementById('pw2').value
    };
    try{
      const r = await fetch(location.pathname.replace(/\\/edit$/, '')+'/update', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
      });
      const data = await r.json();
      if(!r.ok || !data.ok){ msg.innerHTML = '<span style="color:#ef4444">'+(data.error||('Error '+r.status))+'</span>'; return; }
      msg.innerHTML = '<span style="color:#16a34a">Cambios guardados.</span>';
      document.getElementById('pw1').value = '';
      document.getElementById('pw2').value = '';
    }catch(e){
      msg.innerHTML = '<span style="color:#ef4444">Error: '+(e.message||e)+'</span>';
    }
  });

  /* ===== Cargar conteos + listados ===== */
  async function loadCounts(){
    try{
      const r = await fetch(location.pathname.replace(/\\/edit$/, '')+'/counts', {cache:'no-store'});
      const d = await r.json();
      document.getElementById('countActive').textContent    = d.active ?? '0';
      document.getElementById('countCancelled').textContent = d.cancelled ?? '0';
      document.getElementById('countPaid').textContent      = d.paid ?? '0';
      document.getElementById('countPending').textContent   = d.pending ?? '0';
    }catch{}
  }
  loadCounts();

  const lists = document.getElementById('lists');

  document.getElementById('seeInvoices').addEventListener('click', async (e)=>{
    e.preventDefault();
    lists.innerHTML = '<div class="muted small">Cargando facturas…</div>';
    const r = await fetch(location.pathname.replace(/\\/edit$/, '')+'/invoices');
    const d = await r.json();
    function row(ix){ return '<div class="item"><div>#'+ix.id+' · '+(ix.currency||'')+' '+(Number(ix.amount||0).toFixed(2))+'</div><div class="pill small">'+(ix.status||'')+'</div></div>'; }
    lists.innerHTML = '<h4>Facturas</h4>'+ (d.all && d.all.length ? d.all.map(row).join('') : '<div class="muted">Sin facturas</div>');
  });

  document.getElementById('seeServices').addEventListener('click', async (e)=>{
    e.preventDefault();
    lists.innerHTML = '<div class="muted small">Cargando productos…</div>';
    const r = await fetch(location.pathname.replace(/\\/edit$/, '')+'/services');
    const d = await r.json();
    function row(s){ return '<div class="item"><div>#'+s.id+' · '+(s.name||'Producto')+'</div><div class="pill small">'+(s.status||'')+'</div></div>'; }
    lists.innerHTML = '<h4>Productos</h4>'
        + (d.active && d.active.length ? '<div class="small muted" style="margin:6px 0">Activos</div>'+d.active.map(row).join('') : '')
        + (d.cancelled && d.cancelled.length ? '<div class="small muted" style="margin:10px 0 4px">Cancelados</div>'+d.cancelled.map(row).join('') : (d.active && d.active.length ? '' : '<div class="muted">Sin productos</div>'));
  });
})();
</script>
</body>
</html>`);
});

/* ───────── API: update (nombre, apellido, usuario, correo, password opcional) ───────── */
router.post("/users/:id/update", ensureAdmin, express.json({limit:"2mb"}), (req, res) => {
  try{
    const id = Number(req.params.id || 0);
    const name = String(req.body?.name || "").trim();
    const surname = String(req.body?.surname || "").trim();
    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "").trim();
    const pw1 = String(req.body?.pw1 || "");
    const pw2 = String(req.body?.pw2 || "");

    if (!id) return res.status(400).json({ ok:false, error:"Falta id" });
    if (!username) return res.status(400).json({ ok:false, error:"Usuario requerido" });
    // ✅ FIX: usar \s (no \\s) en el literal RegExp
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ ok:false, error:"Correo inválido" });
    }

    // Duplicados
    const du1 = db.prepare(`SELECT id FROM users WHERE username=? AND id<>?`).get(username, id);
    if (du1) return res.status(409).json({ ok:false, error:"El usuario ya existe" });
    const du2 = db.prepare(`SELECT id FROM users WHERE email=? AND id<>?`).get(email, id);
    if (du2) return res.status(409).json({ ok:false, error:"El correo ya está en uso" });

    let sql = `UPDATE users SET username=?, email=?, name=?, surname=?`;
    const params = [username, email, name, surname];

    if (pw1 || pw2){
      if (pw1 !== pw2) return res.status(400).json({ ok:false, error:"Las contraseñas no coinciden" });
      if (pw1.length < 6) return res.status(400).json({ ok:false, error:"La contraseña debe tener 6+ caracteres" });
      sql += `, password_hash=?`;
      params.push(bcrypt.hashSync(pw1, 10));
    }
    sql += ` WHERE id=?`; params.push(id);
    db.prepare(sql).run(...params);

    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message || "update" });
  }
});

/* ───────── API: conteos rápidos ───────── */
router.get("/users/:id/counts", ensureAdmin, (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({error:"Falta id"});

  // Servicios/productos (intenta varias tablas, si no existen => 0)
  function countServices(){
    const tables = ["services", "user_services", "subscriptions"];
    for (const t of tables){
      if (tableExists(t)){
        const cols = getColumns(t);
        const statusCol = cols.includes("status") ? "status" : (cols.includes("state") ? "state" : null);
        const activeCol = cols.includes("active") ? "active" : null;

        try{
          if (activeCol){
            const a = db.prepare(`SELECT COUNT(1) AS c FROM ${t} WHERE user_id=? AND ${activeCol}=1`).get(id)?.c || 0;
            const c = db.prepare(`SELECT COUNT(1) AS c FROM ${t} WHERE user_id=? AND ${activeCol}=0`).get(id)?.c || 0;
            return {active:a, cancelled:c};
          } else if (statusCol){
            const a = db.prepare(`SELECT COUNT(1) AS c FROM ${t} WHERE user_id=? AND LOWER(${statusCol}) IN ('active','activo','running','paid')`).get(id)?.c || 0;
            const c = db.prepare(`SELECT COUNT(1) AS c FROM ${t} WHERE user_id=? AND LOWER(${statusCol}) IN ('canceled','cancelado','cancelled','stopped')`).get(id)?.c || 0;
            return {active:a, cancelled:c};
          } else {
            const a = db.prepare(`SELECT COUNT(1) AS c FROM ${t} WHERE user_id=?`).get(id)?.c || 0;
            return {active:a, cancelled:0};
          }
        }catch{}
      }
    }
    return {active:0, cancelled:0};
  }

  // Facturas (schema-agnóstico)
  function countInvoices(){
    if (!tableExists("invoices")) return {paid:0, pending:0};
    const cols = getColumns("invoices");
    const statusCol = cols.includes("status") ? "status"
                      : cols.includes("state") ? "state"
                      : cols.includes("payment_status") ? "payment_status" : null;
    const paidCol = cols.includes("paid") ? "paid" : null;
    const paidAtCol = cols.includes("paid_at") ? "paid_at" : null;

    try{
      if (statusCol){
        const paid = db.prepare(`SELECT COUNT(1) AS c FROM invoices WHERE user_id=? AND LOWER(${statusCol}) IN ('paid','pagado','completed')`).get(id)?.c || 0;
        const pending = db.prepare(`SELECT COUNT(1) AS c FROM invoices WHERE user_id=? AND LOWER(${statusCol}) IN ('pending','pendiente','unpaid')`).get(id)?.c || 0;
        return {paid, pending};
      } else if (paidCol){
        const paid = db.prepare(`SELECT COUNT(1) AS c FROM invoices WHERE user_id=? AND ${paidCol}=1`).get(id)?.c || 0;
        const pending = db.prepare(`SELECT COUNT(1) AS c FROM invoices WHERE user_id=? AND ${paidCol}=0`).get(id)?.c || 0;
        return {paid, pending};
      } else if (paidAtCol){
        const paid = db.prepare(`SELECT COUNT(1) AS c FROM invoices WHERE user_id=? AND ${paidAtCol} IS NOT NULL AND ${paidAtCol}<>''`).get(id)?.c || 0;
        const pending = db.prepare(`SELECT COUNT(1) AS c FROM invoices WHERE user_id=? AND (${paidAtCol} IS NULL OR ${paidAtCol}='')`).get(id)?.c || 0;
        return {paid, pending};
      }
    }catch{}
    const total = db.prepare(`SELECT COUNT(1) AS c FROM invoices WHERE user_id=?`).get(id)?.c || 0;
    return {paid:0, pending:total};
  }

  const s = countServices();
  const i = countInvoices();
  res.json({ active:s.active, cancelled:s.cancelled, paid:i.paid, pending:i.pending });
});

/* ───────── API: facturas (lista) ───────── */
router.get("/users/:id/invoices", ensureAdmin, (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({error:"Falta id"});
  if (!tableExists("invoices")) return res.json({all:[]});

  let rows = [];
  try{
    rows = db.prepare(`SELECT * FROM invoices WHERE user_id=? ORDER BY id DESC LIMIT 120`).all(id);
  }catch{ rows = []; }

  // Normaliza
  const out = rows.map(r => {
    const currency = r.currency || r.curr || r.iso || null;

    let amount =
      (r.total_amount ?? r.amount ?? r.total ?? r.grand_total ?? r.value ?? r.price ?? null);
    if (amount == null && (r.amount_cents || r.total_cents)){
      const cents = r.amount_cents ?? r.total_cents;
      amount = Number(cents)/100;
    }
    if (amount == null) amount = 0;

    let status = (r.status || r.state || r.payment_status || "").toString().toLowerCase();
    if (!status){
      if (r.paid === 1 || r.paid === true || r.paid === "1") status = "paid";
      else if (r.paid_at) status = "paid";
      else status = "pending";
    }
    return { id: r.id, currency, amount: Number(amount), status };
  });

  res.json({ all: out });
});

/* ───────── API: productos/servicios (lista) ───────── */
router.get("/users/:id/services", ensureAdmin, (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({error:"Falta id"});

  const tables = ["services", "user_services", "subscriptions"];
  let t = null;
  for (const name of tables){ if (tableExists(name)) { t = name; break; } }
  if (!t) return res.json({ active:[], cancelled:[] });

  let items = [];
  try{
    items = db.prepare(`SELECT * FROM ${t} WHERE user_id=? ORDER BY id DESC LIMIT 200`).all(id);
  }catch{ items = []; }

  // Mapeo de nombres de productos si hay products
  let prodMap = new Map();
  try{
    if (tableExists("products")){
      const ids = [...new Set(items.map(x => x.product_id).filter(Boolean))];
      if (ids.length){
        const placeholders = ids.map(()=>"?").join(",");
        const rows = db.prepare(`SELECT id,name FROM products WHERE id IN (${placeholders})`).all(...ids);
        rows.forEach(r => prodMap.set(r.id, r.name));
      }
    }
  }catch{}

  function norm(x){
    let status = (x.status || x.state || "").toString().toLowerCase();
    if (!status){
      if (x.active === 1) status = "active";
      else if (x.active === 0) status = "canceled";
      else status = "unknown";
    }
    const name = x.name || prodMap.get(x.product_id) || (x.product_id ? `Producto #${x.product_id}` : `Item #${x.id}`);
    return { id:x.id, name, status };
  }

  const active = [], cancelled = [];
  for (const it of items.map(norm)){
    if (["active","activo","running","paid"].includes(it.status)) active.push(it);
    else if (["canceled","cancelado","cancelled","stopped"].includes(it.status)) cancelled.push(it);
    else active.push(it); // fallback
  }
  res.json({ active, cancelled });
});

module.exports = router;