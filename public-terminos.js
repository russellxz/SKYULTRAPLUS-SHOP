// public-terminos.js
"use strict";

const express = require("express");
const db = require("./db");

const router = express.Router();

/* ====== PAGE: /terminos ====== */
router.get("/", (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  res.type("html").send(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Términos del Servicio</title>
<meta name="description" content="Términos y Condiciones del servicio de ${site}">
<style>
  :root{
    --bg:#0b1220; --card:#111827; --txt:#e5e7eb; --muted:#9aa4b2; --line:#ffffff22;
    --accent:#2563eb;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt)}
  .topbar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;justify-content:space-between;
          padding:10px 12px;background:rgba(17,25,40,.6);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
  .brand{font-weight:900}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;border:1px solid #334155;background:#1f2a44;color:#fff;cursor:pointer;text-decoration:none}
  .btn.ghost{background:transparent;border-color:#334155;color:inherit}
  .wrap{max-width:900px;margin:0 auto;padding:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
  .title{margin:12px 0 8px 0}
  .muted{color:var(--muted)}
  .terms{white-space:pre-wrap;line-height:1.55;font-size:15.5px}
  .small{font-size:12px;color:var(--muted);margin-top:10px}

  /* Light mode */
  body.light{background:#f7f7fb;color:#0b1220}
  body.light .topbar, body.light .card{background:#fff;border-color:#00000018}
  body.light .btn{background:#fff;color:#0b1220;border-color:#c7ced6}
  body.light .btn.ghost{background:#fff}
  body.light .muted{color:#667085}
</style>
</head>
<body>
  <div class="topbar">
    <div class="brand">${site}</div>
    <div style="display:flex;gap:8px;align-items:center">
      <a class="btn ghost" href="/">Inicio</a>
      <button id="modeBtn" class="btn ghost" type="button">🌙</button>
    </div>
  </div>

  <div class="wrap">
    <h1 class="title">Términos del Servicio</h1>
    <p class="muted">Lee cuidadosamente nuestros Términos y Condiciones.</p>

    <section class="card">
      <div id="content" class="terms">Cargando…</div>
      <div class="small">Si continúas, aceptas estos términos.</div>
    </section>
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

  /* ===== Cargar términos (texto plano) ===== */
  var content = document.getElementById('content');
  fetch('/terminos/api/text', {cache:'no-store'})
    .then(r => r.json())
    .then(data => {
      var txt = String(data.text || '').trim();
      if (!txt) content.textContent = 'Aún no hay Términos del Servicio publicados.';
      else content.textContent = txt;
    })
    .catch(() => { content.textContent = 'Error cargando los términos.'; });
})();
</script>
</body>
</html>`);
});

/* ====== API pública: obtener texto ====== */
router.get("/api/text", (req, res) => {
  const text = String(db.getSetting("terms_text", "") || "");
  res.set("Cache-Control", "no-store");
  res.json({ text });
});

module.exports = router;
