"use strict";

const express = require("express");
const crypto  = require("crypto");
const nodemailer = require("nodemailer");
const db = require("./db");

const router = express.Router();

function ensureGuest(req,res,next){ if (req.session?.user) return res.redirect("/"); next(); }

/* ===== Tabla de tokens (por si falta) ===== */
try{
  db.prepare(`
    CREATE TABLE IF NOT EXISTS password_resets(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
}catch{}

/* ===== Helpers SMTP (lee /admin/mail) ===== */
function smtpGet(){
  const site = db.getSetting("site_name","SkyShop");
  const host = db.getSetting("smtp_host","");
  const port = parseInt(db.getSetting("smtp_port","587"),10) || 587;
  const secure = (db.getSetting("smtp_secure", port===465 ? "ssl":"tls") || "tls").toLowerCase();
  const user = db.getSetting("smtp_user","");
  const pass = db.getSetting("smtp_pass","");
  let from   = db.getSetting("smtp_from","") || user || "";
  const name = db.getSetting("smtp_from_name", site);

  // Hostinger suele exigir from === user
  if ((host||"").toLowerCase().includes("hostinger") && user && from && from.toLowerCase() !== user.toLowerCase()){
    from = user;
  }
  return { host, port, secure, user, pass, from, name };
}
function mailTransport(){
  const s = smtpGet();
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure === "ssl",
    requireTLS: s.secure === "tls",
    auth: s.user ? { user: s.user, pass: s.pass } : undefined
  });
}
/* Base absoluta (reverse proxy friendly) */
function absoluteBase(req){
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host  = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

/* ===== UI ===== */
router.get("/forgot", ensureGuest, (req,res)=>{
  const site = db.getSetting("site_name","SkyShop");
  const logo = db.getSetting("logo_url","");
  const ok   = req.query.ok === "1";

  res.type("html").send(`<!doctype html>
<html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${site} · Recuperar contraseña</title>
<style>
  :root{ --card:#111827; --txt:#e5e7eb; --muted:#9ca3af; --accent:#f43f5e; --accent2:#fb7185; --r:16px; }
  *{box-sizing:border-box}
  body{ margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu; background:#0b1220; color:var(--txt); min-height:100vh; overflow-x:hidden; }

  /* Oscuro: cielo de estrellas */
  .sky{ position:fixed; inset:0; pointer-events:none; z-index:0; overflow:hidden; }
  .star{ position:absolute; width:2px; height:2px; background:#fff; border-radius:50%; opacity:.9; animation:twinkle 3s linear infinite; }
  .shoot{ position:absolute; width:140px; height:2px; background:linear-gradient(90deg,#fff,transparent); transform:rotate(18deg); filter:drop-shadow(0 0 6px #fff8); animation:shoot 5.6s linear infinite; }
  @keyframes twinkle{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
  @keyframes shoot{0%{transform:translate(-10vw,-10vh) rotate(18deg)}100%{transform:translate(110vw,110vh) rotate(18deg)}}

  /* Claro: emojis flotando (como register/dashboard) */
  body.light{ background:#ffffff; color:#0b1220; }
  .icons{ position:fixed; inset:0; z-index:0; pointer-events:none; display:none; }
  body.light .icons{ display:block; }
  .icons span{ position:absolute; font-size:34px; opacity:.24; filter:saturate(120%) drop-shadow(0 0 1px #00000010); animation:floatUp linear infinite; }
  @media(min-width:900px){ .icons span{ font-size:40px; } }
  @keyframes floatUp{ 0%{ transform:translateY(20vh); opacity:0 } 10%{opacity:.24} 90%{opacity:.24} 100%{ transform:translateY(-30vh); opacity:0 } }

  /* Layout: centrado, sin panel oscuro */
  .wrap{ position:relative; z-index:1; display:grid; place-items:center; min-height:100vh; padding:22px; }
  .card{ width:100%; max-width:560px; background:var(--card); border:1px solid #ffffff22; border-radius:var(--r); padding:24px; }
  body.light .card{ background:#ffffff; border-color:#00000018 }

  /* Topbar con marca y modo */
  .topbar{ position:fixed; top:10px; right:12px; z-index:2; display:flex; align-items:center; gap:8px; }
  .brand-pill{ display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:999px; background:#ffffff18; border:1px solid #ffffff28; }
  .brand-pill img{ width:30px; height:30px; border-radius:8px; border:1px solid #ffffff66; object-fit:cover; background:#fff; }
  .brand-name{ font-weight:900; font-size:17px; background:linear-gradient(90deg,#ffffff,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent; }
  body.light .brand-pill{ background:#0000000a; border-color:#00000012; }
  body.light .brand-name{ background:linear-gradient(90deg,#111111,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent; }

  .pill{ padding:8px 12px; border-radius:999px; background:#ffffff18; border:1px solid #ffffff28; color:#fff; cursor:pointer; }
  body.light .pill{ background:#0000000a; border-color:#00000012; color:#0b1220 }

  h1{ margin:0 0 8px; font-size:24px; }
  .muted{ color:var(--muted); margin-bottom:16px; }
  .input{ width:100%; padding:12px 14px; border-radius:12px; border:1px solid #ffffff22; background:#0f172a; color:#fff; }
  body.light .input{ background:#ffffff; color:#0b1220; border-color:#00000022 }
  .btn{ display:inline-block; background:linear-gradient(90deg,var(--accent),var(--accent2)); color:#fff; border:none; padding:12px 14px; border-radius:12px; cursor:pointer; width:100%; font-weight:800; }
  .ok{ display:${ok?'block':'none'}; margin:10px 0 2px; color:#16a34a; font-weight:700 }
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
      <h1>Recuperar contraseña</h1>
      <div class="muted">Ingresa tu correo y te enviaremos un enlace temporal para restablecer tu contraseña.</div>
      <div class="ok">Si el correo existe, hemos enviado el enlace de recuperación.</div>
      <form method="post" action="/forgot">
        <input class="input" name="email" type="email" placeholder="Correo electrónico" required>
        <button class="btn" type="submit" style="margin-top:8px">Generar enlace</button>
      </form>
      <div style="margin-top:12px; display:flex; justify-content:space-between">
        <a class="pill" href="/login" style="text-decoration:none">← Volver</a>
        <span></span>
      </div>
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
    const icons = document.getElementById('icons');
    const set = ['🎵','🎬','🎮','📷','🎧','📱','💾','🛒','📺','📀','💡','🚀'];
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
      document.body.classList.toggle('light', light);
      sky.style.display   = light ? 'none'  : 'block';
      icons.style.display = light ? 'block' : 'none';
      btn.textContent = light ? '☀️' : '🌙';
      localStorage.setItem('mode', light ? 'light':'dark');
    }
    apply(localStorage.getItem('mode')||'dark');
    btn.addEventListener('click', ()=>apply(document.body.classList.contains('light')?'dark':'light'));
  })();
</script>
</body></html>`);
});

/* ===== POST: genera token y envía correo ===== */
router.post("/forgot", ensureGuest, async (req,res)=>{
  const email = String(req.body.email||"").trim().toLowerCase();
  if (!email) return res.redirect("/forgot");

  const u = db.prepare("SELECT id,name FROM users WHERE email=?").get(email);

  // Siempre devolvemos ok (para no filtrar existencia)
  if (u){
    // invalidar tokens previos
    db.prepare("DELETE FROM password_resets WHERE user_id=?").run(u.id);

    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date();
    const expires = new Date(now.getTime() + 60*60*1000); // 60 min

    db.prepare(`INSERT INTO password_resets(user_id,token,created_at,expires_at)
                VALUES(?,?,?,?)`).run(u.id, token, now.toISOString(), expires.toISOString());

    const resetUrl = `${absoluteBase(req)}/reset?token=${token}`;
    const site = db.getSetting("site_name","SkyShop");
    const logo = db.getSetting("logo_url","");

    const brand = logo
      ? `<div style="display:flex;align-items:center;gap:10px">
           <img src="${logo}" width="36" height="36" style="border-radius:8px;border:1px solid #eee;object-fit:cover" alt="${site}">
           <div style="font-weight:900;font-size:18px">${site}</div>
         </div>`
      : `<div style="font-weight:900;font-size:18px">${site}</div>`;

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:520px;margin:auto;padding:16px">
        ${brand}
        <h2 style="margin:16px 0 8px">Restablecer tu contraseña</h2>
        <p>Hola${u.name ? " "+u.name : ""}, recibimos una solicitud para restablecer tu contraseña en <b>${site}</b>.</p>
        <p>Haz clic en el botón (expira en 60 minutos):</p>
        <p><a href="${resetUrl}" style="display:inline-block;background:#ef4444;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">Restablecer contraseña</a></p>
        <p style="color:#6b7280;font-size:12px">Si no fuiste tú, puedes ignorar este correo.</p>
      </div>`;

    try{
      const s = smtpGet();
      const fromAddr = s.name ? (`"${s.name}" <${s.from || s.user || ""}>`) : ((s.from || s.user || ""));
      if (s.host && (s.user || s.from)){
        const tx = mailTransport();
        await tx.sendMail({ from: fromAddr, to: email, subject: `${site} · Restablece tu contraseña`, html });
      }
    }catch(e){
      console.error("Forgot mail error:", e?.message);
    }
  }

  return res.redirect("/forgot?ok=1");
});

module.exports = router;