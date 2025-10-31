// register.js — Registro + verificación por email (UI con modo claro/oscuro arreglado)
"use strict";

const express = require("express");
const bcrypt  = require("bcryptjs");
const crypto  = require("crypto");
const nodemailer = require("nodemailer");
const db = require("./db");

const router = express.Router();

/* ===== Asegura tabla de tokens ===== */
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS email_verify_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
} catch { /* ignore */ }

/* ===== SMTP helpers (lee /admin/mail) ===== */
function smtpGet(){
  const site = db.getSetting("site_name","SkyShop");
  const host = db.getSetting("smtp_host","");
  const port = parseInt(db.getSetting("smtp_port","587"),10) || 587;
  const secure = (db.getSetting("smtp_secure", port===465 ? "ssl":"tls") || "tls").toLowerCase();
  const user = db.getSetting("smtp_user","");
  const pass = db.getSetting("smtp_pass","");
  let from   = db.getSetting("smtp_from","") || user || "";
  const name = db.getSetting("smtp_from_name", site);
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

/* ===== Países ===== */
const COUNTRIES = [
  { c: 'US', n: 'Estados Unidos', d: '+1' }, { c: 'MX', n: 'México', d: '+52' },
  { c: 'AR', n: 'Argentina', d: '+54' }, { c: 'BO', n: 'Bolivia', d: '+591' },
  { c: 'BR', n: 'Brasil', d: '+55' }, { c: 'CL', n: 'Chile', d: '+56' },
  { c: 'CO', n: 'Colombia', d: '+57' }, { c: 'CR', n: 'Costa Rica', d: '+506' },
  { c: 'CU', n: 'Cuba', d: '+53' }, { c: 'DO', n: 'Rep. Dominicana', d: '+1' },
  { c: 'EC', n: 'Ecuador', d: '+593' }, { c: 'SV', n: 'El Salvador', d: '+503' },
  { c: 'ES', n: 'España', d: '+34' }, { c: 'GT', n: 'Guatemala', d: '+502' },
  { c: 'HN', n: 'Honduras', d: '+504' }, { c: 'NI', n: 'Nicaragua', d: '+505' },
  { c: 'PA', n: 'Panamá', d: '+507' }, { c: 'PY', n: 'Paraguay', d: '+595' },
  { c: 'PE', n: 'Perú', d: '+51' }, { c: 'PR', n: 'Puerto Rico', d: '+1' },
  { c: 'UY', n: 'Uruguay', d: '+598' }, { c: 'VE', n: 'Venezuela', d: '+58' }
];

function ensureGuest(req,res,next){ if (req.session.user) return res.redirect('/'); next(); }

/* ===== GET /register (UI) ===== */
router.get('/register', ensureGuest, (req,res)=>{
  const site = db.getSetting('site_name','SkyShop');
  const logo = db.getSetting('logo_url','');

  const e = String(req.query.e||'');
  const err =
    e==='1' ? 'Completa todos los campos' :
    e==='2' ? 'Las contraseñas no coinciden' :
    e==='3' ? 'El correo ya está registrado' :
    e==='4' ? 'El nombre de usuario ya existe' :
    e==='5' ? 'Usuario inválido (usa 3-20 letras/números/_)' :
    e==='6' ? 'WhatsApp inválido' :
    e==='7' ? 'Debes aceptar los Términos del Servicio' : '';

  const opts = COUNTRIES.map(x =>
    `<option value="${x.d}" ${x.c==='MX'?'selected':''}>${x.n} (${x.d})</option>`
  ).join('');

  res.type('html').send(`<!doctype html>
<html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${site} · Registro</title>
<style>
  :root{ --card:#111827; --txt:#e5e7eb; --muted:#9aa4b2; --accent:#f43f5e; --accent2:#fb7185; --r:16px; --blue:#1d4ed8; }
  *{box-sizing:border-box}
  body{ margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu; background:#0b1220; color:var(--txt); min-height:100vh; overflow-x:hidden; }

  /* oscuro: estrellas */
  .sky{ position:fixed; inset:0; pointer-events:none; z-index:0; overflow:hidden; }
  .star{ position:absolute; width:2px; height:2px; background:#fff; border-radius:50%; opacity:.9; animation:twinkle 3s linear infinite; }
  @keyframes twinkle{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}

  /* claro: fondo blanco + iconos flotando */
  body.light{ background:#ffffff; color:#0b1220; }
  .icons{ position:fixed; inset:0; z-index:0; pointer-events:none; display:none; }
  body.light .icons{ display:block; }
  .icons span{ position:absolute; font-size:34px; opacity:.32; filter:saturate(120%) drop-shadow(0 0 1px #00000010); animation: floatUp linear infinite; }
  @media(min-width:900px){ .icons span{ font-size:40px; } }
  @keyframes floatUp{ 0%{ transform:translateY(20vh); opacity:.0 } 10%{opacity:.32} 90%{opacity:.32} 100%{ transform:translateY(-30vh); opacity:.0 } }

  /* layout */
  .wrap{ position:relative; z-index:1; display:grid; place-items:center; min-height:100vh; padding:22px; }
  .card{ width:100%; max-width:680px; background:var(--card); border:1px solid #ffffff22; border-radius:var(--r); padding:26px; }
  body.light .card{ background:#ffffff; border-color:#00000018 }

  /* top bar con marca + botón modo */
  .topbar{ position:fixed; top:10px; right:12px; z-index:2; display:flex; align-items:center; gap:8px; }
  .brand-pill{ display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:999px; background:#ffffff18; border:1px solid #ffffff28; }
  .brand-pill img{ width:30px; height:30px; border-radius:8px; border:1px solid #ffffff66; object-fit:cover; background:#fff; }
  .brand-name{
    font-weight:900; font-size:17px; letter-spacing:.2px; display:inline-block;
    background-image:linear-gradient(90deg,#ffffff,#ef4444);
    background-clip:text; -webkit-background-clip:text; color:transparent; -webkit-text-fill-color:transparent;
  }
  body.light .brand-pill{ background:#0000000a; border-color:#00000012; }
  body.light .brand-name{
    background-image:linear-gradient(90deg,#000000,#ef4444);
    background-clip:text; -webkit-background-clip:text; color:transparent; -webkit-text-fill-color:transparent;
  }

  /* botones */
  .mode{ padding:8px 12px; border-radius:999px; background:#ffffff18; border:1px solid #ffffff28; color:#fff; cursor:pointer; }
  body.light .mode{ background:#0000000a; border-color:#00000012; color:#0b1220 }
  .eyebtn{ padding:8px 10px; border-radius:10px; background:#ffffff18; border:1px solid #ffffff28; color:#fff; cursor:pointer; }
  body.light .eyebtn{ background:#0000000a; border-color:#00000012; color:#0b1220 }

  h1{ margin:0 0 8px; font-size:26px; }
  .muted{ color:var(--muted); margin-bottom:16px; }
  .grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  @media(max-width:640px){ .grid{ grid-template-columns:1fr; } }

  .input{ width:100%; padding:12px 14px; border-radius:12px; border:1px solid #ffffff22; background:#0f172a; color:#fff; }
  body.light .input{ background:#ffffff; color:#0b1220; border-color:#00000022 }
  .row{ display:flex; gap:8px; align-items:center; }
  .btn{ display:inline-block; background:linear-gradient(90deg,var(--accent),var(--accent2)); color:#fff; border:none; padding:12px 14px; border-radius:12px; cursor:pointer; width:100%; font-weight:800; }

  /* checkbox TOS estilo cuadrado azul */
  .tosrow{ margin:10px 0 0; gap:12px; align-items:flex-start; }
  .ck{ appearance:none; -webkit-appearance:none; width:22px; height:22px; border:2px solid var(--blue); border-radius:6px; background:transparent; display:inline-grid; place-content:center; cursor:pointer; flex:0 0 22px; }
  .ck:checked::after{ content:""; width:12px; height:12px; background:var(--blue); border-radius:3px; }
  .toslabel{ line-height:1.35; user-select:none; }
  .toslabel .toslink{ color:#60a5fa; text-decoration:none; font-weight:800; }
  .toslabel .toslink:hover{ text-decoration:underline; }

  .err{ color:#ff6b7f; margin-bottom:8px; font-weight:600 }
  .foot{ margin-top:12px; display:flex; justify-content:space-between }
  .link{ color:#99c1ff; text-decoration:none }
</style>

<body>
  <div class="sky" id="sky"></div>
  <div class="icons" id="icons"></div>

  <div class="topbar">
    <span class="brand-pill">
      ${logo ? `<img src="${logo}" alt="logo">` : ``}
      <span class="brand-name">${site}</span>
    </span>
    <button id="modeBtn" class="mode" type="button" aria-label="Cambiar tema">🌙</button>
  </div>

  <main class="wrap">
    <section class="card">
      <h1>Crear cuenta</h1>
      <div class="muted">Completa el formulario para registrarte. Usaremos tu <b>WhatsApp</b> para avisarte de compras y facturas (pagadas y pendientes).</div>
      ${err ? `<div class="err">${err}</div>` : ``}
      <form method="post" action="/register">
        <div class="grid">
          <input class="input" name="name" placeholder="Nombre" required>
          <input class="input" name="surname" placeholder="Apellido" required>
        </div>
        <div class="grid">
          <input class="input" name="username" placeholder="Nombre de usuario" pattern="[A-Za-z0-9_]{3,20}" title="3-20 letras, números o _" required>
          <input class="input" name="email" type="email" placeholder="Correo electrónico" required>
        </div>
        <div class="grid">
          <div class="row" style="gap:8px">
            <select name="cc" class="input" style="max-width:170px">${opts}</select>
            <input class="input" name="phone" placeholder="Número de WhatsApp (solo dígitos)" required>
          </div>
          <div></div>
        </div>
        <div class="grid">
          <div class="row">
            <input id="pwd" class="input" name="password" type="password" placeholder="Contraseña" required>
            <button type="button" class="eyebtn" id="toggle1">👁</button>
          </div>
          <div class="row">
            <input id="pwd2" class="input" name="confirm" type="password" placeholder="Repite la contraseña" required>
            <button type="button" class="eyebtn" id="toggle2">👁</button>
          </div>
        </div>

        <!-- Aceptación de TOS -->
        <div class="row tosrow">
          <input id="tos" class="ck" type="checkbox" name="tos" required>
          <label class="toslabel" for="tos">
            Estoy de acuerdo con los <a href="/terminos" target="_blank" class="toslink">Términos del Servicio</a>
          </label>
        </div>

        <button class="btn" type="submit" style="margin-top:12px">Crear cuenta</button>
      </form>
      <div class="foot">
        <span></span><a class="link" href="/login">¿Ya tienes cuenta? Inicia sesión</a>
      </div>
    </section>
  </main>

<script>
  // estrellas (sólo oscuro)
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
  })();

  // iconos flotando (sólo claro)
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

  // tema persistente + alternar visibilidad de fondos
  (function(){
    const btn = document.getElementById('modeBtn');
    const sky = document.getElementById('sky');
    const icons = document.getElementById('icons');

    function apply(m){
      const light=(m==='light');
      document.body.classList.toggle('light',light);
      btn.textContent = light ? '☀️' : '🌙';
      sky.style.display   = light ? 'none'  : 'block';
      icons.style.display = light ? 'block' : 'none';
      localStorage.setItem('mode', light ? 'light' : 'dark');
    }
    apply(localStorage.getItem('mode')||'dark');
    btn.addEventListener('click', ()=>apply(document.body.classList.contains('light')?'dark':'light'));
  })();

  // toggles de contraseña
  document.getElementById('toggle1').onclick = ()=>{ const i=document.getElementById('pwd');  i.type = i.type==='password'?'text':'password'; };
  document.getElementById('toggle2').onclick = ()=>{ const i=document.getElementById('pwd2'); i.type = i.type==='password'?'text':'password'; };
</script>
</body></html>`);
});

/* ===== POST /register ===== */
router.post("/register", ensureGuest, async (req, res) => {
  let { name, surname, username, email, cc, phone, password, confirm, tos } = req.body;
  name = (name||"").trim(); surname=(surname||"").trim();
  username=(username||"").trim(); email=(email||"").trim().toLowerCase();
  cc=(cc||"").trim(); phone=(phone||"").trim();

  if(!name||!surname||!username||!email||!cc||!phone||!password||!confirm){
    return res.redirect("/register?e=1");
  }
  if(tos !== 'on') return res.redirect("/register?e=7"); // Debe aceptar TOS
  if(!/^[A-Za-z0-9_]{3,20}$/.test(username)) return res.redirect("/register?e=5");
  if(password !== confirm) return res.redirect("/register?e=2");
  if(!/^\+\d{1,4}$/.test(cc) || !/^\d{5,20}$/.test(phone.replace(/\D/g,""))) return res.redirect("/register?e=6");

  const existsMail = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  if(existsMail) return res.redirect("/register?e=3");
  const existsUser = db.prepare("SELECT id FROM users WHERE username=?").get(username);
  if(existsUser) return res.redirect("/register?e=4");

  const phoneFull = `${cc} ${phone}`.replace(/\s+/g," ").trim();
  const hash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();
  const mustVerify = db.getSetting("require_email_verification","0") === "1";
  const verified = mustVerify ? 0 : 1;

  const info = db.prepare(`
    INSERT INTO users (name,surname,username,email,phone,password_hash,is_admin,email_verified,created_at)
    VALUES (?,?,?,?,?,?,0,?,?)
  `).run(name, surname, username, email, phoneFull, hash, verified, now);

  const uid = info.lastInsertRowid;
  db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`).run(uid,"USD");
  db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`).run(uid,"MXN");

  if (!mustVerify){
    req.session.user = { id:uid, email, username, name, surname, is_admin:false };
    return res.redirect("/");
  }

  // Token + correo de verificación
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare(`INSERT INTO email_verify_tokens(token,user_id,created_at) VALUES(?,?,?)`)
    .run(token, uid, now);

  const verifyUrl = `${absoluteBase(req)}/verify?token=${token}`;
  const site = db.getSetting("site_name","SkyShop");
  const logo = db.getSetting("logo_url","");

  const brand = logo
    ? `<div style="display:flex;align-items:center;gap:10px"><img src="${logo}" width="36" height="36" style="border-radius:8px;display:block;border:1px solid #eee;object-fit:cover" alt="${site}"><div style="font-weight:800;font-size:18px">${site}</div></div>`
    : `<div style="font-weight:800;font-size:18px">${site}</div>`;

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:520px;margin:auto;padding:16px">
      ${brand}
      <h2 style="margin:16px 0 8px">Confirma tu correo</h2>
      <p>Hola ${name}, gracias por registrarte en <b>${site}</b>.</p>
      <p>Para activar tu cuenta, haz clic en el botón:</p>
      <p><a href="${verifyUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">Verificar correo</a></p>
      <p style="color:#6b7280;font-size:12px">Enlace directo: ${verifyUrl}</p>
    </div>`;

  try{
    const s = smtpGet();
    if (s.user || s.from){
      const fromAddr = s.name ? ('"' + s.name + '" <' + (s.from || s.user) + '>') : ((s.from || s.user || ""));
      const tx = mailTransport();
      await tx.sendMail({ from: fromAddr, to: email, subject: `${site} · Verifica tu correo`, html });
    }
  }catch(e){ console.error("Verify mail error:", e?.message); }

  return res.redirect("/login?err=2&email="+encodeURIComponent(email));
});

/* ===== GET /verify ===== */
router.get("/verify", (req,res) => {
  const token = String(req.query.token || "").trim();
  if (!token) return res.status(400).type("text/plain").send("Token faltante");
  const row = db.prepare(`SELECT user_id, used_at FROM email_verify_tokens WHERE token=?`).get(token);
  if (!row) return res.status(400).type("text/plain").send("Token inválido");
  if (row.used_at) return res.type("text/plain").send("Este enlace ya fue utilizado.");

  db.prepare(`UPDATE users SET email_verified=1 WHERE id=?`).run(row.user_id);
  db.prepare(`UPDATE email_verify_tokens SET used_at=? WHERE token=?`).run(new Date().toISOString(), token);

  const site = db.getSetting("site_name","SkyShop");
  res.type("html").send(`<!doctype html><meta charset="utf-8">
  <title>${site} · Correo verificado</title>
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:520px;margin:60px auto;padding:24px;border:1px solid #e5e7eb;border-radius:14px">
    <h2 style="margin-top:0">${site}</h2>
    <p>¡Tu correo fue verificado correctamente!</p>
    <p><a href="/login">Inicia sesión</a></p>
  </div>`);
});

/* ===== POST /verify/resend ===== */
router.post("/verify/resend", ensureGuest, async (req,res)=>{
  const email = String(req.body?.email||"").trim().toLowerCase();
  const u = db.prepare(`SELECT id,name FROM users WHERE email=?`).get(email);
  if (!u) return res.status(404).type("text/plain").send("No existe ese correo.");

  const flag = db.prepare(`SELECT email_verified FROM users WHERE id=?`).get(u.id)?.email_verified;
  if (flag === 1) return res.type("text/plain").send("Ya está verificado.");

  const token = crypto.randomBytes(24).toString("hex");
  db.prepare(`INSERT INTO email_verify_tokens(token,user_id,created_at) VALUES(?,?,?)`)
    .run(token, u.id, new Date().toISOString());

  const verifyUrl = `${absoluteBase(req)}/verify?token=${token}`;
  const site = db.getSetting("site_name","SkyShop");
  const logo = db.getSetting("logo_url","");

  const brand = logo
    ? `<div style="display:flex;align-items:center;gap:10px"><img src="${logo}" width="36" height="36" style="border-radius:8px;border:1px solid #eee;object-fit:cover"><div style="font-weight:800;font-size:18px">${site}</div></div>`
    : `<div style="font-weight:800;font-size:18px">${site}</div>`;

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:520px;margin:auto;padding:16px">
    ${brand}
    <p>Reenviamos tu enlace de verificación:</p>
    <p><a href="${verifyUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">Verificar correo</a></p>
  </div>`;

  try{
    const s = smtpGet();
    if (s.user || s.from){
      const fromAddr = s.name ? ('"' + s.name + '" <' + (s.from || s.user) + '>') : ((s.from || s.user || ""));
      const tx = mailTransport();
      await tx.sendMail({ from: fromAddr, to: email, subject: `${site} · Reenvío de verificación`, html });
    }
  }catch(e){ console.error("Resend verify mail:", e?.message); }

  res.type("text/plain").send("Enlace enviado.");
});

module.exports = router;
