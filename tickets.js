// tickets.js — Soporte del usuario: abrir/leer/responder/cerrar tickets (dark/light + adjuntos + drawer + quick + visor)
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const db = require("./db");

const router = express.Router();

/* ===== Helpers ===== */
function ensureAuth(req,res,next){
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}
function esc(s){
  return String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}
function ensureDir(dir){ if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); }

/* ===== Esquema ===== */
function ensureSchema(){
  db.prepare(`
    CREATE TABLE IF NOT EXISTS tickets(
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', /* open|closed */
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at  TEXT,
      last_reply_at TEXT,
      last_sender TEXT, /* 'user' | 'admin' */
      unread_admin INTEGER DEFAULT 1,
      unread_user  INTEGER DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ticket_messages(
      id INTEGER PRIMARY KEY,
      ticket_id INTEGER NOT NULL,
      sender TEXT NOT NULL, /* 'user' | 'admin' */
      body TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ticket_files(
      id INTEGER PRIMARY KEY,
      message_id INTEGER NOT NULL,
      rel_path TEXT NOT NULL, /* ruta relativa servible /uploads/... */
      mime TEXT,
      size INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(message_id) REFERENCES ticket_messages(id) ON DELETE CASCADE
    )
  `).run();
}
ensureSchema();

/* ===== Archivos (imágenes) ===== */
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
      // Guardamos primero en carpeta del ticket (viene en param :id)
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
  limits: { fileSize: 10 * 1024 * 1024, files: 4 }, // 10MB c/u, 4 máx.
  fileFilter: (req,file,cb)=>{
    if (ALLOWED[file.mimetype]) cb(null, true);
    else cb(new Error("Formato no permitido (usa JPG/PNG/WebP/GIF)"));
  }
});

/* ===== PAGE: /tickets ===== */
router.get("/", ensureAuth, (req,res)=>{
  const site = db.getSetting("site_name","SkyShop");
  const logo = db.getSetting("logo_url","");
  const u = req.session.user || {};
  const isAdmin = !!u.is_admin;

  const avatarUrl = (u.avatar_url || "").trim();
  const avatarLetter = String(u.name||"?").charAt(0).toUpperCase();
  const avatarHtml = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="avatar">` : `${avatarLetter}`;

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site)} · Soporte</title>
<style>
  :root{
    --bg:#0b1220; --txt:#e5e7eb; --muted:#9ca3af; --card:#111827; --line:#ffffff15;
    --accent:#f43f5e; --accent2:#fb7185; --radius:16px; --ok:#16a34a; --danger:#ef4444;
  }
  *{box-sizing:border-box}
  body{ margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu; background:var(--bg); color:var(--txt); min-height:100vh }
  /* en modo claro también redefinimos --line para que los bordes se vean */
  body.light{ --line:#00000018; background:#ffffff; color:#0b1220; }

  /* Top bar (con quick + burger) */
  .top{ position:sticky; top:0; z-index:7; backdrop-filter:blur(8px);
        background:linear-gradient(#0b1220cc,#0b1220aa); border-bottom:1px solid var(--line); }
  body.light .top{ background:linear-gradient(#fff8,#fff6); }
  .nav{ max-width:1100px; margin:0 auto; padding:10px 16px; display:flex; align-items:center; gap:12px; }
  .brand{ display:flex; align-items:center; gap:10px; }
  .brand img{ width:36px; height:36px; border-radius:8px; object-fit:cover; display:${logo ? 'block' : 'none'}; }
  .brand-name{ font-weight:900; letter-spacing:.2px; font-size:18px;
    background:linear-gradient(90deg,#ffffff,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent;}
  body.light .brand-name{ background:linear-gradient(90deg,#111111,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent;}

  .quick{display:flex;gap:8px;margin-left:6px}
  .qbtn{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;text-decoration:none;font-weight:700;
        background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff;border:1px solid #ffffff22}
  .qbtn svg{width:16px;height:16px}

  .grow{ flex:1 }
  .pill{ padding:8px 12px; border-radius:999px; background:#ffffff18; border:1px solid var(--line); color:inherit; text-decoration:none; cursor:pointer; display:inline-flex; align-items:center; gap:8px }
  body.light .pill{ background:#00000010; }

  .avatar{ width:32px; height:32px; border-radius:50%; background:#64748b; color:#fff; display:grid; place-items:center; font-weight:700; overflow:hidden }
  .avatar img{width:100%;height:100%;object-fit:cover;display:block}

  /* Drawer (menú lateral) */
  .burger{width:40px;height:40px;display:grid;place-items:center;border-radius:10px;border:1px solid #334155;background:transparent;cursor:pointer}
  .burger span{width:20px;height:2px;background:currentColor;position:relative;display:block}
  .burger span:before,.burger span:after{content:"";position:absolute;left:0;right:0;height:2px;background:currentColor}
  .burger span:before{top:-6px} .burger span:after{top:6px}
  .drawer{position:fixed;inset:0 auto 0 0;width:300px;transform:translateX(-100%);transition:transform .22s ease;z-index:8}
  .drawer.open{transform:none}
  .drawer .panel{height:100%;background:rgba(17,25,40,.85);backdrop-filter:blur(10px);border-right:1px solid var(--line);padding:14px}
  body.light .drawer .panel{background:#fff}
  .scrim{position:fixed;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(1px);opacity:0;visibility:hidden;transition:.18s ease;z-index:7}
  .scrim.show{opacity:1;visibility:visible}
  .navlist a{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #334155;border-radius:10px;margin-bottom:8px;color:inherit;text-decoration:none}
  .navlist a:hover{border-color:#64748b}
  .navlist svg{width:18px;height:18px;opacity:.95}

  /* Dropdown usuario */
  .udrop{ position:absolute; right:16px; top:60px; background:var(--card); border:1px solid var(--line); border-radius:12px;
          padding:10px; width:230px; box-shadow:0 10px 30px #0007; display:none; z-index:9 }
  body.light .udrop{ background:#fff; }
  .udrop a{ display:block; padding:8px 10px; border-radius:8px; color:inherit; text-decoration:none; }
  .udrop a:hover{ background:#ffffff12 } body.light .udrop a:hover{ background:#0000000a }

  /* Layout */
  .wrap{ position:relative; z-index:1; max-width:1100px; margin:0 auto; padding:18px 16px 40px; }
  .grid{ display:grid; grid-template-columns:320px 1fr; gap:14px; }
  @media(max-width:900px){ .grid{ grid-template-columns:1fr; } }

  .card{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:14px; }
  body.light .card{ background:#fff; }

  .seg{display:inline-flex;border:1px solid #334155;border-radius:999px;overflow:hidden}
  body.light .seg{border-color:#00000018}
  .seg button{padding:8px 12px;background:transparent;border:0;color:inherit;cursor:pointer}
  .seg button.active{background:#1f2a44;color:#fff}
  body.light .seg button.active{background:#eef2ff;color:#111}

  .input, textarea{ width:100%; padding:10px 12px; border-radius:10px; border:1px solid #293245; background:#0f172a; color:inherit; }
  body.light .input, body.light textarea{ background:#fff; border-color:#00000022 }
  textarea{ min-height:110px; resize:vertical }

  .list{ display:flex; flex-direction:column; gap:8px; }
  .item{ display:flex; gap:8px; align-items:flex-start; padding:10px; border:1px solid var(--line); border-radius:12px; }
  .item h4{ margin:0 0 4px 0; font-size:15px }
  .tag{ display:inline-block; font-size:12px; padding:4px 8px; border-radius:999px; border:1px solid var(--line); }
  .muted{ color:var(--muted) }
  .right{ display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap }

  .bubble{ padding:10px 12px; border-radius:12px; border:1px solid var(--line); background:#0e1a2f; max-width:740px; color:inherit }
  body.light .bubble{ background:#f8fafc; border-color:#00000018; color:#0b1220 }
  .me{ background:linear-gradient(90deg,var(--accent),var(--accent2)); color:#fff; border:0 }
  .meta{ font-size:12px; color:var(--muted); margin:6px 0 0 }
  .thumbs{ display:flex; gap:8px; flex-wrap:wrap; margin-top:6px }
  .thumbs img{ width:120px; height:90px; object-fit:cover; border-radius:8px; border:1px solid var(--line); cursor:pointer }

  .hint{ font-size:12px; color:var(--muted); }
  .btn{ display:inline-flex; align-items:center; gap:8px; padding:10px 12px; border-radius:10px; background:#1f2a44; color:#fff; border:1px solid #334155; cursor:pointer; text-decoration:none }
  .btn.pink{ background:linear-gradient(90deg,var(--accent),var(--accent2)); border:0 }
  .btn.ghost{ background:transparent; border-color:#334155; color:inherit }
  .btn[disabled]{ opacity:.6; cursor:not-allowed }

  /* Visor de imágenes (overlay) */
  .viewer{ position:fixed; inset:0; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,.8); z-index:20; }
  .viewer.show{ display:flex; }
  .viewer img{ max-width:92vw; max-height:90vh; border-radius:12px; box-shadow:0 10px 40px #000a; background:#fff }
  .viewer .close{ position:absolute; top:14px; right:14px; border:0; border-radius:999px; padding:8px 10px; font-weight:900; cursor:pointer; }
</style>
<body>
  <!-- Drawer -->
  <div class="drawer" id="drawer">
    <div class="panel">
      <h3 style="margin:0 0 10px">Menú</h3>
      <nav class="navlist">
        <a href="/">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3 1 8h2v5h4V9h2v4h4V8h2L8 3z"/></svg>
          Inicio
        </a>
        <a href="/invoices">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>
          Mis facturas
        </a>
        <a href="/services">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>
          Mis servicios
        </a>
        <a href="/tickets">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0-1 1 1 1 0 0 0 1 1v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a1 1 0 0 0 1-1 1 1 0 0 0-1-1V5Z"/></svg>
          Soporte
        </a>
        <a href="/profile">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7v-1a5 5 0 0 1 10 0v1H3z"/></svg>
          Mi perfil
        </a>
        ${isAdmin ? `
        <a href="/admin">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M7 1h2l1 3h3l-2 2 1 3-3-1-2 2-2-2-3 1 1-3L1 4h3l1-3z"/></svg>
          Admin
        </a>` : ``}
        <a href="/logout">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h3v2H6v8h3v2H4V2h2zm7 6-3-3v2H7v2h3v2l3-3z"/></svg>
          Salir
        </a>
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

        <!-- Accesos rápidos como en dashboard -->
        <div class="quick">
          <a class="qbtn" href="/">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3 1 8h2v5h4V9h2v4h4V8h2L8 3z"/></svg>
            Inicio
          </a>
          <a class="qbtn" href="/invoices">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>
            Facturas
          </a>
          <a class="qbtn" href="/services">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>
            Servicios
          </a>
        </div>
      </div>

      <div class="grow"></div>
      <button id="mode" class="pill" type="button" aria-label="Cambiar tema">🌙</button>

      <div id="ua" class="pill" style="position:relative;cursor:pointer">
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
  </header>

  <main class="wrap">
    <div class="grid">
      <!-- Lista + crear -->
      <section class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
          <div class="seg">
            <button id="tabOpen" class="active" type="button">Abiertos</button>
            <button id="tabClosed" type="button">Cerrados</button>
          </div>
          <button id="btnNew" class="btn pink" type="button">+ Nuevo ticket</button>
        </div>

        <div id="ticketList" class="list" aria-live="polite">
          <div class="muted">Cargando…</div>
        </div>

        <!-- Nuevo ticket -->
        <div id="newWrap" style="margin-top:12px;display:none">
          <h3>Nuevo ticket</h3>
          <div class="label">Asunto</div>
          <input id="newSubject" class="input" maxlength="120" placeholder="Ej. Problema con mi producto">
          <div class="label" style="margin-top:6px">Mensaje</div>
          <textarea id="newBody" placeholder="Describe tu problema con detalle…"></textarea>
          <div class="right" style="margin-top:10px">
            <button id="cancelNew" class="btn ghost" type="button">Cancelar</button>
            <button id="createNew" class="btn pink" type="button">Crear ticket</button>
          </div>
          <div id="newMsg" class="hint" style="margin-top:6px"></div>
        </div>
      </section>

      <!-- Conversación -->
      <section class="card">
        <div id="convWrap">
          <div class="muted">Selecciona un ticket para ver la conversación.</div>
        </div>
      </section>
    </div>
  </main>

  <!-- Visor de imágenes -->
  <div id="viewer" class="viewer" role="dialog" aria-modal="true" aria-hidden="true">
    <img id="viewerImg" alt="Imagen adjunta">
    <button id="viewerClose" class="close pill" type="button">✕</button>
  </div>

<script>
(function(){
  /* Tema */
  const modeBtn = document.getElementById('mode');
  function apply(mode){
    const light = (mode==='light');
    document.body.classList.toggle('light', light);
    modeBtn.textContent = light ? '☀️' : '🌙';
    localStorage.setItem('mode', light ? 'light' : 'dark');
  }
  apply(localStorage.getItem('mode') || 'dark');
  modeBtn.addEventListener('click', ()=>apply(document.body.classList.contains('light')?'dark':'light'));

  /* Drawer */
  (function(){
    const drawer = document.getElementById('drawer');
    const scrim  = document.getElementById('scrim');
    const btn    = document.getElementById('menuBtn');
    function open(){ drawer.classList.add('open'); scrim.classList.add('show'); }
    function close(){ drawer.classList.remove('open'); scrim.classList.remove('show'); }
    btn.addEventListener('click', open);
    scrim.addEventListener('click', close);
    window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });
  })();

  /* Dropdown usuario */
  (function(){
    const a=document.getElementById('ua'), d=document.getElementById('udrop');
    let open=false;
    a.addEventListener('click', (e)=>{ e.stopPropagation(); open=!open; d.style.display = open? 'block':'none'; });
    document.addEventListener('click', ()=>{ if(open){ open=false; d.style.display='none'; }});
  })();

  /* Estado UI */
  let currentTab = 'open';
  let currentTicket = 0;

  const listEl = document.getElementById('ticketList');
  const convWrap = document.getElementById('convWrap');
  const tabOpen = document.getElementById('tabOpen');
  const tabClosed = document.getElementById('tabClosed');
  tabOpen.onclick = ()=>{ currentTab='open'; tabOpen.classList.add('active'); tabClosed.classList.remove('active'); loadList(); };
  tabClosed.onclick = ()=>{ currentTab='closed'; tabClosed.classList.add('active'); tabOpen.classList.remove('active'); loadList(); };

  /* Nuevo ticket */
  const btnNew = document.getElementById('btnNew');
  const newWrap = document.getElementById('newWrap');
  const newSubject = document.getElementById('newSubject');
  const newBody = document.getElementById('newBody');
  const newMsg = document.getElementById('newMsg');
  document.getElementById('cancelNew').onclick = ()=>{ newWrap.style.display='none'; newSubject.value=''; newBody.value=''; newMsg.textContent=''; };
  btnNew.onclick = ()=>{ newWrap.style.display = newWrap.style.display==='none' ? 'block' : 'none'; };

  document.getElementById('createNew').addEventListener('click', async ()=>{
    newMsg.textContent='';
    const subject = newSubject.value.trim();
    const body    = newBody.value.trim();
    if (!subject){ newMsg.textContent='Escribe un asunto.'; return; }
    try{
      const r = await fetch('/tickets/api/new', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({subject, body}) });
      const d = await r.json();
      if(!r.ok || !d.ok){ newMsg.textContent = d.error || ('Error '+r.status); return; }
      newWrap.style.display = 'none';
      newSubject.value=''; newBody.value='';
      currentTab = 'open';
      await loadList();
      openTicket(d.id);
    }catch(e){ newMsg.textContent = 'Error: '+(e.message||e); }
  });

  /* Lista */
  async function loadList(){
    listEl.innerHTML = '<div class="muted">Cargando…</div>';
    try{
      const r = await fetch('/tickets/api/list?status='+currentTab, {cache:'no-store'});
      const d = await r.json();
      if(!Array.isArray(d) || !d.length){
        listEl.innerHTML = '<div class="muted">No hay tickets '+ (currentTab==='open'?'abiertos.':'cerrados.') +'</div>';
        convWrap.innerHTML = '<div class="muted">Selecciona un ticket para ver la conversación.</div>';
        return;
      }
      listEl.innerHTML = d.map(x => (
        '<div class="item" data-id="'+x.id+'" style="cursor:pointer">'
        +  '<div style="flex:1">'
        +    '<h4>'+escapeHtml(x.subject||'Ticket #'+x.id)+'</h4>'
        +    '<div class="muted" style="font-size:12px">#'+x.id+' · '+(x.status||'')+' · '+(x.created_at||'')+'</div>'
        +  '</div>'
        +  '<span class="tag">'+(x.status==='open'?'Abierto':'Cerrado')+'</span>'
        +'</div>'
      )).join('');
    }catch{
      listEl.innerHTML = '<div class="muted">Error cargando.</div>';
    }
  }
  function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  listEl.addEventListener('click', (e)=>{
    const it = e.target.closest('.item'); if(!it) return;
    openTicket(Number(it.getAttribute('data-id')||0));
  });

  /* Abrir conversación */
  async function openTicket(id){
    if(!id) return;
    currentTicket = id;
    convWrap.innerHTML = '<div class="muted">Cargando conversación…</div>';
    try{
      const r = await fetch('/tickets/api/'+id, {cache:'no-store'});
      const d = await r.json();
      if(!r.ok || d.error){ convWrap.innerHTML = '<div class="muted">'+(d.error||('Error '+r.status))+'</div>'; return; }

      if (d.closed){
        convWrap.innerHTML =
          '<h3>Ticket #'+id+' · '+escapeHtml(d.subject||'')+'</h3>'
          + '<div class="muted" style="margin:8px 0">Este ticket está cerrado. La conversación se conserva para soporte, pero ya no es visible para el cliente.</div>';
        return;
      }

      function bubble(m){
        const isMe = m.sender==='user';
        const imgs = (m.files||[]).map(u=>'<img src="'+u+'" alt="adjunto">').join('');
        return '<div>'
              +  '<div class="bubble '+(isMe?'me':'')+'">'+(escapeHtml(m.body||'')||'<i>(sin texto)</i>')
              +    (imgs?('<div class="thumbs">'+imgs+'</div>'):'')
              +  '</div>'
              +  '<div class="meta">'+escapeHtml(m.sender)+' · '+escapeHtml((m.created_at||'').replace('T',' ').slice(0,19))+'</div>'
              +'</div>';
      }

      convWrap.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
        +  '<h3 style="margin:0">Ticket #'+id+' · '+escapeHtml(d.subject||'')+'</h3>'
        +  '<button id="btnClose" class="btn ghost" type="button">Cerrar ticket</button>'
        +'</div>'
        + '<div id="msgs" class="list">'+ (d.messages||[]).map(bubble).join('') +'</div>'
        + '<div style="height:10px"></div>'
        + '<div id="composer">'
        +   '<div class="label">Escribe un mensaje</div>'
        +   '<textarea id="msgBody" placeholder="Tu respuesta…"></textarea>'
        +   '<div class="right" style="margin-top:8px">'
        +     '<label class="btn" style="position:relative;overflow:hidden">'
        +       '<input id="files" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple style="position:absolute;inset:0;opacity:0;cursor:pointer">'
        +       'Subir imagen'
        +     '</label>'
        +     '<button id="send" class="btn pink" type="button">Enviar</button>'
        +   '</div>'
        +   '<div id="sendMsg" class="hint" style="margin-top:6px"></div>'
        + '</div>';

      document.getElementById('btnClose').onclick = async ()=>{
        if(!confirm('¿Cerrar este ticket? No podrás ver la conversación luego.')) return;
        const r = await fetch('/tickets/api/'+id+'/close',{method:'POST'});
        const t = await r.json().catch(()=>({}));
        if(!r.ok || !t.ok){ alert(t.error||('Error '+r.status)); return; }
        currentTab = 'closed';
        tabClosed.click();
        openTicket(id);
      };

      document.getElementById('send').onclick = sendMessage;
      async function sendMessage(){
        const sendMsg = document.getElementById('sendMsg');
        sendMsg.textContent = '';
        const body = document.getElementById('msgBody').value.trim();
        const files = document.getElementById('files').files;
        if (!body && (!files || !files.length)){ sendMsg.textContent='Escribe un mensaje o añade una imagen.'; return; }
        try{
          const fd = new FormData();
          fd.append('body', body);
          Array.from(files||[]).slice(0,4).forEach(f=>fd.append('images', f));
          const r = await fetch('/tickets/api/'+id+'/message', { method:'POST', body: fd });
          const d = await r.json();
          if(!r.ok || !d.ok){ sendMsg.textContent = d.error || ('Error '+r.status); return; }
          document.getElementById('msgBody').value='';
          document.getElementById('files').value='';

          // Agregar el último mensaje a la vista
          const msgs = document.getElementById('msgs');
          const last = d.message;
          const imgs = (last.files||[]).map(u=>'<img src="'+u+'" alt="adjunto">').join('');
          msgs.insertAdjacentHTML('beforeend',
            '<div>'
            +  '<div class="bubble me">'+(escapeHtml(last.body||'')||'<i>(sin texto)</i>')+(imgs?('<div class="thumbs">'+imgs+'</div>'):'')
            +  '</div>'
            +  '<div class="meta">user · '+escapeHtml((last.created_at||'').replace('T',' ').slice(0,19))+'</div>'
            +'</div>'
          );
          msgs.lastElementChild.scrollIntoView({behavior:'smooth',block:'end'});
          loadList(); // refresca lista (última actividad)
        }catch(e){ sendMsg.textContent = 'Error: '+(e.message||e); }
      }

      // Visor para imágenes (delegado)
      const viewer      = document.getElementById('viewer');
      const viewerImg   = document.getElementById('viewerImg');
      const viewerClose = document.getElementById('viewerClose');
      function openViewer(src){
        viewerImg.src = src;
        viewer.classList.add('show');
        viewer.setAttribute('aria-hidden','false');
      }
      function closeViewer(){
        viewer.classList.remove('show');
        viewer.setAttribute('aria-hidden','true');
        viewerImg.src = '';
      }
      viewerClose.onclick = closeViewer;
      viewer.addEventListener('click', (e)=>{ if(e.target === viewer) closeViewer(); });
      window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeViewer(); });

      convWrap.addEventListener('click', (e)=>{
        const t = e.target;
        if (t && t.tagName === 'IMG' && t.closest('.thumbs')) {
          openViewer(t.src);
        }
      });

    }catch(e){
      convWrap.innerHTML = '<div class="muted">Error: '+(e.message||e)+'</div>';
    }
  }

  loadList();
})();
</script>
</body>
</html>`);
});

/* ===== APIs Usuario ===== */

/* Listar tickets del usuario */
router.get("/api/list", ensureAuth, (req,res)=>{
  const uid = Number(req.session.user.id);
  const status = (String(req.query.status||"open").toLowerCase()==="closed") ? "closed" : "open";
  try{
    const rows = db.prepare(`
      SELECT id, subject, status, created_at, last_reply_at
      FROM tickets
      WHERE user_id=? AND status=?
      ORDER BY datetime(COALESCE(last_reply_at, created_at)) DESC, id DESC
      LIMIT 300
    `).all(uid, status);
    res.json(rows);
  }catch(e){
    res.status(500).json({error:e?.message||"list"});
  }
});

/* Crear ticket (primer mensaje opcional) */
router.post("/api/new", ensureAuth, express.json({limit:"2mb"}), (req,res)=>{
  try{
    const uid = Number(req.session.user.id);
    const subject = String(req.body?.subject||"").trim();
    const body    = String(req.body?.body||"").trim();
    if (!subject) return res.status(400).json({ok:false,error:"Asunto requerido"});

    const tx = db.transaction(()=>{
      const now = new Date().toISOString();
      const tRes = db.prepare(`
        INSERT INTO tickets(user_id,subject,status,created_at,last_reply_at,last_sender,unread_admin,unread_user)
        VALUES(?,?, 'open', ?, ?, 'user', 1, 0)
      `).run(uid, subject, now, body ? now : null);
      const tid = Number(tRes.lastInsertRowid);
      if (body){
        db.prepare(`INSERT INTO ticket_messages(ticket_id,sender,body,created_at) VALUES(?, 'user', ?, ?)`)
          .run(tid, body, now);
      }
      return tid;
    });
    const id = tx();
    res.json({ok:true, id});
  }catch(e){
    res.status(500).json({ok:false,error:e?.message||"new"});
  }
});

/* Ver ticket (si está cerrado NO devolvemos mensajes al usuario) */
router.get("/api/:id", ensureAuth, (req,res)=>{
  const uid = Number(req.session.user.id);
  const id  = Number(req.params.id||0);
  if(!id) return res.status(400).json({error:"Falta id"});

  const t = db.prepare(`SELECT id, user_id, subject, status, created_at, closed_at FROM tickets WHERE id=?`).get(id);
  if(!t || t.user_id !== uid) return res.status(404).json({error:"No encontrado"});

  if (String(t.status).toLowerCase() === "closed"){
    return res.json({ id:t.id, subject:t.subject, closed:true, closed_at:t.closed_at });
  }

  const msgs = db.prepare(`
    SELECT id, sender, body, created_at
    FROM ticket_messages WHERE ticket_id=? ORDER BY id ASC
  `).all(id).map(m => ({ ...m, files: getFilesForMessage(m.id) }));

  db.prepare(`UPDATE tickets SET unread_user=0 WHERE id=?`).run(id);

  res.json({ id:t.id, subject:t.subject, status:t.status, created_at:t.created_at, messages: msgs });
});

/* Responder con texto/imágenes (solo si está abierto) */
router.post("/api/:id/message", ensureAuth, (req,res)=>{
  const uid = Number(req.session.user.id);
  const id  = Number(req.params.id||0);
  if(!id) return res.status(400).json({ok:false,error:"Falta id"});

  const t = db.prepare(`SELECT id,user_id,status FROM tickets WHERE id=?`).get(id);
  if(!t || t.user_id !== uid) return res.status(404).json({ok:false,error:"No encontrado"});
  if (String(t.status).toLowerCase() !== "open") return res.status(400).json({ok:false,error:"Ticket cerrado"});

  upload.array("images", 4)(req,res,(err)=>{
    if (err) return res.status(400).json({ok:false,error:err.message||"upload"});
    try{
      const body = String(req.body?.body||"").trim();
      if (!body && !(req.files && req.files.length)) {
        return res.status(400).json({ok:false,error:"Mensaje vacío"});
      }

      const now = new Date().toISOString();
      const mRes = db.prepare(`
        INSERT INTO ticket_messages(ticket_id,sender,body,created_at)
        VALUES(?, 'user', ?, ?)
      `).run(id, body, now);
      const mid = Number(mRes.lastInsertRowid);

      const base = path.join(TICK_DIR, `t-${id}`);
      ensureDir(base);
      const rels = [];
      for (const f of (req.files||[])){
        const ext = ALLOWED[f.mimetype] || "bin";
        const abs = path.resolve(f.path);
        if (!abs.startsWith(base)) continue;
        const rel = "/uploads/tickets/" + path.relative(TICK_DIR, abs).replace(/\\/g,"/");
        db.prepare(`INSERT INTO ticket_files(message_id,rel_path,mime,size) VALUES(?,?,?,?)`)
          .run(mid, rel, f.mimetype, f.size);
        rels.push(rel);
      }

      db.prepare(`UPDATE tickets SET last_reply_at=?, last_sender='user', unread_admin=1 WHERE id=?`).run(now, id);

      res.json({ ok:true, message:{ id:mid, sender:"user", body, created_at: now, files: rels } });
    }catch(e){
      res.status(500).json({ok:false,error:e?.message||"message"});
    }
  });
});

/* Cerrar ticket (usuario) */
router.post("/api/:id/close", ensureAuth, (req,res)=>{
  const uid = Number(req.session.user.id);
  const id  = Number(req.params.id||0);
  if(!id) return res.status(400).json({ok:false,error:"Falta id"});

  const t = db.prepare(`SELECT id,user_id,status FROM tickets WHERE id=?`).get(id);
  if(!t || t.user_id !== uid) return res.status(404).json({ok:false,error:"No encontrado"});
  if (String(t.status).toLowerCase() === "closed") return res.json({ok:true});

  db.prepare(`UPDATE tickets SET status='closed', closed_at=?, unread_user=0 WHERE id=?`)
    .run(new Date().toISOString(), id);
  res.json({ok:true});
});

/* ===== util: archivos por mensaje ===== */
function getFilesForMessage(message_id){
  try{
    const rows = db.prepare(`SELECT rel_path FROM ticket_files WHERE message_id=? ORDER BY id ASC`).all(message_id) || [];
    return rows.map(r => String(r.rel_path||""));
  }catch{ return []; }
}

module.exports = router;