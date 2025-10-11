// profile.js — Página "Mi perfil" (drawer, tema, avatar 15MB con multer, edición de datos + password con bcrypt)
"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const db = require("./db");

const router = express.Router();

/* ───────── Middlewares base ───────── */
// Solo JSON pequeño para /api/update
router.use(express.json({ limit: "2mb" }));

function ensureAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}

/* ───────── Utilidades ───────── */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function formatAmount(value, currency){
  const n = Number(value || 0);
  return currency === "USD" ? `$ ${n.toFixed(2)}` : `MXN ${n.toFixed(2)}`;
}
function ensureDir(dir){ if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true }); }

/* ───────── Asegura columna avatar_url en users ───────── */
try { db.prepare(`ALTER TABLE users ADD COLUMN avatar_url TEXT`).run(); } catch {}

/* ───────── Multer para subir avatar (15MB, JPG/PNG/WebP) ───────── */
const AVA_DIR = path.resolve(process.cwd(), "uploads", "avatars");
ensureDir(AVA_DIR);
const MIME_TO_EXT = { "image/png":"png", "image/jpeg":"jpg", "image/webp":"webp" };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVA_DIR),
  filename: (req, file, cb) => {
    const uid = req.session?.user?.id || "x";
    const ext = MIME_TO_EXT[file.mimetype] || "jpg";
    // elimina versiones previas con cualquier extensión
    for (const e of Object.values(MIME_TO_EXT)) {
      const p = path.join(AVA_DIR, `u-${uid}.${e}`);
      if (fs.existsSync(p)) { try{ fs.unlinkSync(p); }catch{} }
    }
    cb(null, `u-${uid}.${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    if (MIME_TO_EXT[file.mimetype]) cb(null, true);
    else cb(new Error("Tipo no permitido (usa JPG/PNG/WebP)"));
  }
});

/* ───────── PAGE: /profile ───────── */
router.get("/", ensureAuth, (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  const logo = db.getSetting("logo_url", "");
  const u = req.session.user || {};
  const isAdmin = !!u.is_admin;

  // Saldos
  const usd = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='USD'`).get(u.id) || { balance: 0 };
  const mxn = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='MXN'`).get(u.id) || { balance: 0 };

  const avatarUrl = u.avatar_url ? esc(u.avatar_url) : "";
  const avatarLetter = esc((u.name || "?").charAt(0).toUpperCase());

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site)} · Mi perfil</title>
<style>
  :root{
    --bg:#0b1220; --txt:#e5e7eb; --muted:#9ca3af; --card:#111827; --line:#ffffff15;
    --accent:#f43f5e; --accent2:#fb7185; --radius:16px; --ok:#16a34a; --danger:#ef4444;
  }
  *{box-sizing:border-box}
  body{ margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu; background:var(--bg); color:var(--txt); min-height:100vh; overflow-x:hidden; }
  body.light{ background:#ffffff; color:#0b1220; }

  .top{ position:sticky; top:0; z-index:6; backdrop-filter:blur(8px);
        background:linear-gradient(#0b1220cc,#0b1220aa); border-bottom:1px solid var(--line); }
  body.light .top{ background:linear-gradient(#fff8,#fff6); }
  .nav{ max-width:1100px; margin:0 auto; padding:10px 16px; display:flex; align-items:center; gap:12px; }
  .brand{ display:flex; align-items:center; gap:10px; }
  .brand img{ width:36px; height:36px; border-radius:8px; object-fit:cover; display:${logo ? 'block' : 'none'}; }
  .brand-name{ font-weight:900; letter-spacing:.2px; font-size:18px;
    background:linear-gradient(90deg,#ffffff,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent;}
  body.light .brand-name{ background:linear-gradient(90deg,#111111,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent;}

  /* Accesos rápidos */
  .quick{ display:flex; gap:8px; margin-left:6px; }
  .qbtn{ display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:999px; text-decoration:none; font-weight:700;
         background:linear-gradient(90deg,var(--accent),var(--accent2)); color:#fff; border:1px solid #ffffff22; }
  .qbtn svg{width:16px;height:16px}

  .grow{ flex:1 }
  .pill{ padding:8px 12px; border-radius:999px; background:#ffffff18; border:1px solid #ffffff28; color:inherit; text-decoration:none; cursor:pointer; }
  body.light .pill{ background:#00000010; border-color:#00000018; }
  .avatar{ width:32px; height:32px; border-radius:50%; background:#64748b; color:#fff; display:grid; place-items:center; font-weight:700; overflow:hidden; }
  .avatar img{width:100%;height:100%;object-fit:cover;display:block}

  /* Dropdown usuario */
  .udrop{ position:absolute; right:16px; top:60px; background:var(--card); border:1px solid var(--line); border-radius:12px;
          padding:10px; width:230px; box-shadow:0 10px 30px #0007; display:none; z-index:8 }
  body.light .udrop{ background:#fff; }
  .udrop a{ display:block; padding:8px 10px; border-radius:8px; color:inherit; text-decoration:none; }
  .udrop a:hover{ background:#ffffff12 } body.light .udrop a:hover{ background:#0000000a }

  /* Drawer */
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

  .wrap{ position:relative; z-index:1; max-width:1100px; margin:0 auto; padding:18px 16px 60px; }
  .title{ font-size:26px; font-weight:900; margin:8px 0 2px; }
  .muted{ color:var(--muted) }

  .grid{ display:grid; grid-template-columns:2fr 3fr; gap:16px; margin-top:14px; }
  @media(max-width:880px){ .grid{ grid-template-columns:1fr; } }

  .card{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:14px; }
  body.light .card{ background:#fff; }
  .card h3{ margin:2px 0 10px; font-size:18px }

  .avatarWrap{ display:flex; gap:14px; align-items:center; }
  .bigAvatar{ width:92px; height:92px; border-radius:50%; background:#374151; overflow:hidden; display:grid; place-items:center; font-size:32px; font-weight:900; color:#fff }
  .bigAvatar img{ width:100%; height:100%; object-fit:cover; display:block }
  .btn{ display:inline-flex; align-items:center; gap:8px; padding:10px 12px; border-radius:10px; background:#1f2a44; color:#fff; border:1px solid #334155; cursor:pointer; text-decoration:none }
  .btn.pink{ background:linear-gradient(90deg,var(--accent),var(--accent2)); border:0 }
  .hint{ font-size:12px; color:var(--muted); }

  .form{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .full{ grid-column:1/-1 }
  .label{ font-size:12px; color:var(--muted); margin-bottom:4px }
  .input{ width:100%; padding:10px 12px; border-radius:10px; border:1px solid #293245; background:#0f172a; color:inherit }
  body.light .input{ background:#fff; border-color:#00000022 }

  .pw{ position:relative }
  .eye{ position:absolute; right:10px; top:50%; transform:translateY(-50%); cursor:pointer; opacity:.8; user-select:none; width:22px; height:22px }
  .eye:hover{ opacity:1 }

  .row{ display:flex; gap:8px; align-items:center; flex-wrap:wrap }
  .right{ display:flex; justify-content:flex-end; gap:8px; }
  .ok{ color:#16a34a; }
  .err{ color:#ef4444; }
  .msg{ font-size:13px; margin-top:6px; }
</style>
<body>
  <!-- Drawer -->
  <div class="drawer" id="drawer">
    <div class="panel">
      <h3 style="margin:0 0 10px">Menú</h3>
      <nav class="navlist">
        <a href="/"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3 1 8h2v5h4V9h2v4h4V8h2L8 3z"/></svg>Inicio</a>
        <a href="/invoices"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>Mis facturas</a>
        <a href="/services"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>Mis servicios</a>
        <a href="/tickets"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5a2 2 0 0 1 2-2h10a2 2 0  0 1 2 2v2a1 1 0 0 0-1 1 1 1 0  0 0 1 1v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a1 1 0 0 0 1-1 1 1 0 0 0-1-1V5Z"/></svg>Soporte</a>
        <a href="/profile"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7v-1a5 5 0 0 1 10 0v1H3z"/></svg>Mi perfil</a>
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
    <div class="title">Mi perfil</div>
    <div class="muted">Actualiza tu información personal, usuario/correo, contraseña y foto de perfil.</div>

    <!-- Saldos (sin botón de comprar) -->
    <section style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:10px 0 6px">
      <div class="card">
        <div class="muted">Crédito en USD</div>
        <div style="font-size:22px;font-weight:900;margin-top:6px">${formatAmount(usd.balance, "USD")}</div>
      </div>
      <div class="card">
        <div class="muted">Crédito en MXN</div>
        <div style="font-size:22px;font-weight:900;margin-top:6px">${formatAmount(mxn.balance, "MXN")}</div>
      </div>
    </section>

    <section class="grid">
      <!-- Avatar -->
      <div class="card">
        <h3>Foto de perfil</h3>
        <div class="avatarWrap">
          <div id="bigAvatar" class="bigAvatar">${avatarUrl ? `<img src="${avatarUrl}" alt="avatar">` : `${avatarLetter}`}</div>
          <div class="col">
            <div class="row">
              <label class="btn">
                <input id="avatarInput" type="file" accept="image/png,image/jpeg,image/webp" style="display:none">
                Cambiar foto
              </label>
              <button id="rmAvatar" class="btn" type="button">Quitar</button>
              <button id="saveAvatar" class="btn pink" type="button" disabled>Guardar</button>
            </div>
            <div class="hint">Formatos: JPG/PNG/WebP · Máx. 15MB</div>
            <div id="avatarMsg" class="msg"></div>
          </div>
        </div>
      </div>

      <!-- Datos + contraseña -->
      <div class="card">
        <h3>Datos de la cuenta</h3>
        <div class="form">
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

          <div class="full"><hr style="border:0;border-top:1px solid var(--line)"></div>

          <div class="pw">
            <div class="label">Nueva contraseña</div>
            <input id="pw1" class="input" type="password" placeholder="••••••">
            <span class="eye" data-eye="pw1" aria-label="Ver/ocultar">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5c5.5 0 9.5 4.5 10 7-.5 2.5-4.5 7-10 7S2.5 14.5 2 12c.5-2.5 4.5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/></svg>
            </span>
          </div>
          <div class="pw">
            <div class="label">Repite la contraseña</div>
            <input id="pw2" class="input" type="password" placeholder="••••••">
            <span class="eye" data-eye="pw2" aria-label="Ver/ocultar">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5c5.5 0 9.5 4.5 10 7-.5 2.5-4.5 7-10 7S2.5 14.5 2 12c.5-2.5 4.5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/></svg>
            </span>
          </div>

          <div class="full right">
            <button id="saveBtn" class="btn pink" type="button">Guardar cambios</button>
          </div>
          <div id="msg" class="full msg"></div>
        </div>
      </div>
    </section>
  </main>

<script>
  // Drawer
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

  // Tema 🌙/☀️
  (function(){
    const btn = document.getElementById('mode');
    function apply(mode){
      const light = (mode==='light');
      document.body.classList.toggle('light', light);
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

  // Ver/ocultar password (cambia a ojo tachado)
  function toggleEye(el, input){
    const isPwd = input.type === 'password';
    input.type = isPwd ? 'text' : 'password';
    el.innerHTML = isPwd
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3 21 21l-1.5 1.5L17.2 19C15.8 19.6 14 20 12 20 6.5 20 2.5 15.5 2 13c.2-.9 1-2.2 2.2-3.6L1.5 4.5 3 3Zm6.9 6.9A4 4 0 0 0 12 16a4 4 0 0 0 2.1-.6l-4.2-4.2ZM12 5c5.5 0 9.5 4.5 10 7-.3 1.6-2.1 4.2-5 5.8l-1.8-1.8A6 6 0 0 0 7 9.8L5.4 8.2C7.5 6.3 9.9 5 12 5Z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5c5.5 0 9.5 4.5 10 7-.5 2.5-4.5 7-10 7S2.5 14.5 2 12c.5-2.5 4.5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/></svg>';
  }
  document.querySelectorAll('.eye').forEach(el=>{
    el.addEventListener('click', ()=>{
      const id = el.getAttribute('data-eye');
      const input = document.getElementById(id);
      if (input) toggleEye(el, input);
    });
  });

  // Guardar perfil (incluye password opcional)
  async function saveProfile(){
    const btn = document.getElementById('saveBtn');
    const msg = document.getElementById('msg');
    msg.textContent = '';
    const payload = {
      name: document.getElementById('name').value.trim(),
      surname: document.getElementById('surname').value.trim(),
      username: document.getElementById('username').value.trim(),
      email: document.getElementById('email').value.trim(),
      pw1: document.getElementById('pw1').value,
      pw2: document.getElementById('pw2').value
    };
    btn.disabled = true;
    try{
      const r = await fetch('/profile/api/update', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      if (!r.ok || !data.ok){
        msg.innerHTML = '<span class="err">'+(data.error || ('Error '+r.status))+'</span>';
        btn.disabled = false; return;
      }
      msg.innerHTML = '<span class="ok">Cambios guardados.</span>';
      document.getElementById('pw1').value = '';
      document.getElementById('pw2').value = '';
      document.querySelector('#ua span').textContent = payload.username || '';
    }catch(e){
      msg.innerHTML = '<span class="err">Error: '+(e.message||e)+'</span>';
    }finally{
      btn.disabled = false;
    }
  }
  document.getElementById('saveBtn').addEventListener('click', saveProfile);

  // Avatar (multipart/form-data)
  let selectedFile = null;
  const avatarMsg = document.getElementById('avatarMsg');
  const bigAvatar = document.getElementById('bigAvatar');

  document.getElementById('avatarInput').addEventListener('change', (e)=>{
    const f = e.target.files && e.target.files[0];
    avatarMsg.textContent = '';
    selectedFile = null;
    if (!f) return;
    if (f.size > 15*1024*1024){ avatarMsg.innerHTML='<span class="err">El archivo supera 15MB.</span>'; return; }
    if (!/^image\\/(png|jpe?g|webp)$/i.test(f.type)){ avatarMsg.innerHTML='<span class="err">Formato no permitido.</span>'; return; }
    selectedFile = f;
    const url = URL.createObjectURL(f);
    bigAvatar.innerHTML = '<img src="'+url+'" alt="avatar">';
    document.getElementById('saveAvatar').disabled = false;
  });

  document.getElementById('rmAvatar').addEventListener('click', async ()=>{
    try{
      const r = await fetch('/profile/api/avatar-remove',{method:'POST'});
      const data = await r.json();
      if(!data.ok) throw new Error(data.error||'remove');
      bigAvatar.textContent = '${avatarLetter}';
      const pill = document.querySelector('#ua .avatar');
      pill.textContent = '${avatarLetter}';
      avatarMsg.innerHTML = '<span class="ok">Foto eliminada.</span>';
      document.getElementById('saveAvatar').disabled = true;
      selectedFile = null;
    }catch(e){
      avatarMsg.innerHTML = '<span class="err">Error: '+(e.message||e)+'</span>';
    }
  });

  document.getElementById('saveAvatar').addEventListener('click', async ()=>{
    if(!selectedFile){ avatarMsg.innerHTML='<span class="err">Selecciona una imagen.</span>'; return; }
    const btn = document.getElementById('saveAvatar');
    btn.disabled = true; avatarMsg.textContent='';
    try{
      const fd = new FormData();
      fd.append('avatar', selectedFile);
      const r = await fetch('/profile/api/avatar', { method:'POST', body: fd });
      const data = await r.json();
      if(!r.ok || !data.ok){ avatarMsg.innerHTML='<span class="err">'+(data.error||('Error '+r.status))+'</span>'; btn.disabled=false; return; }
      const pill = document.querySelector('#ua .avatar');
      // data.url ya incluye ?v=timestamp para bustear caché
      pill.innerHTML = '<img src="'+data.url+'" alt="avatar">';
      bigAvatar.innerHTML = '<img src="'+data.url+'" alt="avatar">';
      avatarMsg.innerHTML = '<span class="ok">Foto actualizada.</span>';
      btn.disabled = true;
    }catch(e){
      avatarMsg.innerHTML = '<span class="err">Error: '+(e.message||e)+'</span>';
      btn.disabled = false;
    }
  });
</script>
</body>
</html>`);
});

/* ───────── API: actualizar datos (incluye password opcional) ───────── */
router.post("/api/update", ensureAuth, (req, res) => {
  try{
    const uid = Number(req.session.user.id);
    const name = String(req.body?.name || "").trim();
    const surname = String(req.body?.surname || "").trim();
    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "").trim();
    const pw1 = String(req.body?.pw1 || "");
    const pw2 = String(req.body?.pw2 || "");

    if (!username) return res.status(400).json({ ok:false, error:"Usuario requerido" });
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok:false, error:"Correo inválido" });

    // Duplicados
    const dupUser = db.prepare(`SELECT id FROM users WHERE username=? AND id<>?`).get(username, uid);
    if (dupUser) return res.status(409).json({ ok:false, error:"El usuario ya existe" });
    const dupMail = db.prepare(`SELECT id FROM users WHERE email=? AND id<>?`).get(email, uid);
    if (dupMail) return res.status(409).json({ ok:false, error:"El correo ya está en uso" });

    // Construir UPDATE
    let sql = `UPDATE users SET username=?, email=?, name=?, surname=?`;
    const params = [username, email, name, surname];

    if (pw1 || pw2) {
      if (pw1 !== pw2) return res.status(400).json({ ok:false, error:"Las contraseñas no coinciden" });
      if (pw1.length < 6) return res.status(400).json({ ok:false, error:"La contraseña debe tener 6+ caracteres" });
      sql += `, password_hash=?`;
      params.push(bcrypt.hashSync(pw1, 10));
    }

    sql += ` WHERE id=?`;
    params.push(uid);

    db.prepare(sql).run(...params);

    // Refrescar sesión (incluye avatar que ya estuviera)
    const avatar_url = db.prepare(`SELECT avatar_url FROM users WHERE id=?`).get(uid)?.avatar_url || req.session.user.avatar_url || null;
    req.session.user = { ...req.session.user, name, surname, username, email, avatar_url };

    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message || "update" });
  }
});

/* ───────── API: subir avatar (multipart) ───────── */
router.post("/api/avatar", ensureAuth, (req, res) => {
  upload.single("avatar")(req, res, (err) => {
    if (err) return res.status(400).json({ ok:false, error: err.message || "upload" });
    try{
      const uid = Number(req.session.user.id);
      if (!req.file) return res.status(400).json({ ok:false, error:"Archivo requerido" });
      const ext = MIME_TO_EXT[req.file.mimetype] || "jpg";
      const urlClean = `/uploads/avatars/u-${uid}.${ext}`;
      const url = urlClean + "?v=" + Date.now(); // bust caché
      db.prepare(`UPDATE users SET avatar_url=? WHERE id=?`).run(urlClean, uid);
      req.session.user = { ...req.session.user, avatar_url: urlClean };
      res.json({ ok:true, url });
    }catch(e){
      res.status(500).json({ ok:false, error: e?.message || "avatar" });
    }
  });
});

/* ───────── API: quitar avatar ───────── */
router.post("/api/avatar-remove", ensureAuth, (req, res) => {
  try{
    const uid = Number(req.session.user.id);
    for (const ext of Object.values(MIME_TO_EXT)) {
      const p = path.join(AVA_DIR, `u-${uid}.${ext}`);
      if (fs.existsSync(p)) { try{ fs.unlinkSync(p); }catch{} }
    }
    db.prepare(`UPDATE users SET avatar_url=NULL WHERE id=?`).run(uid);
    req.session.user = { ...req.session.user, avatar_url: null };
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message || "avatar-remove" });
  }
});

module.exports = router;