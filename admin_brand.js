// admin_brand.js (URL de logo, comunidad WhatsApp/Telegram y WhatsApp del dueño; modo claro/oscuro y lateral con iconos)
"use strict";

const express = require("express");
const db = require("./db");

const router = express.Router();

/* --- auth --- */
function ensureAdmin(req, res, next) {
  const u = req.session && req.session.user;
  if (!u) return res.redirect("/login");
  if (!u.is_admin) return res.redirect("/");
  next();
}

/* --- middlewares del router --- */
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

/* --- peque util para escapar HTML en atributos/texto --- */
function esc(s){
  return String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

/* --- UI: /admin/brand --- */
router.get("/brand", ensureAdmin, (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  const logo = db.getSetting("logo_url", "");
  // Nuevas opciones
  const community = db.getSetting("community_url", db.getSetting("whatsapp_group_url",""));
  const ownerWa   = db.getSetting("owner_whatsapp", "");

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(site)} · Admin · Marca y enlaces</title>
<style>
  :root{
    --bg:#0b1220; --card:#111827; --txt:#e5e7eb; --muted:#9aa4b2; --line:#ffffff22;
    --accent:#2563eb; --danger:#ef4444;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt)}
  body.light{background:#f7f7fb;color:#0b1220}
  body.light .topbar, body.light .drawer .panel, body.light .card{background:#fff}
  body.light .topbar, body.light .card{border-color:#00000018}
  body.light .muted{color:#667085}
  body.light .input{background:#fff;border-color:#00000022}

  .topbar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;justify-content:space-between;
          padding:10px 12px;background:rgba(17,25,40,.6);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
  .brand{font-weight:900}

  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;border:1px solid #334155;background:#1f2a44;color:#fff;text-decoration:none;cursor:pointer}
  .btn.ghost{background:transparent;border-color:#334155;color:inherit}
  .btn.blue{background:var(--accent);border-color:#1d4ed8}
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

  .nav a{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #334155;border-radius:10px;margin-bottom:8px;color:inherit;text-decoration:none}
  .nav a:hover{border-color:#64748b}
  .nav a.active{border-color:#1d4ed8}
  .nav a svg{width:18px;height:18px;flex:0 0 18px;opacity:.95}

  .wrap{max-width:900px;margin:0 auto;padding:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}

  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media(max-width:760px){ .grid{grid-template-columns:1fr} }

  .input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:inherit}
  label{display:block;margin:6px 0 6px;color:var(--muted)}
  .muted{color:var(--muted)}

  .preview{display:flex;align-items:center;gap:12px;margin-top:8px}
  .preview img{width:64px;height:64px;border-radius:12px;object-fit:cover;background:#0f172a;border:1px solid #ffffff22}

  .help{font-size:12px;margin-top:4px}
  .link{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
</style>
<body>
  <div class="topbar">
    <div class="row">
      <button id="menuBtn" class="burger" aria-label="Abrir menú"><span></span></button>
      <div class="brand">${esc(site)} · Marca y enlaces</div>
    </div>
    <div class="row">
      <button id="modeBtn" class="btn ghost" type="button">🌙</button>
      <a class="btn ghost" href="/admin">← Usuarios</a>
      <a class="btn ghost" href="/">Dashboard</a>
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
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0-1 1 1 1 0 0 0 1 1v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a1 1 0 0 0 1-1 1 1 0 0 0-1-1V5Z"/></svg>
          Tickets
        </a>
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>

  <div class="wrap">
    <section class="card">
      <form id="brandForm">
        <div class="grid">
          <div>
            <label>Nombre de la tienda</label>
            <input class="input" name="site_name" value="${esc(site)}" placeholder="SkyShop" required>
          </div>
          <div>
            <label>Logo (URL https)</label>
            <input class="input" id="logoUrl" name="logo_url" value="${esc(logo)}" placeholder="https://cdn.tu-dominio.com/logo.png">
          </div>
        </div>

        <div class="preview">
          <div>Vista previa:</div>
          <img id="logoPrev" src="${esc(logo || '')}" alt="logo">
        </div>

        <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">

        <div class="grid">
          <div>
            <label>URL de tu comunidad (WhatsApp / Telegram / Discord)</label>
            <input class="input" id="communityUrl" name="community_url" value="${esc(community)}" placeholder="https://chat.whatsapp.com/INVITECODE">
            <div class="help muted link" id="communityHelp">Tip: Debe comenzar con http:// o https://</div>
          </div>
          <div>
            <label>WhatsApp del dueño (solo dígitos, sin +)</label>
            <input class="input" id="ownerWa" name="owner_whatsapp" value="${esc(ownerWa)}" placeholder="5076500XXXX">
            <div class="help muted" id="waHelp">
              Escribe solo números (E.164 sin +). Ejemplo: Panamá <b>5076500XXXX</b>.
              Para México usa <b>521</b> + 10 dígitos (ej.: <b>5215512345678</b>).
            </div>
          </div>
        </div>

        <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn blue" type="submit">Guardar</button>
          <button class="btn ghost" type="button" id="testLogo">Probar logo</button>
          <button class="btn ghost" type="button" id="testCommunity">Probar comunidad</button>
          <button class="btn ghost" type="button" id="testWa">Probar WhatsApp</button>
        </div>
      </form>
      <p class="muted" style="margin-top:8px">Tip: aloja el logo en un CDN propio y usa una URL <b>https</b> estable.</p>
    </section>
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

  /* ===== Formulario ===== */
  const f = document.getElementById('brandForm');

  const logoUrl = document.getElementById('logoUrl');
  const prev = document.getElementById('logoPrev');
  function updateLogoPrev(){ prev.src = (logoUrl.value || '').trim(); }
  document.getElementById('testLogo').addEventListener('click', updateLogoPrev);

  const comm = document.getElementById('communityUrl');
  const commHelp = document.getElementById('communityHelp');
  document.getElementById('testCommunity').addEventListener('click', function(){
    const v=(comm.value||'').trim();
    if(!v) return alert('Primero escribe la URL de tu comunidad');
    window.open(v,'_blank','noopener');
  });

  const wa = document.getElementById('ownerWa');
  const waHelp = document.getElementById('waHelp');
  function waPreview(){
    const digits = (wa.value||'').replace(/\\D+/g,'');
    if (digits){
      const href = 'https://wa.me/' + digits;
      waHelp.innerHTML = 'Abrir chat: <a href="'+href+'" target="_blank" rel="noopener">'+href+'</a>';
    }else{
      waHelp.textContent = 'Escribe solo números (sin +, espacios ni guiones). Para México usa 521 + 10 dígitos.';
    }
  }
  wa.addEventListener('input', waPreview);
  document.getElementById('testWa').addEventListener('click', function(){
    const digits = (wa.value||'').replace(/\\D+/g,'');
    if(!digits) return alert('Primero escribe el número de WhatsApp (solo dígitos).');
    window.open('https://wa.me/'+digits, '_blank', 'noopener');
  });
  waPreview();

  f.addEventListener('submit', async function(e){
    e.preventDefault();
    const body = {
      site_name: (f.site_name.value||'').trim(),
      logo_url: (logoUrl.value||'').trim(),
      community_url: (comm.value||'').trim(),
      owner_whatsapp: (wa.value||'').replace(/\\D+/g,'')
    };
    try{
      const r = await fetch('/admin/brand/save', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body)
      });
      alert(await r.text());
    }catch(err){ alert('Error: '+err.message); }
  });
})();
</script>
</body>
</html>`);
});

/* --- API: guardar --- */
router.post("/brand/save", ensureAdmin, (req, res) => {
  const site_name = String(req.body?.site_name || "").trim() || "SkyShop";
  let logo_url = String(req.body?.logo_url || "").trim();
  let community_url = String(req.body?.community_url || "").trim();
  let owner_whatsapp_raw = String(req.body?.owner_whatsapp || "").trim();

  // Validaciones de URL (http/https)
  function validateHttpUrl(u){
    if (!u) return true;
    try {
      const x = new URL(u);
      if (x.protocol !== "http:" && x.protocol !== "https:") return false;
      return true;
    } catch { return false; }
  }

  if (!validateHttpUrl(logo_url)){
    return res.type("text/plain").send("ERR: la URL del logo debe comenzar con http:// o https://");
  }
  if (!validateHttpUrl(community_url)){
    return res.type("text/plain").send("ERR: la URL de la comunidad debe comenzar con http:// o https://");
  }

  // Normaliza WhatsApp a solo dígitos
  const owner_whatsapp = owner_whatsapp_raw.replace(/\D+/g,"");
  if (owner_whatsapp && !/^\d{7,15}$/.test(owner_whatsapp)){
    return res.type("text/plain").send("ERR: WhatsApp inválido. Usa solo dígitos (7–15). Para México usa 521 + 10 dígitos.");
  }

  db.setSetting("site_name", site_name);
  db.setSetting("logo_url", logo_url);

  // Nuevas opciones
  db.setSetting("community_url", community_url);
  db.setSetting("whatsapp_group_url", community_url); // alias compatible
  db.setSetting("owner_whatsapp", owner_whatsapp);

  res.type("text/plain").send("Guardado.");
});

module.exports = router;