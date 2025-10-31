// adminterminos.js
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

/* ====== helpers ====== */
function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings(key,value) VALUES(?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(key, value);
}

/* ====== PAGE: /admin/terminos ====== */
router.get("/", ensureAdmin, (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  res.type("html").send(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Admin · Términos</title>
<style>
  :root{
    --bg:#0b1220; --card:#111827; --txt:#e5e7eb; --muted:#9aa4b2; --line:#ffffff22;
    --accent:#2563eb; --danger:#ef4444; --ok:#16a34a;
  }
  *{box-sizing:border-box} html,body{height:100%}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt)}
  body.light{background:#f7f7fb;color:#0b1220}
  body.light .topbar, body.light .card{background:#fff;border-color:#00000018}
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
  .wrap{max-width:900px;margin:0 auto;padding:14px}
  .title{margin:10px 0 6px 0}
  .muted{color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
  .input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:inherit}
  body.light .input{background:#fff;border-color:#00000022}
  textarea.input{min-height:300px;resize:vertical;line-height:1.4}
  .toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;margin:10px 0}
  .muted-small{font-size:12px;color:var(--muted)}
</style>
</head>
<body>
  <div class="topbar">
    <div class="row">
      <div class="brand">${site} · Admin</div>
    </div>
    <div class="row">
      <a class="btn ghost" href="/admin">← Volver</a>
      <a class="btn red" href="/logout">Salir</a>
    </div>
  </div>

  <div class="wrap">
    <h2 class="title">Términos & Condiciones (texto plano)</h2>
    <p class="muted">Guarda aquí el contenido en <b>texto simple</b>. Más tarde otra página pública lo mostrará.</p>

    <section class="card">
      <div class="toolbar">
        <div class="muted-small" id="status">Cargando…</div>
        <div class="row">
          <button id="btnClear" class="btn ghost" type="button" title="Vaciar texto">Vaciar</button>
          <button id="btnSave" class="btn ok" type="button">Guardar</button>
        </div>
      </div>
      <textarea id="txt" class="input" placeholder="Escribe los Términos & Condiciones en texto plano..."></textarea>
      <div class="toolbar">
        <div class="muted-small"><span id="count">0</span> caracteres</div>
        <div class="muted-small">Último guardado: <span id="savedAt">—</span></div>
      </div>
    </section>
  </div>

<script>
(function(){
  var txt = document.getElementById('txt');
  var btnSave = document.getElementById('btnSave');
  var btnClear = document.getElementById('btnClear');
  var statusEl = document.getElementById('status');
  var countEl = document.getElementById('count');
  var savedAtEl = document.getElementById('savedAt');
  var dirty = false;

  function setStatus(t){ statusEl.textContent = t; }
  function updateCount(){ countEl.textContent = (txt.value||'').length; }
  function setSavedNow(){ savedAtEl.textContent = new Date().toLocaleString(); }

  async function load(){
    try{
      setStatus('Cargando…');
      const r = await fetch('/admin/terminos/api/text', {cache:'no-store', credentials:'same-origin'});
      const data = await r.json();
      txt.value = String(data.text || '');
      dirty = false;
      updateCount();
      setStatus('Listo');
    }catch(e){
      setStatus('Error cargando');
    }
  }

  async function save(){
    try{
      btnSave.disabled = true;
      setStatus('Guardando…');
      const r = await fetch('/admin/terminos/api/save', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ text: txt.value })
      });
      const t = await r.text();
      if (t !== 'OK') { alert(t); setStatus('Error'); }
      else { setStatus('Guardado'); dirty = false; setSavedNow(); }
    }catch(e){
      alert('Error: '+e.message);
      setStatus('Error');
    }finally{
      btnSave.disabled = false;
    }
  }

  txt.addEventListener('input', function(){
    dirty = true;
    updateCount();
  });

  btnSave.addEventListener('click', save);

  btnClear.addEventListener('click', function(){
    if (!confirm('¿Vaciar el texto de Términos & Condiciones?')) return;
    txt.value = '';
    dirty = true;
    updateCount();
  });

  window.addEventListener('beforeunload', function(e){
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  load();
})();
</script>
</body>
</html>`);
});

/* ====== API: obtener texto ====== */
router.get("/api/text", ensureAdmin, (req, res) => {
  const text = String(db.getSetting("terms_text", "") || "");
  // Evita cache del navegador para que siempre veas lo último
  res.set("Cache-Control", "no-store");
  res.json({ text });
});

/* ====== API: guardar texto ====== */
router.post("/api/save", ensureAdmin, (req, res) => {
  try {
    const text = String(req.body?.text ?? "");
    // Guarda tal cual (texto plano)
    setSetting("terms_text", text);
    res.send("OK");
  } catch (e) {
    res.status(500).send("ERR: " + (e?.message || "save"));
  }
});

module.exports = router;