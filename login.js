// login.js — UI mejorada (gradientes compatibles en móvil, light/dark sincronizados)
"use strict";

const express = require("express");
const bcrypt  = require("bcryptjs");
const db      = require("./db");

const router = express.Router();

function ensureGuest(req,res,next){ if (req.session.user) return res.redirect('/'); next(); }

/* ===== GET /login ===== */
router.get('/login', ensureGuest, (req,res)=>{
  const site = db.getSetting('site_name','SkyShop');
  const logo = db.getSetting('logo_url','');
  const errCode = String(req.query.err||'');
  const emailQ  = String(req.query.email||'');
  const err = errCode==='1' ? 'Credenciales inválidas' :
              errCode==='2' ? 'Debes verificar tu correo' : '';

  res.type('html').send(`<!doctype html>
<html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${site} · Iniciar sesión</title>
<style>
  :root{
    --card:#111827; --txt:#e5e7eb; --muted:#9aa4b2;
    --accent:#f43f5e; --accent2:#fb7185; --r:16px;
  }
  *{box-sizing:border-box}
  body{
    margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;
    background:#0b1220; color:var(--txt); min-height:100vh; overflow-x:hidden;
  }

  /* ===== Fondo (oscuro): estrellas ===== */
  .sky{ position:fixed; inset:0; pointer-events:none; z-index:0; overflow:hidden; }
  .star{ position:absolute; width:2px; height:2px; background:#fff; border-radius:50%; opacity:.9; animation:twinkle 3s linear infinite; }
  .shoot{ position:absolute; width:140px; height:2px; background:linear-gradient(90deg,#fff,transparent);
          transform:rotate(18deg); filter:drop-shadow(0 0 6px #fff8); animation:shoot 5.8s linear infinite; }
  @keyframes twinkle{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
  @keyframes shoot{0%{transform:translate(-10vw,-10vh) rotate(18deg)}100%{transform:translate(110vw,110vh) rotate(18deg)}}

  /* ===== Fondo (claro): emojis flotantes (igual que register) ===== */
  body.light{ background:#ffffff; color:#0b1220; }
  .icons{ position:fixed; inset:0; z-index:0; pointer-events:none; display:none; }
  body.light .icons{ display:block; }
  .icons span{
    position:absolute; font-size:34px; opacity:.24; filter:saturate(120%) drop-shadow(0 0 1px #00000010);
    animation: floatUp linear infinite;
  }
  @media(min-width:900px){ .icons span{ font-size:40px; } }
  @keyframes floatUp{ 0%{ transform:translateY(20vh); opacity:.0 } 10%{opacity:.24} 90%{opacity:.24} 100%{ transform:translateY(-30vh); opacity:.0 } }

  /* ===== Layout ===== */
  .wrap{
    position:relative; z-index:1;
    display:grid; grid-template-columns:minmax(0,1.15fr) minmax(320px,1fr);
    gap:24px; padding:40px; min-height:100vh; align-items:center;
  }
  @media(max-width:900px){ .wrap{ grid-template-columns:1fr; padding:16px 14px; gap:16px } }

  /* ===== Panel izquierdo (luces + hero) ===== */
  .panel-left{
    position:relative; background:#000000b0; backdrop-filter:blur(6px);
    border-radius:var(--r); overflow:hidden; min-height:360px;
    border:1px solid #ffffff20;
  }
  .panel-left::before, .panel-left::after{
    content:""; position:absolute; inset:-25%; pointer-events:none; mix-blend-mode:screen; opacity:.8;
  }
  .panel-left::before{ background:radial-gradient(360px 260px at 12% 35%, #7c3aed66, transparent 60%); animation:floatA 18s ease-in-out infinite; }
  .panel-left::after { background:radial-gradient(340px 230px at 78% 70%, #f43f5e66, transparent 60%); animation:floatB 22s ease-in-out infinite; }
  @keyframes floatA{0%{transform:translate(-8%,-6%) rotate(0)}50%{transform:translate(10%,4%) rotate(12deg)}100%{transform:translate(-8%,-6%) rotate(0)}}
  @keyframes floatB{0%{transform:translate(6%,4%) rotate(0)}50%{transform:translate(-10%,-6%) rotate(-10deg)}100%{transform:translate(6%,4%) rotate(0)}}

  /* Hero (mensajes grandes) */
  .hero{ position:absolute; inset:0; display:grid; place-items:center; z-index:1; pointer-events:none; padding:18px; text-align:center; }
  .hero h2{
    margin:0; line-height:1.08;
    font-size:clamp(26px, 6.2vw, 56px); font-weight:900;
    background:linear-gradient(90deg,#ffffff,#ef4444);
    -webkit-background-clip:text; background-clip:text;
    color:transparent; -webkit-text-fill-color:transparent;
    text-shadow:0 2px 18px #00000080;
    transition:opacity .45s, transform .45s;
  }
  body.light .hero h2{
    background:linear-gradient(90deg,#111111,#ef4444);
    -webkit-background-clip:text; background-clip:text;
    color:transparent; -webkit-text-fill-color:transparent;
    text-shadow:0 2px 10px #00000022;
  }
  .fade{ opacity:.0; transform:translateY(6px); }
  .fade.show{ opacity:1; transform:none; }

  /* Tira inferior: logo + nombre grandes */
  .meta{
    position:absolute; left:0; right:0; bottom:0; z-index:2;
    display:flex; gap:14px; align-items:center;
    padding:14px 16px; background:linear-gradient(180deg,transparent,#00000066 30%,#000000aa);
  }
  .avatar{ width:56px; height:56px; border-radius:12px; border:1px solid #ffffff55; background:#0b1220; overflow:hidden; display:grid; place-items:center; }
  .avatar img{ width:100%; height:100%; object-fit:cover; display:block; }
  .avatar .fallback{ font-weight:900; font-size:22px; color:#fff; }
  .store-name{
    font-size:22px; font-weight:900; margin:0;
    background:linear-gradient(90deg,#ffffff,#ef4444);
    -webkit-background-clip:text; background-clip:text;
    color:transparent; -webkit-text-fill-color:transparent;
  }
  body.light .store-name{
    background:linear-gradient(90deg,#111111,#ef4444);
    -webkit-background-clip:text; background-clip:text;
    color:transparent; -webkit-text-fill-color:transparent;
  }

  /* ===== Tarjeta de login ===== */
  .card{
    background:var(--card); border:1px solid #ffffff24; border-radius:var(--r);
    padding:26px; width:100%; max-width:520px; margin-left:auto;
  }
  body.light .card{ background:#ffffff; border-color:#00000018 }
  h1{ margin:0 0 8px; font-size:26px; }
  .muted{ color:var(--muted); margin-bottom:16px; }
  .input{
    width:100%; padding:12px 14px; margin:8px 0 14px; border-radius:12px;
    border:1px solid #ffffff22; background:#0f172a; color:#fff;
  }
  body.light .input{ background:#ffffff; color:#0b1220; border-color:#00000022 }
  .row{ display:flex; gap:10px; align-items:center; }
  .btn{
    display:inline-block; background:linear-gradient(90deg,var(--accent),var(--accent2));
    color:#fff; border:none; padding:12px 14px; border-radius:12px; cursor:pointer; width:100%; font-weight:700;
  }
  .link{ color:#99c1ff; text-decoration:none }

  /* ===== Topbar con logo + nombre (gradiente fijo) ===== */
  .topbar{ position:fixed; top:8px; right:12px; display:flex; gap:8px; align-items:center; z-index:2; }
  .pill{
    padding:7px 12px; border-radius:999px; background:#ffffff18; border:1px solid #ffffff28;
    display:flex; gap:10px; align-items:center; color:#fff;
  }
  .pill .logo{ width:26px; height:26px; border-radius:50%; object-fit:cover; border:1px solid #ffffff66; background:#fff; }
  .pill .brand{
    font-weight:900; font-size:16px;
    background:linear-gradient(90deg,#ffffff,#ef4444);
    -webkit-background-clip:text; background-clip:text;
    color:transparent; -webkit-text-fill-color:transparent;
  }
  body.light .pill{ background:#0000000a; border-color:#00000012; color:#0b1220 }
  body.light .pill .brand{
    background:linear-gradient(90deg,#111111,#ef4444);
    -webkit-background-clip:text; background-clip:text;
    color:transparent; -webkit-text-fill-color:transparent;
  }
  body.light .pill .logo{ border-color:#00000033 }

  .err{ color:#ff6b7f; margin-bottom:8px; font-weight:600 }
  .resend{ margin-top:8px; text-align:right }
  .resend button{ background:#475569; border:none; color:#fff; padding:8px 10px; border-radius:10px; cursor:pointer }
</style>

<body>
  <div class="sky" id="sky"></div>
  <div class="icons" id="icons"></div>

  <div class="topbar">
    <span class="pill" title="${site}">
      ${logo ? `<img src="${logo}" class="logo" alt="logo">` : ``}
      <span class="brand">${site}</span>
    </span>
    <button id="mode" class="pill" type="button" aria-label="Cambiar tema">🌙</button>
  </div>

  <main class="wrap">
    <section class="panel-left">
      <div class="hero"><h2 id="heroMsg" class="fade">Bienvenido ✨</h2></div>

      <div class="meta">
        <div class="avatar">
          ${logo ? `<img src="${logo}" alt="logo">` : `<span class="fallback">${site.slice(0,1)}</span>`}
        </div>
        <p class="store-name">${site}</p>
      </div>
    </section>

    <section class="card">
      <h1>Bienvenido de nuevo</h1>
      <div class="muted">Por favor, introduce tus credenciales para acceder.</div>
      ${err ? `<div class="err">${err}</div>` : ``}
      <form method="post" action="/login">
        <input class="input" name="email" type="email" placeholder="Correo electrónico" value="${emailQ}" required>
        <div class="row">
          <input id="pwd" class="input" name="password" type="password" placeholder="Contraseña" style="flex:1" required>
          <button type="button" class="pill" onclick="togglePwd()" title="Ver/Ocultar contraseña">👁</button>
        </div>
        <button class="btn" type="submit">Iniciar sesión</button>
      </form>
      ${errCode==='2' ? `
        <div class="resend">
          <form method="post" action="/verify/resend">
            <input type="hidden" name="email" value="${emailQ}">
            <button type="submit">Reenviar verificación</button>
          </form>
        </div>` : ``}
      <div style="margin-top:12px; display:flex; justify-content:space-between">
        <a class="link" href="/forgot">¿Olvidaste tu contraseña?</a>
        <a class="link" href="/register">Registrarse</a>
      </div>
    </section>
  </main>

<script>
  // estrellas + fugaces (sólo en oscuro)
  (function(){
    const sky = document.getElementById('sky');
    for(let i=0;i<90;i++){
      const s=document.createElement('div');
      s.className='star';
      s.style.top=(Math.random()*100).toFixed(2)+'%';
      s.style.left=(Math.random()*100).toFixed(2)+'%';
      s.style.opacity=(0.35+Math.random()*0.65).toFixed(2);
      s.style.transform='scale('+(0.6+Math.random()*1.6).toFixed(2)+')';
      s.style.animationDelay=(Math.random()*3).toFixed(2)+'s';
      sky.appendChild(s);
    }
    for(let i=0;i<3;i++){
      const sh=document.createElement('div');
      sh.className='shoot';
      sh.style.top=(Math.random()*25).toFixed(2)+'%';
      sh.style.left=(Math.random()*60).toFixed(2)+'%';
      sh.style.animationDelay=(1+Math.random()*5).toFixed(2)+'s';
      sky.appendChild(sh);
    }
  })();

  // emojis flotantes (sólo en claro)
  (function(){
    const icons = document.getElementById('icons');
    const set = ['🎵','🎬','🎮','📷','🎧','📱','💾','🛒','📺','📀','💡','🚀'];
    for(let i=0;i<28;i++){
      const sp = document.createElement('span');
      sp.textContent = set[i % set.length];
      sp.style.left = (Math.random()*100).toFixed(2)+'%';
      sp.style.top  = (Math.random()*100).toFixed(2)+'%';
      sp.style.animationDuration = (20 + Math.random()*18).toFixed(1)+'s';
      sp.style.animationDelay    = (Math.random()*8).toFixed(1)+'s';
      icons.appendChild(sp);
    }
  })();

  // Mensajes grandes (rotador)
  (function(){
    const el = document.getElementById('heroMsg');
    const msgs = [
      'Bienvenido ✨',
      'Tu mejor tienda digital',
      'Ofertas únicas cada semana',
      'Rápido. Simple. Seguro.'
    ];
    let i = 0;
    function show(){ el.classList.add('show'); }
    function hide(){ el.classList.remove('show'); }
    function next(){
      hide();
      setTimeout(()=>{
        i = (i+1) % msgs.length;
        el.textContent = msgs[i];
        show();
      }, 260);
    }
    show();
    setInterval(next, 2600);
  })();

  // Tema (sincroniza fondos)
  (function(){
    const modeBtn = document.getElementById('mode');
    const sky = document.getElementById('sky');
    const icons = document.getElementById('icons');
    function apply(m){
      const light=(m==='light');
      document.body.classList.toggle('light',light);
      sky.style.display   = light ? 'none'  : 'block';
      icons.style.display = light ? 'block' : 'none';
      modeBtn.textContent = light ? '☀️' : '🌙';
      localStorage.setItem('mode', light ? 'light' : 'dark');
    }
    apply(localStorage.getItem('mode')||'dark');
    modeBtn.addEventListener('click', ()=>apply(document.body.classList.contains('light')?'dark':'light'));
  })();

  function togglePwd(){ const i=document.getElementById('pwd'); i.type=(i.type==='password')?'text':'password'; }
</script>
</body></html>`);
});

/* ===== POST /login ===== */
router.post('/login', ensureGuest, (req,res)=>{
  const { email, password } = req.body;
  if(!email || !password) return res.redirect('/login?err=1');

  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email).trim().toLowerCase());
  if(!u) return res.redirect('/login?err=1');

  const mustVerify = db.getSetting('require_email_verification','0') === '1';
  if (mustVerify && !u.email_verified) return res.redirect('/login?err=2&email='+encodeURIComponent(u.email));

  if (!bcrypt.compareSync(password, u.password_hash)) return res.redirect('/login?err=1');

  req.session.user = { id:u.id, email:u.email, username:u.username, name:u.name, surname:u.surname, is_admin: !!u.is_admin };
  return res.redirect('/');
});

module.exports = router;