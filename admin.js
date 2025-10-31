// admin.js
"use strict";

const express = require("express");
const db = require("./db");

const router = express.Router();

/* ====== middleware ====== */
function ensureAdmin(req, res, next) {
  const u = req.session && req.session.user;
  if (!u) return res.redirect("/login");
  if (!u.is_admin) return res.redirect("/");
  next();
}

/* ====== PAGE: /admin (Usuarios) ====== */
router.get("/", ensureAdmin, (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  res.type("html").send(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Admin · Usuarios</title>
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

  .wrap{max-width:1200px;margin:0 auto;padding:14px}
  .title{margin:10px 0 6px 0}
  .muted{color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
  .toolbar{display:flex;gap:10px;align-items:center;margin-bottom:10px}
  .input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:inherit}
  body.light .input{background:#fff;border-color:#00000022}

  table{width:100%;border-collapse:separate;border-spacing:0}
  th,td{padding:12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
  tbody tr:hover{background:#ffffff0c}
  body.light tbody tr:hover{background:#00000006}
  .tag{display:inline-block;padding:4px 8px;border-radius:999px;border:1px solid var(--line);font-size:12px}
  .right{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}
  .nowrap{white-space:nowrap}

  /* Modal créditos */
  .modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:20}
  .modal.show{display:flex}
  .modal .back{position:absolute;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(2px)}
  .modal .box{position:relative;background:var(--card);border:1px solid var(--line);border-radius:14px; padding:16px; width:100%; max-width:420px; z-index:1}
  body.light .modal .box{background:#fff}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .label{font-size:12px;color:var(--muted);margin-bottom:4px}
  .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
  @media(max-width:760px){
    .hide-sm{display:none}
    .toolbar{flex-direction:column;align-items:stretch}
  }
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
        <a href="/admin" data-match="^/admin/?$">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7v-1a5 5 0 0 1 10 0v1H3z"/></svg>
          Usuarios
        </a>
        <a href="/admin/mail" data-match="^/admin/mail">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3h13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 14.5 13h-13A1.5 1.5 0 0 1 0 11.5v-7A1.5 1.5 0 0 1 1.5 3Zm.5 1.8 6 3.7 6-3.7V5L8 8.7 2 5v-.2Z"/></svg>
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
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0-1 1 1 1 0  0 0 1 1v2a2 2 0 0 1-2 2H3a2 2 0  0 1-2-2V9a1 1 0 0 0 1-1 1 1 0  0 0-1-1V5Z"/></svg>
          Tickets
        </a>
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>

  <div class="wrap">
    <!-- Sección de pagos arriba (sin texto extra) -->
    <section class="card" style="margin-bottom:12px">
      <h3 style="margin:8px 0">Pasarelas de pago</h3>
      <div class="row">
        <a class="btn blue" href="/admin/paypal">Configurar PayPal</a>
        <a class="btn blue" href="/admin/stripe">Configurar Stripe</a>
        <a class="btn blue" href="/admin/whatsapp">Vincular WhatsApp (Bot)</a>
        <!-- NUEVO botón, sin tocar más lógica -->
        <a class="btn blue" href="/admin/terminos" title="Configurar Términos y Condiciones">Términos & Condiciones</a>
      </div>
    </section>

    <h2 class="title">Usuarios</h2>
    <p class="muted">Búsqueda · editar · admin on/off · créditos · eliminar.</p>

    <section class="card">
      <div class="toolbar">
        <input id="q" class="input" placeholder="Buscar por nombre, apellido, usuario o correo…">
        <button id="refreshBtn" class="btn ghost" type="button">Actualizar</button>
      </div>

      <div class="tablewrap">
        <table id="tbl">
          <thead>
            <tr>
              <th class="hide-sm">ID</th>
              <th>Usuario</th>
              <th>Nombre</th>
              <th>Email</th>
              <th>Teléfono</th>
              <th>Rol</th>
              <th class="hide-sm">Creado</th>
              <th class="right">Acciones</th>
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="8" class="muted">Cargando…</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>

  <!-- Modal créditos -->
  <div id="creditModal" class="modal" aria-hidden="true">
    <div class="back"></div>
    <div class="box">
      <h3 style="margin:0 0 8px">Créditos de <span id="mUser"></span></h3>
      <div class="grid2">
        <div>
          <div class="label">Saldo USD:</div>
          <div id="balUSD" style="font-weight:800">—</div>
        </div>
        <div>
          <div class="label">Saldo MXN:</div>
          <div id="balMXN" style="font-weight:800">—</div>
        </div>
      </div>
      <div style="height:10px"></div>
      <div class="grid2">
        <div>
          <div class="label">Agregar a USD</div>
          <input id="addUSD" class="input" type="number" step="0.01" placeholder="0.00">
        </div>
        <div>
          <div class="label">Agregar a MXN</div>
          <input id="addMXN" class="input" type="number" step="0.01" placeholder="0.00">
        </div>
      </div>
      <div class="actions">
        <button id="clearCredits" class="btn red" type="button">Eliminar créditos</button>
        <button id="closeModal" class="btn ghost" type="button">Cerrar</button>
        <button id="saveCredits" class="btn ok" type="button">Guardar</button>
      </div>
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
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');
  var menuBtn = document.getElementById('menuBtn');
  function openDrawer(){ drawer.classList.add('open'); scrim.classList.add('show'); }
  function closeDrawer(){ drawer.classList.remove('open'); scrim.classList.remove('show'); }
  menuBtn.addEventListener('click', openDrawer);
  scrim.addEventListener('click', closeDrawer);
  window.addEventListener('keydown', function(e){ if(e.key==='Escape') closeDrawer(); });

  /* ===== Marca item activo del menú ===== */
  (function(){
    var path = location.pathname;
    document.querySelectorAll('#sidenav a').forEach(function(a){
      var re = new RegExp(a.getAttribute('data-match'));
      if (re.test(path)) a.classList.add('active');
    });
  })();

  /* ===== Usuarios (AJAX) ===== */
  var tbody = document.getElementById('tbody');
  var qInput = document.getElementById('q');
  var refreshBtn = document.getElementById('refreshBtn');
  var t=null; function debounce(fn,ms){ clearTimeout(t); t=setTimeout(fn,ms||220); }

  function escapeHTML(s){
    return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  async function loadUsers(){
    try{
      var q = qInput.value.trim();
      var r = await fetch('/admin/api/users?q='+encodeURIComponent(q), {cache:'no-store', credentials:'same-origin'});
      var ct = (r.headers.get('content-type')||'').toLowerCase();
      if (!ct.includes('application/json')) { tbody.innerHTML = '<tr><td colspan="8">Error de sesión</td></tr>'; return; }
      var data = await r.json();
      renderUsers(Array.isArray(data)?data:[]);
    }catch(e){
      tbody.innerHTML = '<tr><td colspan="8">Error cargando usuarios</td></tr>';
    }
  }

  function renderUsers(rows){
    if (!rows.length){
      tbody.innerHTML = '<tr><td colspan="8" class="muted">Sin resultados.</td></tr>';
      return;
    }
    var html = '';
    for (var i=0;i<rows.length;i++){
      var u = rows[i];
      var full = (escapeHTML(u.name)+' '+escapeHTML(u.surname)).trim();
      var role = u.is_admin ? 'admin' : 'user';
      html += '<tr data-id="'+u.id+'" data-user="'+escapeHTML(u.username)+'">'
           +  '<td class="hide-sm">'+u.id+'</td>'
           +  '<td>@'+escapeHTML(u.username)+'</td>'
           +  '<td>'+escapeHTML(full||'—')+'</td>'
           +  '<td>'+escapeHTML(u.email)+'</td>'
           +  '<td>'+escapeHTML(u.phone||"—")+'</td>'
           +  '<td><span class="tag">'+role+'</span></td>'
           +  '<td class="hide-sm nowrap">'+escapeHTML((u.created_at||'').replace("T"," ").slice(0,19))+'</td>'
           +  '<td class="right">'
           +     '<button class="btn ok" data-act="credit" title="Editar créditos">Créditos</button>'
           +     '<button class="btn blue" data-act="edit" title="Editar usuario">Editar usuario</button>'
           +     '<button class="btn ghost" data-act="toggle">'+(u.is_admin?'Quitar admin':'Dar admin')+'</button>'
           +     '<button class="btn red" data-act="delete">Eliminar</button>'
           +  '</td>'
           +'</tr>';
    }
    tbody.innerHTML = html;
  }

  qInput.addEventListener('input', function(){ debounce(loadUsers, 200); });
  refreshBtn.addEventListener('click', loadUsers);

  // ===== Modal créditos
  var modal = document.getElementById('creditModal');
  var mUser = document.getElementById('mUser');
  var balUSD = document.getElementById('balUSD');
  var balMXN = document.getElementById('balMXN');
  var addUSD = document.getElementById('addUSD');
  var addMXN = document.getElementById('addMXN');
  var closeModal = document.getElementById('closeModal');
  var saveCredits = document.getElementById('saveCredits');
  var clearCredits = document.getElementById('clearCredits');
  var currentUserId = 0;

  function openModal(){ modal.classList.add('show'); }
  function hideModal(){ modal.classList.remove('show'); }

  async function openCredits(userId, username){
    currentUserId = userId;
    mUser.textContent = '@'+username;
    addUSD.value = ''; addMXN.value = '';
    balUSD.textContent = '—'; balMXN.textContent = '—';
    openModal();
    try{
      var r = await fetch('/admin/api/user/'+userId+'/credits', {cache:'no-store'});
      var data = await r.json();
      balUSD.textContent = '$ ' + Number(data.USD||0).toFixed(2);
      balMXN.textContent = 'MXN ' + Number(data.MXN||0).toFixed(2);
    }catch(e){
      balUSD.textContent = 'Error'; balMXN.textContent = 'Error';
    }
  }

  closeModal.addEventListener('click', hideModal);
  modal.querySelector('.back').addEventListener('click', hideModal);

  saveCredits.addEventListener('click', async function(){
    var u = currentUserId;
    var usd = parseFloat(addUSD.value||0)||0;
    var mxn = parseFloat(addMXN.value||0)||0;
    if (usd===0 && mxn===0) { alert('No hay cambios.'); return; }
    saveCredits.disabled = true;
    try{
      var r = await fetch('/admin/api/credits/add-bulk', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user_id:u, usd_add:usd, mxn_add:mxn })
      });
      var t = await r.text();
      if (t !== 'OK') { alert(t); }
      else { alert('Créditos guardados.'); hideModal(); }
    }catch(e){ alert('Error: '+e.message); }
    finally{ saveCredits.disabled = false; }
  });

  clearCredits.addEventListener('click', async function(){
    if (!confirm('¿Eliminar todos los créditos (USD y MXN) de este usuario?')) return;
    clearCredits.disabled = true;
    try{
      var r = await fetch('/admin/api/credits/clear', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user_id: currentUserId })
      });
      var t = await r.text();
      if (t !== 'OK') alert(t); else { alert('Créditos eliminados.'); hideModal(); }
    }catch(e){ alert('Error: '+e.message); }
    finally{ clearCredits.disabled = false; }
  });

  tbody.addEventListener('click', async function(e){
    var btn = e.target.closest('button[data-act]'); if(!btn) return;
    var tr = btn.closest('tr'); var id = Number(tr.getAttribute('data-id')||0);
    var act = btn.getAttribute('data-act');

    if (act === 'credit'){
      return openCredits(id, tr.getAttribute('data-user')||'usuario');
    }

    if (act === 'edit'){
      // Redirige al editor individual (ruta plural)
      window.location.href = '/admin/users/' + id + '/edit';
      return;
    }

    if (act === 'toggle'){
      try{
        btn.disabled = true;
        var r = await fetch('/admin/api/admin', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ user_id:id, is_admin: btn.textContent.indexOf('Dar')>=0 ? 1 : 0 })
        });
        var txt = await r.text();
        if (txt !== 'OK'){ alert(txt); btn.disabled=false; return; }
        loadUsers();
      }catch(err){ alert('Error: '+err.message); }
      finally{ btn.disabled=false; }
      return;
    }

    if (act === 'delete'){
      if (!confirm('¿Eliminar este usuario? Esta acción no se puede deshacer.')) return;
      try{
        btn.disabled = true;
        var r2 = await fetch('/admin/api/users/'+id, { method:'DELETE' });
        var t2 = await r2.text();
        if (t2 !== 'OK'){ alert(t2); btn.disabled=false; return; }
        tr.remove();
      }catch(err){ alert('Error: '+err.message); }
      finally{ btn.disabled=false; }
      return;
    }
  });

  // Carga inicial
  loadUsers();
})();
</script>
</body>
</html>`);
});

/* ====== API: lista de usuarios (búsqueda en tiempo real) ====== */
router.get("/api/users", ensureAdmin, (req, res) => {
  const q = String(req.query.q || "").trim();
  let rows;
  if (q) {
    const like = '%' + q + '%';
    rows = db
      .prepare(
        `SELECT id, username, name, surname, email, phone, is_admin, created_at
         FROM users
         WHERE username LIKE ? OR name LIKE ? OR surname LIKE ? OR email LIKE ?
         ORDER BY username COLLATE NOCASE ASC
         LIMIT 100`
      )
      .all(like, like, like, like);
  } else {
    rows = db
      .prepare(
        `SELECT id, username, name, surname, email, phone, is_admin, created_at
         FROM users
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT 50`
      )
      .all();
  }
  res.json(rows);
});

/* ====== API: dar/quitar admin ====== */
router.post("/api/admin", ensureAdmin, (req, res) => {
  const user_id = Number(req.body?.user_id || 0);
  const is_admin = Number(req.body?.is_admin ? 1 : 0);
  if (!user_id) return res.status(400).send("Falta user_id");
  try{
    db.prepare(`UPDATE users SET is_admin=? WHERE id=?`).run(is_admin, user_id);
    res.send("OK");
  }catch(e){
    res.status(500).send("ERR: " + (e?.message || "update"));
  }
});

/* ====== API: eliminar usuario ====== */
router.delete("/api/users/:id", ensureAdmin, (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).send("Falta id");
  try{
    db.prepare(`DELETE FROM users WHERE id=?`).run(id);
    res.send("OK");
  }catch(e){
    res.status(500).send("ERR: " + (e?.message || "delete"));
  }
});

/* ====== API: obtener saldos ====== */
router.get("/api/user/:id/credits", ensureAdmin, (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({error:"Falta id"});
  const usd = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='USD'`).get(id)?.balance || 0;
  const mxn = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='MXN'`).get(id)?.balance || 0;
  res.json({ USD: Number(usd), MXN: Number(mxn) });
});

/* ====== API: agregar varios créditos (USD y/o MXN) ====== */
router.post("/api/credits/add-bulk", ensureAdmin, (req, res) => {
  const user_id = Number(req.body?.user_id || 0);
  const usd_add = Number(req.body?.usd_add || 0);
  const mxn_add = Number(req.body?.mxn_add || 0);
  if (!user_id) return res.status(400).send("Falta user_id");
  if (usd_add === 0 && mxn_add === 0) return res.status(400).send("Sin cambios");

  try{
    const tx = db.transaction(() => {
      if (usd_add !== 0){
        db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`).run(user_id,"USD");
        db.prepare(`UPDATE credits SET balance = balance + ? WHERE user_id=? AND currency='USD'`).run(usd_add, user_id);
      }
      if (mxn_add !== 0){
        db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`).run(user_id,"MXN");
        db.prepare(`UPDATE credits SET balance = balance + ? WHERE user_id=? AND currency='MXN'`).run(mxn_add, user_id);
      }
    });
    tx();
    res.send("OK");
  }catch(e){
    res.status(500).send("ERR: " + (e?.message || "add-bulk"));
  }
});

/* ====== API: eliminar (vaciar) créditos ====== */
router.post("/api/credits/clear", ensureAdmin, (req, res) => {
  const user_id = Number(req.body?.user_id || 0);
  const currency = (req.body?.currency || "").toUpperCase();
  if (!user_id) return res.status(400).send("Falta user_id");

  try{
    if (currency === "USD" || currency === "MXN"){
      db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`).run(user_id, currency);
      db.prepare(`UPDATE credits SET balance=0 WHERE user_id=? AND currency=?`).run(user_id, currency);
    } else {
      // ambas
      db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`).run(user_id, "USD");
      db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`).run(user_id, "MXN");
      db.prepare(`UPDATE credits SET balance=0 WHERE user_id=?`).run(user_id);
    }
    res.send("OK");
  }catch(e){
    res.status(500).send("ERR: " + (e?.message || "clear"));
  }
});

module.exports = router;
