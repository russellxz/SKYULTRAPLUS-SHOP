// admin_mail.js (con íconos en el lateral)
"use strict";

const express = require("express");
const nodemailer = require("nodemailer");
const db = require("./db");

const router = express.Router();

/* ---------- auth ---------- */
function ensureAdmin(req, res, next) {
  const u = req.session?.user;
  if (!u) return res.redirect("/login");
  if (!u.is_admin) return res.redirect("/");
  next();
}

/* ---------- helpers / settings ---------- */
function smtpGet() {
  const site = db.getSetting("site_name", "SkyShop");
  const host = db.getSetting("smtp_host", "");
  const port = parseInt(db.getSetting("smtp_port", "587"), 10) || 587;
  const secure = (db.getSetting("smtp_secure", port === 465 ? "ssl" : "tls") || "tls").toLowerCase(); // tls|ssl
  const user = db.getSetting("smtp_user", "");
  const pass = db.getSetting("smtp_pass", "");
  let from = db.getSetting("smtp_from", "") || user || "";
  const name = db.getSetting("smtp_from_name", site);

  // Hostinger: from debe ser igual al user
  if (String(host).toLowerCase().includes("hostinger") && user && from && from.toLowerCase() !== user.toLowerCase()) {
    from = user;
  }

  return { host, port, secure, user, pass, from, name };
}

function smtpSet(p = {}) {
  if (p.host != null) db.setSetting("smtp_host", String(p.host));
  if (p.port != null) db.setSetting("smtp_port", String(p.port));
  if (p.user != null) db.setSetting("smtp_user", String(p.user));
  if (p.pass != null) db.setSetting("smtp_pass", String(p.pass));
  if (p.from != null) db.setSetting("smtp_from", String(p.from));
  if (p.name != null) db.setSetting("smtp_from_name", String(p.name));
  if (p.secure != null) db.setSetting("smtp_secure", String(p.secure).toLowerCase()==="ssl" ? "ssl" : "tls");
}

function mailTransport() {
  const s = smtpGet();
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure === "ssl",     // true para 465
    requireTLS: s.secure === "tls", // fuerza TLS si se eligió tls
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
  });
}

/* ---------- middlewares locales ---------- */
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

/* =================== UI =================== */
router.get("/", ensureAdmin, (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  const smtp = smtpGet();

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Admin · Correo</title>
<style>
  :root{ --bg:#0b1220; --card:#111827; --txt:#e5e7eb; --muted:#9aa4b2; --line:#ffffff22; --accent:#2563eb; --ok:#16a34a; --danger:#ef4444; }
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
  .btn.ok{background:var(--ok);border-color:#15803d}
  .btn.red{background:var(--danger);border-color:#b91c1c}
  .burger{width:40px;height:40px;display:grid;place-items:center;border-radius:10px;border:1px solid #334155;background:transparent;cursor:pointer}
  .burger span{width:20px;height:2px;background:currentColor;position:relative;display:block}
  .burger span:before,.burger span:after{content:"";position:absolute;left:0;right:0;height:2px;background:currentColor}
  .burger span:before{top:-6px} .burger span:after{top:6px}

  .drawer{position:fixed;inset:0 auto 0 0;width:280px;transform:translateX(-100%);transition:transform .22s ease;z-index:6}
  .drawer.open{transform:none}
  .drawer .panel{height:100%;background:rgba(17,25,40,.8);backdrop-filter:blur(10px);border-right:1px solid var(--line);padding:14px}
  .scrim{position:fixed;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(1px);opacity:0;visibility:hidden;transition:.18s ease;z-index:5}
  .scrim.show{opacity:1;visibility:visible}

  /* Lateral con íconos */
  .nav a{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #334155;border-radius:10px;margin-bottom:8px;color:inherit;text-decoration:none}
  .nav a:hover{border-color:#64748b}
  .nav a.active{border-color:#1d4ed8}
  .nav a svg{width:18px;height:18px;flex:0 0 18px;opacity:.95}

  .wrap{max-width:1100px;margin:0 auto;padding:14px}
  .title{margin:10px 0 6px 0}
  .muted{color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
  .input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:inherit}
  body.light .input{background:#fff;border-color:#00000022}
  label{display:block;margin:6px 0 6px;color:var(--muted)}
  .field{position:relative}
  .eye{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:transparent;border:0;cursor:pointer;color:inherit}
  textarea.input{min-height:160px;resize:vertical}
  .foot{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
  @media(max-width:820px){ .grid2,.grid3{grid-template-columns:1fr} }
</style>
<body>
  <div class="topbar">
    <div class="row">
      <button id="menuBtn" class="burger" aria-label="Abrir menú"><span></span></button>
      <div class="brand">${site} · Correo</div>
    </div>
    <div class="row">
      <button id="modeBtn" class="btn ghost" type="button">🌙</button>
      <a class="btn ghost" href="/admin">← Usuarios</a>
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
        <a class="active" href="/admin/mail" data-match="^/admin/mail">
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
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0-1 1 1 1 0 0 0 1 1v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a1 1 0 0 0 1-1 1 1 0 0 0-1-1V5Z"/></svg>
          Tickets
        </a>
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>

  <div class="wrap">
    <h2 class="title">Configuración de correo (SMTP)</h2>
    <p class="muted">Guarda tus credenciales SMTP, prueba el envío y envía correos a todos o a un usuario en específico.</p>

    <!-- Preferencias -->
    <section class="card" style="margin-bottom:12px">
      <label>
        <input id="requireVerify" type="checkbox" ${db.getSetting("require_email_verification","0")==="1" ? "checked" : ""}>
        <span style="margin-left:6px">Requerir <b>verificación de correo</b> para iniciar sesión</span>
      </label>
      <div class="foot">
        <button class="btn ok" id="saveVerifyBtn" type="button">Guardar preferencia</button>
      </div>
    </section>

    <!-- SMTP -->
    <section class="card">
      <form id="smtpForm">
        <div class="grid3">
          <div>
            <label>Host de correo</label>
            <input class="input" name="host" value="${smtp.host}" placeholder="smtp.hostinger.com" required>
          </div>
          <div>
            <label>Puerto de correo</label>
            <input class="input" name="port" value="${smtp.port}" placeholder="587 o 465" required>
          </div>
          <div>
            <label>Cifrado de correo</label>
            <select class="input" name="secure">
              <option value="tls" ${smtp.secure === "tls" ? "selected" : ""}>TLS (587)</option>
              <option value="ssl" ${smtp.secure === "ssl" ? "selected" : ""}>SSL (465)</option>
            </select>
          </div>
        </div>

        <div class="grid2" style="margin-top:10px">
          <div class="field">
            <label>Nombre de usuario del correo</label>
            <input class="input" name="user" value="${smtp.user}" placeholder="correo@dominio.com" required>
          </div>
          <div class="field">
            <label>Contraseña de correo</label>
            <input class="input" id="passField" type="password" name="pass" value="${smtp.pass}" placeholder="••••••••" required>
            <button type="button" class="eye" id="eyeBtn" title="Mostrar/ocultar">👁</button>
          </div>
        </div>

        <div class="grid2" style="margin-top:10px">
          <div>
            <label>Dirección de correo (From)</label>
            <input class="input" name="from" value="${smtp.from}" placeholder="igual al usuario si usas Hostinger">
          </div>
          <div>
            <label>Nombre del remitente</label>
            <input class="input" name="name" value="${smtp.name}" placeholder="SkyUltraPlus">
          </div>
        </div>

        <div class="foot">
          <button class="btn blue" type="submit">Guardar SMTP</button>
          <button class="btn ghost" type="button" id="testBtn">Probar SMTP</button>
        </div>
      </form>
    </section>

    <!-- Enviar correo -->
    <section class="card" style="margin-top:12px">
      <h3 style="margin:0 0 10px">Enviar correo</h3>
      <form id="sendForm">
        <div class="grid2">
          <div>
            <label>Destino</label>
            <select class="input" id="sendToMode" name="mode">
              <option value="all">Todos los usuarios registrados</option>
              <option value="one">Un destinatario específico</option>
            </select>
          </div>
          <div id="oneBox" style="display:none">
            <label>Correo del destinatario</label>
            <input class="input" id="oneEmail" name="to" placeholder="usuario@dominio.com">
          </div>
        </div>

        <div style="margin-top:10px">
          <label>Asunto</label>
          <input class="input" name="subject" placeholder="Asunto del mensaje" required>
        </div>
        <div style="margin-top:10px">
          <label>Mensaje (HTML permitido)</label>
          <textarea class="input" name="message" placeholder="Contenido del correo..." required></textarea>
        </div>

        <div class="foot">
          <button class="btn blue" type="submit">Enviar</button>
        </div>
      </form>
      <p class="muted" style="margin-top:8px">Sugerencia: puedes usar saltos de línea simples, se convertirán automáticamente en &lt;br&gt;.</p>
    </section>
  </div>

<script>
(function(){
  /* Tema */
  var modeBtn=document.getElementById('modeBtn');
  function applyMode(m){ var light=(m==='light'); document.body.classList.toggle('light',light); modeBtn.textContent=light?'☀️':'🌙'; localStorage.setItem('ui:mode',light?'light':'dark'); }
  applyMode(localStorage.getItem('ui:mode')||'dark');
  modeBtn.addEventListener('click',function(){ applyMode(document.body.classList.contains('light')?'dark':'light'); });

  /* Drawer */
  var drawer=document.getElementById('drawer'), scrim=document.getElementById('scrim'), menuBtn=document.getElementById('menuBtn');
  function openDrawer(){ drawer.classList.add('open'); scrim.classList.add('show'); }
  function closeDrawer(){ drawer.classList.remove('open'); scrim.classList.remove('show'); }
  menuBtn.addEventListener('click',openDrawer); scrim.addEventListener('click',closeDrawer);
  window.addEventListener('keydown',function(e){ if(e.key==='Escape') closeDrawer(); });

  /* Marca activo en el lateral */
  (function(){
    var path = location.pathname;
    document.querySelectorAll('#sidenav a').forEach(function(a){
      var re = new RegExp(a.getAttribute('data-match'));
      if (re.test(path)) a.classList.add('active');
    });
  })();

  /* Ojo password */
  var eye=document.getElementById('eyeBtn'); var passField=document.getElementById('passField');
  eye.addEventListener('click',function(){ passField.type = passField.type==='password' ? 'text' : 'password'; });

  /* Guardar preferencia verificación */
  var requireVerify=document.getElementById('requireVerify');
  var saveVerifyBtn=document.getElementById('saveVerifyBtn');
  saveVerifyBtn.addEventListener('click', async function(){
    try{
      const r=await fetch('/admin/mail/toggle-verify',{
        method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
        body:JSON.stringify({ require: requireVerify.checked?1:0 })
      });
      alert(await r.text());
    }catch(e){ alert('Error: '+e.message); }
  });

  /* Guardar SMTP (URLENCODED) */
  var smtpForm=document.getElementById('smtpForm');
  smtpForm.addEventListener('submit', async function(e){
    e.preventDefault();
    const fd = new FormData(smtpForm);
    const body = new URLSearchParams([...fd.entries()]);
    try{
      const r=await fetch('/admin/mail/save',{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
        credentials:'same-origin',
        body
      });
      alert(await r.text());
    }catch(err){ alert('Error: '+err.message); }
  });

  /* Probar SMTP */
  var testBtn=document.getElementById('testBtn');
  testBtn.addEventListener('click', async function(){
    var to=prompt('Enviar correo de prueba a:'); if(!to) return;
    try{
      const r=await fetch('/admin/mail/test',{
        method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
        body:JSON.stringify({to})
      });
      alert(await r.text());
    }catch(err){ alert('Error: '+err.message); }
  });

  /* Enviar correo (URLENCODED) */
  var sendForm=document.getElementById('sendForm');
  var modeSel=document.getElementById('sendToMode');
  var oneBox=document.getElementById('oneBox');
  function updateDest(){ oneBox.style.display = modeSel.value==='one' ? 'block':'none'; }
  modeSel.addEventListener('change',updateDest); updateDest();

  sendForm.addEventListener('submit', async function(e){
    e.preventDefault();
    const fd = new FormData(sendForm);
    if (modeSel.value === 'one' && !(fd.get('to')||'').trim()){
      alert('Ingresa el correo destino'); return;
    }
    const body = new URLSearchParams([...fd.entries()]);
    try{
      const r=await fetch('/admin/mail/send',{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
        credentials:'same-origin',
        body
      });
      alert(await r.text());
    }catch(err){ alert('Error: '+err.message); }
  });
})();
</script>
</body></html>`);
});

/* =================== API =================== */

/** Guardar credenciales SMTP */
router.post("/save", ensureAdmin, (req, res) => {
  const host = String(req.body.host || "").trim();
  const port = parseInt(req.body.port || "587", 10) || 587;
  const secure = (String(req.body.secure || (port === 465 ? "ssl" : "tls")).toLowerCase() === "ssl") ? "ssl" : "tls";
  const user = String(req.body.user || "").trim();
  const pass = String(req.body.pass || "");
  const from = String(req.body.from || "").trim();
  const name = String(req.body.name || db.getSetting("site_name","SkyShop")).trim();

  smtpSet({ host, port, secure, user, pass, from, name });
  return res.type("text/plain; charset=utf-8").send("SMTP guardado.");
});

/** Probar SMTP (un envío) */
router.post("/test", ensureAdmin, async (req, res) => {
  const to = String(req.body?.to || "").trim();
  if (!to) return res.type("text/plain").send("ERR: destino vacío");

  const s = smtpGet();
  const fromAddr = s.name ? ('"' + s.name + '" <' + (s.from || s.user) + '>') : ((s.from || s.user || ""));
  if (!fromAddr) return res.type("text/plain").send("ERR: configura usuario/from");

  try{
    const tx = mailTransport();
    await tx.sendMail({
      from: fromAddr,
      to,
      subject: "[Prueba SMTP] " + (db.getSetting("site_name","SkyShop")),
      html: "<b>¡Hola!</b> Esto es una prueba SMTP correcta."
    });
    res.type("text/plain").send("OK");
  }catch(e){
    res.type("text/plain").send("ERR: " + (e?.message || "SMTP"));
  }
});

/** Enviar correo (a todos o a un destinatario) */
router.post("/send", ensureAdmin, async (req, res) => {
  const mode = String(req.body?.mode || "all");
  const subject = String(req.body?.subject || "(sin asunto)").trim();
  const message = String(req.body?.message || "").replace(/\n/g, "<br>");
  if (!subject || !message) return res.type("text/plain").send("ERR: asunto/mensaje vacíos");

  const s = smtpGet();
  const fromAddr = s.name ? ('"' + s.name + '" <' + (s.from || s.user) + '>') : ((s.from || s.user || ""));
  if (!fromAddr) return res.type("text/plain").send("ERR: configura usuario/from");

  const tx = mailTransport();

  try{
    if (mode === "one") {
      const to = String(req.body?.to || "").trim();
      if (!to) return res.type("text/plain").send("ERR: correo destino vacío");
      await tx.sendMail({ from: fromAddr, to, subject, html: message });
      return res.type("text/plain").send("OK: enviado");
    }

    // all
    const emails = db.prepare("SELECT email FROM users").all().map(r => r.email).filter(Boolean);
    let ok=0, fail=0;
    for (const to of emails) {
      try { await tx.sendMail({ from: fromAddr, to, subject, html: message }); ok++; }
      catch { fail++; }
    }
    return res.type("text/plain").send("Enviados: " + ok + " · Fallidos: " + fail);
  }catch(e){
    return res.type("text/plain").send("ERR: " + (e?.message || "envío"));
  }
});

/** Guardar preferencia de verificación para login */
router.post("/toggle-verify", ensureAdmin, (req, res) => {
  const v = Number(req.body?.require ? 1 : 0);
  db.setSetting("require_email_verification", String(v));
  res.type("text/plain").send("Preferencia guardada: " + (v ? "Requerir verificación" : "No requerida"));
});

module.exports = router;