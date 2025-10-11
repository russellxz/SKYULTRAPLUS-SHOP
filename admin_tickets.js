// admin_tickets.js — Soporte para administradores (listar/ver/responder/abrir-cerrar/borrar tickets)
// Móntalo con: app.use('/admin', require('./admin_tickets'));
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const db = require("./db");

const router = express.Router();

/* ====== middleware ====== */
function ensureAdmin(req, res, next) {
  const u = req.session && req.session.user;
  if (!u) return res.redirect("/login");
  if (!u.is_admin) return res.redirect("/");
  next();
}

/* ====== helpers ====== */
function esc(s){
  return String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}
function ensureDir(dir){ if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); }

/* ====== archivos (imágenes adjuntas) ====== */
const TICK_DIR = path.resolve(process.cwd(),"uploads","tickets");
ensureDir(TICK_DIR);

const ALLOWED = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (req,file,cb)=>{
      const id = Number(req.params.id||0) || Number(req.body.ticket_id||0) || 0;
      const base = id ? path.join(TICK_DIR, `t-${id}`) : path.join(TICK_DIR, "tmp");
      ensureDir(base);
      cb(null, base);
    },
    filename: (req,file,cb)=>{
      const ext = ALLOWED[file.mimetype] || "bin";
      const ts = Date.now();
      const rnd = Math.random().toString(36).slice(2,8);
      cb(null, `${ts}-${rnd}.${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 4 },
  fileFilter: (req,file,cb)=>{
    if (ALLOWED[file.mimetype]) cb(null, true);
    else cb(new Error("Formato no permitido (usa JPG/PNG/WebP/GIF)"));
  }
});

/* ====== PAGE: /admin/tickets ====== */
router.get("/tickets", ensureAdmin, (req,res)=>{
  const site = db.getSetting("site_name","SkyShop");

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(site)} · Admin · Tickets</title>
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

  .topbar{position:sticky;top:0;z-index:6;display:flex;gap:10px;align-items:center;justify-content:space-between;
          padding:10px 12px;background:rgba(17,25,40,.6);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
  .brand{font-weight:900}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;border:1px solid #334155;background:#1f2a44;color:#fff;cursor:pointer;text-decoration:none}
  .btn.ghost{background:transparent;border-color:#334155;color:inherit}
  .btn.blue{background:var(--accent);border-color:#1d4ed8}
  .btn.red{background:var(--danger);border-color:#b91c1c}
  .btn.ok{background:var(--ok);border-color:#15803d}
  .btn[disabled]{opacity:.6;cursor:not-allowed}

  /* Drawer */
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

  /* Layout 2 columnas */
  .grid{display:grid;grid-template-columns:380px 1fr;gap:12px}
  @media(max-width:980px){ .grid{grid-template-columns:1fr} }

  /* Lista */
  .toolbar{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
  .input, select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:inherit}
  body.light .input, body.light select{background:#fff;border-color:#00000022;color:inherit}
  .list{display:flex;flex-direction:column;gap:8px}
  .item{display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid var(--line);border-radius:12px;cursor:pointer}
  .item:hover{background:#ffffff0a}
  body.light .item:hover{background:#00000006}
  .tag{display:inline-block;padding:4px 8px;border-radius:999px;border:1px solid var(--line);font-size:12px}
  .badge{display:inline-block;padding:2px 6px;border-radius:999px;border:1px solid #ffffff24;background:#0b1325;font-size:11px}
  body.light .badge{background:#f8fafc;border-color:#00000018}
  .right{margin-left:auto;display:flex;gap:6px;align-items:center}

  /* Conversación */
  .bubble{padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:#0e1a2f;max-width:880px;color:inherit}
  body.light .bubble{background:#f8fafc;border-color:#00000018}
  .me{background:linear-gradient(90deg,#2563eb,#60a5fa);color:#fff;border:0}
  /* FIX: en modo claro conservar el estilo del admin */
  body.light .bubble.me{background:linear-gradient(90deg,#2563eb,#60a5fa)!important;color:#fff;border:0}
  .meta{font-size:12px;color:var(--muted);margin:6px 0 0}
  .thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
  .thumbs img{width:120px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:pointer}

  .composer .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  textarea{width:100%;min-height:100px;resize:vertical;padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:inherit}
  body.light textarea{background:#fff;border-color:#00000022}

  /* Visor */
  .viewer{ position:fixed; inset:0; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,.85); z-index:30; }
  .viewer.show{ display:flex; }
  .viewer img{ max-width:92vw; max-height:90vh; border-radius:12px; box-shadow:0 10px 40px #000a; background:#fff }
  .viewer .close{ position:absolute; top:16px; right:16px; border:0; border-radius:999px; padding:8px 10px; font-weight:900; cursor:pointer; }

  @media(max-width:980px){
    .hide-sm{display:none}
  }
</style>
<body>
  <div class="topbar">
    <div class="row">
      <button id="menuBtn" class="burger" aria-label="Abrir menú"><span></span></button>
      <div class="brand">${esc(site)} · Admin</div>
    </div>
    <div class="row">
      <button id="modeBtn" class="btn ghost" type="button">🌙</button>
      <a class="btn ghost" href="/">← Dashboard</a>
      <a class="btn red" href="/logout">Salir</a>
    </div>
  </div>

  <!-- Drawer lateral (mismo menú que admin.js) -->
  <div class="drawer" id="drawer">
    <div class="panel">
      <h3 style="margin:0 0 10px">Menú</h3>
      <nav class="nav" id="sidenav">
        <a href="/admin" data-match="^/admin/?$">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7v-1a5 5 0  0 1 10 0v1H3z"/></svg>
          Usuarios
        </a>
        <a href="/admin/mail" data-match="^/admin/mail">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3h13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 14.5 13h-13A1.5 1.5 0 0 1 0 11.5v-7A1.5 1.5 0 0 1 1.5 3Zm.5 1.8 6 3.7 6-3.7V5L8 8.7 2 5v-.2Z"/></svg>
          Correo (SMTP)
        </a>
        <a href="/admin/brand" data-match="^/admin/brand">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm1 8h10l-3.2-4-2.3 3L6 8 3 11Zm6-6a1 1 0  1 0 0-2 1 1 0 0 0 0 2Z"/></svg>
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
        <a href="/admin/tickets" data-match="^/admin/tickets" class="active">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0-1 1 1 1 0  0 0 1 1v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a1 1 0 0 0 1-1 1 1 0 0 0-1-1V5Z"/></svg>
          Tickets
        </a>
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>

  <div class="wrap">
    <h2 class="title">Tickets</h2>
    <p class="muted">Lista, lectura y respuesta a soporte. Adjunta imágenes y cierra/reabre tickets.</p>

    <div class="grid">
      <!-- Columna: lista -->
      <section class="card">
        <div class="toolbar">
          <select id="st" class="input" style="max-width:160px">
            <option value="open">Abiertos</option>
            <option value="closed">Cerrados</option>
          </select>
          <input id="q" class="input" placeholder="Buscar por #, asunto o usuario…">
          <label style="display:inline-flex;gap:6px;align-items:center">
            <input id="onlyNew" type="checkbox"> <span class="muted">Con nuevos mensajes</span>
          </label>
          <button id="refresh" class="btn ghost" type="button">Actualizar</button>
        </div>

        <div id="list" class="list" aria-live="polite">
          <div class="muted">Cargando…</div>
        </div>
      </section>

      <!-- Columna: conversación -->
      <section class="card">
        <div id="convWrap"><div class="muted">Selecciona un ticket.</div></div>
      </section>
    </div>
  </div>

  <!-- Visor de imágenes -->
  <div id="viewer" class="viewer" role="dialog" aria-modal="true" aria-hidden="true">
    <img id="viewerImg" alt="Imagen adjunta">
    <button id="viewerClose" class="close btn ghost" type="button">✕</button>
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

  /* ===== Estado ===== */
  var listEl = document.getElementById('list');
  var convWrap = document.getElementById('convWrap');
  var stSel = document.getElementById('st');
  var qInput = document.getElementById('q');
  var onlyNew = document.getElementById('onlyNew');
  var refreshBtn = document.getElementById('refresh');
  var currentId = 0;
  var t=null; function deb(fn,ms){ clearTimeout(t); t=setTimeout(fn,ms||220); }

  /* ===== Lista ===== */
  async function loadList(){
    listEl.innerHTML = '<div class="muted">Cargando…</div>';
    try{
      var url = '/admin/api/tickets?status='+encodeURIComponent(stSel.value)
              + '&q='+encodeURIComponent(qInput.value.trim())
              + '&only_new='+(onlyNew.checked ? '1' : '0');
      var r = await fetch(url, {cache:'no-store', credentials:'same-origin'});
      var data = await r.json();
      if (!Array.isArray(data) || !data.length){
        listEl.innerHTML = '<div class="muted">Sin resultados.</div>';
        convWrap.innerHTML = '<div class="muted">Selecciona un ticket.</div>';
        return;
      }
      listEl.innerHTML = data.map(function(x){
        var who = x.username ? ('@'+x.username) : ('ID '+x.user_id);
        var badge = x.unread_admin ? '<span class="badge">nuevo</span>' : '';
        return '<div class="item" data-id="'+x.id+'">'
          +   '<div style="flex:1">'
          +     '<div style="font-weight:800">'+escHtml(x.subject||('Ticket #'+x.id))+'</div>'
          +     '<div class="muted" style="font-size:12px">#'+x.id+' · '+who+' · '+escHtml((x.created_at||'').replace('T',' ').slice(0,19))+'</div>'
          +   '</div>'
          +   '<div class="right">'
          +     (x.status==='open' ? '<span class="tag">Abierto</span>' : '<span class="tag">Cerrado</span>')
          +     (badge)
          +   '</div>'
          + '</div>';
      }).join('');
    }catch(e){
      listEl.innerHTML = '<div class="muted">Error cargando.</div>';
    }
  }
  function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  listEl.addEventListener('click', function(e){
    var it = e.target.closest('.item'); if(!it) return;
    openTicket(Number(it.getAttribute('data-id')||0), true);
  });
  qInput.addEventListener('input', function(){ deb(loadList, 200) });
  stSel.addEventListener('change', loadList);
  onlyNew.addEventListener('change', loadList);
  refreshBtn.addEventListener('click', loadList);

  /* ===== Conversación ===== */
  async function openTicket(id, markRead){
    if(!id) return;
    currentId = id;
    convWrap.innerHTML = '<div class="muted">Cargando…</div>';
    try{
      var url = '/admin/api/tickets/'+id + (markRead ? '?mark=read' : '');
      var r = await fetch(url, {cache:'no-store', credentials:'same-origin'});
      var d = await r.json();
      if (!r.ok || d.error){ convWrap.innerHTML = '<div class="muted">'+(d.error||('Error '+r.status))+'</div>'; return; }

      function bubble(m){
        var isUser = m.sender==='user';
        var imgs = (m.files||[]).map(function(u){ return '<img src="'+u+'" alt="adjunto" data-full="'+u+'">'; }).join('');
        var body = escHtml(m.body||'').replace(/\\n/g,'<br>');
        return '<div>'
             +   '<div class="bubble '+(isUser?'':'me')+'">'+(body||'<i>(sin texto)</i>')
             +     (imgs?('<div class="thumbs">'+imgs+'</div>'):'')
             +   '</div>'
             +   '<div class="meta">'+escHtml(m.sender)+' · '+escHtml((m.created_at||'').replace('T',' ').slice(0,19))+'</div>'
             + '</div>';
      }

      convWrap.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
        +  '<h3 style="margin:0">#'+id+' · '+escHtml(d.subject||'')+' <span class="muted" style="font-size:12px">('+escHtml(d.username?('@'+d.username):('ID '+d.user_id))+')</span></h3>'
        +  '<div class="row">'
        +     (d.status==='open'
                ? '<button id="btnClose" class="btn ghost" type="button">Cerrar</button>'
                : '<button id="btnReopen" class="btn ok" type="button">Reabrir</button>')
        +     '<button id="btnDelete" class="btn red" type="button">Eliminar</button>'
        +  '</div>'
        +'</div>'
        + '<div id="msgs" class="list">'+ (d.messages||[]).map(bubble).join('') +'</div>'
        + '<div style="height:10px"></div>'
        + (d.status==='open'
            ? '<div class="composer">'
            +   '<div class="label muted">Responder al usuario</div>'
            +   '<textarea id="msgBody" placeholder="Tu mensaje…"></textarea>'
            +   '<div class="row" style="margin-top:8px">'
            +      '<label class="btn" style="position:relative;overflow:hidden">'
            +        '<input id="files" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple style="position:absolute;inset:0;opacity:0;cursor:pointer">'
            +        'Subir imagen'
            +      '</label>'
            +      '<button id="send" class="btn blue" type="button">Enviar</button>'
            +   '</div>'
            +   '<div id="sendMsg" class="muted" style="margin-top:6px"></div>'
            + '</div>'
            : '<div class="muted">Este ticket está cerrado.</div>'
          );

      // actions
      var btnClose = document.getElementById('btnClose');
      var btnReopen = document.getElementById('btnReopen');
      var btnDelete = document.getElementById('btnDelete');

      btnClose && (btnClose.onclick = async function(){
        if(!confirm('¿Cerrar este ticket?')) return;
        var r = await fetch('/admin/api/tickets/'+id+'/close', {method:'POST'});
        var j = await r.json().catch(function(){return{}});
        if(!r.ok || !j.ok){ alert(j.error||('Error '+r.status)); return; }
        loadList(); openTicket(id, false);
      });

      btnReopen && (btnReopen.onclick = async function(){
        var r = await fetch('/admin/api/tickets/'+id+'/reopen', {method:'POST'});
        var j = await r.json().catch(function(){return{}});
        if(!r.ok || !j.ok){ alert(j.error||('Error '+r.status)); return; }
        loadList(); openTicket(id, false);
      });

      btnDelete && (btnDelete.onclick = async function(){
        if(!confirm('¿Eliminar este ticket y todos sus mensajes/archivos? Esta acción no se puede deshacer.')) return;
        var r = await fetch('/admin/api/tickets/'+id, {method:'DELETE'});
        var j = await r.json().catch(function(){return{}});
        if(!r.ok || !j.ok){ alert(j.error||('Error '+r.status)); return; }
        currentId = 0;
        await loadList();
        convWrap.innerHTML = '<div class="muted">Ticket eliminado.</div>';
      });

      var sendBtn = document.getElementById('send');
      sendBtn && (sendBtn.onclick = sendMessage);

      // visor
      var viewer = document.getElementById('viewer');
      var vimg = document.getElementById('viewerImg');
      var vclose = document.getElementById('viewerClose');
      document.querySelectorAll('#msgs .thumbs img').forEach(function(im){
        im.addEventListener('click', function(){
          vimg.src = im.getAttribute('data-full') || im.src;
          viewer.classList.add('show');
          viewer.setAttribute('aria-hidden','false');
        });
      });
      vclose.addEventListener('click', function(){ viewer.classList.remove('show'); vimg.src=''; });
      viewer.addEventListener('click', function(e){ if(e.target.id==='viewer') { viewer.classList.remove('show'); vimg.src=''; } });

      // scroll al final
      var msgs = document.getElementById('msgs');
      msgs && msgs.lastElementChild && msgs.lastElementChild.scrollIntoView({behavior:'smooth',block:'end'});

    }catch(e){
      convWrap.innerHTML = '<div class="muted">Error cargando conversación.</div>';
    }
  }

  async function sendMessage(){
    var sendMsg = document.getElementById('sendMsg');
    sendMsg.textContent = '';
    var body = (document.getElementById('msgBody')||{}).value || '';
    var files = (document.getElementById('files')||{}).files || [];
    if (!body.trim() && (!files || !files.length)){ sendMsg.textContent='Escribe un mensaje o añade una imagen.'; return; }
    try{
      var fd = new FormData();
      fd.append('body', body.trim());
      Array.from(files||[]).slice(0,4).forEach(f=>fd.append('images', f));
      var r = await fetch('/admin/api/tickets/'+currentId+'/message', { method:'POST', body: fd, credentials:'same-origin' });
      var d = await r.json();
      if(!r.ok || !d.ok){ sendMsg.textContent = d.error || ('Error '+r.status); return; }
      (document.getElementById('msgBody')||{}).value='';
      if (document.getElementById('files')) document.getElementById('files').value=null;
      await openTicket(currentId, false);
      await loadList();
    }catch(e){ sendMsg.textContent = 'Error: '+(e.message||e); }
  }

  // inicial
  loadList();

})();
</script>
</body>
</html>`);
});

/* ====== API: Listado ====== */
// GET /admin/api/tickets?status=open|closed&q=...&only_new=0|1
router.get("/api/tickets", ensureAdmin, (req,res)=>{
  const status = String(req.query.status||"open").trim();
  const q = String(req.query.q||"").trim();
  const onlyNew = String(req.query.only_new||"0")==="1";

  const where = ["1=1"];
  const args = [];

  if (status==="open") where.push("t.status='open'");
  else if (status==="closed") where.push("t.status='closed'");

  if (onlyNew) where.push("t.unread_admin=1");

  if (q){
    where.push("(t.id LIKE ? OR t.subject LIKE ? OR u.username LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like);
  }

  const rows = db.prepare(`
    SELECT t.id, t.user_id, t.subject, t.status, t.created_at, t.last_reply_at, t.last_sender,
           t.unread_admin, t.unread_user,
           u.username, u.name, u.surname
    FROM tickets t
    JOIN users u ON u.id = t.user_id
    WHERE ${where.join(" AND ")}
    ORDER BY
      CASE WHEN t.status='open' THEN 0 ELSE 1 END ASC,
      datetime(COALESCE(t.last_reply_at, t.created_at)) DESC, t.id DESC
    LIMIT 300
  `).all(...args);

  res.json(rows);
});

/* ====== API: Detalle + mensajes ====== */
// GET /admin/api/tickets/:id?mark=read
router.get("/api/tickets/:id", ensureAdmin, (req,res)=>{
  const id = Number(req.params.id||0);
  if (!id) return res.status(400).json({error:"Ticket inválido"});

  const t = db.prepare(`
    SELECT t.*, u.username, u.name, u.surname, u.email
    FROM tickets t
    JOIN users u ON u.id=t.user_id
    WHERE t.id=?
  `).get(id);
  if (!t) return res.status(404).json({error:"No encontrado"});

  if (String(req.query.mark||"") === "read") {
    try{
      db.prepare(`UPDATE tickets SET unread_admin=0 WHERE id=?`).run(id);
    }catch{}
  }

  const msgs = db.prepare(`
    SELECT id, sender, body, created_at
    FROM ticket_messages
    WHERE ticket_id=?
    ORDER BY id ASC
  `).all(id);

  const filesByMsg = db.prepare(`
    SELECT message_id, rel_path
    FROM ticket_files
    WHERE message_id IN (SELECT id FROM ticket_messages WHERE ticket_id=?)
  `).all(id).reduce((acc, r)=>{
    (acc[r.message_id] ||= []).push(r.rel_path);
    return acc;
  }, {});

  const out = {
    id: t.id,
    user_id: t.user_id,
    username: t.username,
    name: t.name,
    surname: t.surname,
    email: t.email,
    subject: t.subject,
    status: t.status,
    created_at: t.created_at,
    messages: msgs.map(m=>({
      id: m.id,
      sender: m.sender,
      body: m.body || "",
      created_at: m.created_at,
      files: filesByMsg[m.id] || []
    }))
  };

  res.json(out);
});

/* ====== API: Enviar mensaje (ADMIN) ====== */
// POST /admin/api/tickets/:id/message  (multipart: images[])
router.post("/api/tickets/:id/message", ensureAdmin, upload.array("images", 4), (req,res)=>{
  const id = Number(req.params.id||0);
  const body = String(req.body.body||"").trim();
  if (!id) return res.status(400).json({ok:false, error:"Ticket inválido"});
  if (!body && (!req.files || !req.files.length)) return res.status(400).json({ok:false, error:"Escribe un mensaje o adjunta imágenes"});

  try{
    const msg = db.transaction(()=>{
      const ins = db.prepare(`
        INSERT INTO ticket_messages(ticket_id, sender, body) VALUES(?, 'admin', ?)
      `).run(id, body);
      const message_id = ins.lastInsertRowid;

      for(const f of (req.files||[])){
        const rel = path.join("/uploads","tickets", `t-${id}`, path.basename(f.path));
        db.prepare(`
          INSERT INTO ticket_files(message_id,rel_path,mime,size) VALUES(?,?,?,?)
        `).run(message_id, rel.replace(/\\\\/g,"/"), f.mimetype, f.size);
      }

      db.prepare(`
        UPDATE tickets
        SET last_reply_at = datetime('now'),
            last_sender   = 'admin',
            unread_user   = 1,
            unread_admin  = 0
        WHERE id = ?
      `).run(id);

      return { id: message_id };
    })();

    res.json({ ok:true, message_id: msg.id });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message || "Error guardando" });
  }
});

/* ====== API: Cerrar / Reabrir ====== */
router.post("/api/tickets/:id/close", ensureAdmin, (req,res)=>{
  const id = Number(req.params.id||0);
  if (!id) return res.status(400).json({ok:false, error:"Ticket inválido"});
  try{
    db.prepare(`UPDATE tickets SET status='closed', closed_at=datetime('now') WHERE id=?`).run(id);
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error:e?.message||"Error" });
  }
});

router.post("/api/tickets/:id/reopen", ensureAdmin, (req,res)=>{
  const id = Number(req.params.id||0);
  if (!id) return res.status(400).json({ok:false, error:"Ticket inválido"});
  try{
    db.prepare(`UPDATE tickets SET status='open', closed_at=NULL WHERE id=?`).run(id);
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error:e?.message||"Error" });
  }
});

/* ====== API: Eliminar ticket ====== */
router.delete("/api/tickets/:id", ensureAdmin, (req,res)=>{
  const id = Number(req.params.id||0);
  if (!id) return res.status(400).json({ok:false, error:"Ticket inválido"});

  try{
    const files = db.prepare(`
      SELECT tf.rel_path
      FROM ticket_files tf
      JOIN ticket_messages tm ON tm.id = tf.message_id
      WHERE tm.ticket_id=?
    `).all(id);

    // borra del disco
    for(const f of files){
      const rel = String(f.rel_path||"");
      if (!rel.startsWith("/uploads/tickets/")) continue;
      const abs = path.join(process.cwd(), rel.replace(/^\//,""));
      try{ fs.unlinkSync(abs); }catch{}
    }

    // borra la carpeta completa del ticket
    const dir = path.join(TICK_DIR, `t-${id}`);
    try{ fs.rmSync(dir, { recursive:true, force:true }); }catch{}

    // limpia DB
    const tx = db.transaction(()=>{
      db.prepare(`DELETE FROM ticket_files WHERE message_id IN (SELECT id FROM ticket_messages WHERE ticket_id=?)`).run(id);
      db.prepare(`DELETE FROM ticket_messages WHERE ticket_id=?`).run(id);
      db.prepare(`DELETE FROM tickets WHERE id=?`).run(id);
    });
    tx();

    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message || "Error al eliminar" });
  }
});

module.exports = router;