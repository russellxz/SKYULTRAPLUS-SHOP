"use strict";

const express = require("express");
const bcrypt  = require("bcryptjs");
const db      = require("./db");

const router = express.Router();

function ensureGuest(req,res,next){
  if (req.session?.user) return res.redirect("/");
  next();
}

/* ---------- UI ---------- */
function renderPage(res, site, token, err = ""){
  const logo = db.getSetting("logo_url","");

  res.type("html").send(`<!doctype html>
<html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${site} · Restablecer contraseña</title>
<style>
  :root{ --card:#111827; --txt:#e5e7eb; --muted:#9ca3af; --accent:#f43f5e; --accent2:#fb7185; --r:16px; }
  *{box-sizing:border-box}
  body{ margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu; background:#0b1220; color:var(--txt); min-height:100vh; overflow-x:hidden; }

  /* Oscuro: estrellas */
  .sky{ position:fixed; inset:0; pointer-events:none; z-index:0; overflow:hidden; }
  .star{ position:absolute; width:2px; height:2px; background:#fff; border-radius:50%; opacity:.9; animation:twinkle 3s linear infinite; }
  .shoot{ position:absolute; width:140px; height:2px; background:linear-gradient(90deg,#fff,transparent); transform:rotate(18deg); filter:drop-shadow(0 0 6px #fff8); animation:shoot 5.6s linear infinite; }
  @keyframes twinkle{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
  @keyframes shoot{0%{transform:translate(-10vw,-10vh) rotate(18deg)}100%{transform:translate(110vw,110vh) rotate(18deg)}}

  /* Claro: emojis flotando (igual que register/forgot/dashboard) */
  body.light{ background:#ffffff; color:#0b1220; }
  .icons{ position:fixed; inset:0; z-index:0; pointer-events:none; display:none; }
  body.light .icons{ display:block; }
  .icons span{ position:absolute; font-size:34px; opacity:.24; filter:saturate(120%) drop-shadow(0 0 1px #00000010); animation:floatUp linear infinite; }
  @media(min-width:900px){ .icons span{ font-size:40px; } }
  @keyframes floatUp{ 0%{ transform:translateY(20vh); opacity:0 } 10%{opacity:.24} 90%{opacity:.24} 100%{ transform:translateY(-30vh); opacity:0 } }

  /* Layout */
  .wrap{ position:relative; z-index:1; display:grid; place-items:center; min-height:100vh; padding:22px; }
  .card{ width:100%; max-width:520px; background:var(--card); border:1px solid #ffffff22; border-radius:var(--r); padding:24px; }
  body.light .card{ background:#ffffff; border-color:#00000018 }
  h1{ margin:0 0 8px; font-size:24px; }
  .muted{ color:var(--muted); margin-bottom:16px; }
  .row{ display:flex; gap:8px; align-items:center; }
  .input{ width:100%; padding:12px 14px; border-radius:12px; border:1px solid #ffffff22; background:#0f172a; color:#fff; }
  body.light .input{ background:#ffffff; color:#0b1220; border-color:#00000022 }
  .btn{ display:inline-block; background:linear-gradient(90deg,var(--accent),var(--accent2)); color:#fff; border:none; padding:12px 14px; border-radius:12px; cursor:pointer; width:100%; font-weight:800; }
  .err{ color:#ff6b7f; margin-bottom:8px; font-weight:700 }

  /* Topbar con marca y modo */
  .topbar{ position:fixed; top:10px; right:12px; z-index:2; display:flex; align-items:center; gap:8px; }
  .brand-pill{ display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:999px; background:#ffffff18; border:1px solid #ffffff28; }
  .brand-pill img{ width:30px; height:30px; border-radius:8px; border:1px solid #ffffff66; object-fit:cover; background:#fff; }
  .brand-name{ font-weight:900; font-size:17px; background:linear-gradient(90deg,#ffffff,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent; }
  body.light .brand-pill{ background:#0000000a; border-color:#00000012; }
  body.light .brand-name{ background:linear-gradient(90deg,#111111,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent; }

  .pill{ padding:8px 12px; border-radius:999px; background:#ffffff18; border:1px solid #ffffff28; color:#fff; cursor:pointer; text-decoration:none; }
  body.light .pill{ background:#0000000a; border-color:#00000012; color:#0b1220 }
</style>

<body>
  <div class="sky" id="sky"></div>
  <div class="icons" id="icons"></div>

  <div class="topbar">
    <span class="brand-pill">
      ${logo ? `<img src="${logo}" alt="logo">` : ``}
      <span class="brand-name">${site}</span>
    </span>
    <button id="mode" class="pill" type="button" aria-label="Cambiar tema">🌙</button>
  </div>

  <main class="wrap">
    <section class="card">
      <h1>Restablecer contraseña</h1>
      <div class="muted">Escribe tu nueva contraseña.</div>
      ${err ? `<div class="err">${err}</div>` : ``}
      <form method="post" action="/reset">
        <input type="hidden" name="token" value="${token}">
        <div class="row">
          <input id="pwd" class="input" name="password" type="password" placeholder="Nueva contraseña" required>
          <button type="button" class="pill" onclick="toggle('pwd')">👁</button>
        </div>
        <div class="row" style="margin-top:8px">
          <input id="pwd2" class="input" name="confirm" type="password" placeholder="Repite la contraseña" required>
          <button type="button" class="pill" onclick="toggle('pwd2')">👁</button>
        </div>
        <button class="btn" type="submit" style="margin-top:10px">Guardar</button>
      </form>
      <div style="margin-top:10px"><a class="pill" href="/login">← Volver</a></div>
    </section>
  </main>

<script>
  // Estrellas (oscuro)
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

  // Emojis (claro)
  (function(){
    const icons=document.getElementById('icons');
    const set=['🎵','🎬','🎮','📷','🎧','📱','💾','🛒','📺','📀','💡','🚀'];
    for(let i=0;i<28;i++){
      const sp=document.createElement('span');
      sp.textContent=set[i%set.length];
      sp.style.left=(Math.random()*100).toFixed(2)+'%';
      sp.style.top =(Math.random()*100).toFixed(2)+'%';
      sp.style.animationDuration=(20+Math.random()*18).toFixed(1)+'s';
      sp.style.animationDelay=(Math.random()*8).toFixed(1)+'s';
      icons.appendChild(sp);
    }
  })();

  // Tema
  (function(){
    const btn=document.getElementById('mode');
    const sky=document.getElementById('sky');
    const icons=document.getElementById('icons');
    function apply(m){
      const light=(m==='light');
      document.body.classList.toggle('light',light);
      sky.style.display   = light ? 'none'  : 'block';
      icons.style.display = light ? 'block' : 'none';
      btn.textContent = light ? '☀️' : '🌙';
      localStorage.setItem('mode', light ? 'light':'dark');
    }
    apply(localStorage.getItem('mode')||'dark');
    btn.addEventListener('click', ()=>apply(document.body.classList.contains('light')?'dark':'light'));
  })();

  function toggle(id){ const i=document.getElementById(id); i.type=(i.type==='password')?'text':'password'; }
</script>
</body></html>`);
}

/* ---------- Rutas ---------- */
router.get("/reset", ensureGuest, (req,res)=>{
  const site = db.getSetting("site_name","SkyShop");
  const token = String(req.query.token||"").trim();
  if(!token) return res.status(400).send("Token faltante");

  const row = db.prepare("SELECT * FROM password_resets WHERE token=?").get(token);
  if(!row || row.used_at)        return res.status(400).send("Token inválido");
  if(new Date(row.expires_at) < new Date()) return res.status(400).send("Token expirado");

  renderPage(res, site, token);
});

router.post("/reset", ensureGuest, (req,res)=>{
  const site = db.getSetting("site_name","SkyShop");
  const { token, password, confirm } = req.body;
  if(!token) return res.status(400).send("Token faltante");

  const row = db.prepare("SELECT * FROM password_resets WHERE token=?").get(token);
  if(!row || row.used_at)                       return renderPage(res, site, token, "Token inválido");
  if(new Date(row.expires_at) < new Date())     return renderPage(res, site, token, "Token expirado");
  if(!password || password !== confirm)         return renderPage(res, site, token, "Las contraseñas no coinciden");

  const hash = bcrypt.hashSync(password, 10);
  const now  = new Date().toISOString();

  const tx = db.transaction(()=>{
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, row.user_id);
    db.prepare("UPDATE password_resets SET used_at=? WHERE id=?").run(now, row.id);
  });
  tx();

  res.redirect("/login?reset=1");
});

module.exports = router;