// admin_products.js — Admin: lista, creación/edición y eliminación de productos (pago único + stock)
"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const db = require("./db");

const router = express.Router();

/* ========= límites de subida ========= */
// Permitimos 15 MB reales (binario). Como el base64 agrega ~33%,
// ponemos el parser en 30 MB para ir sobrados.
const MAX_IMAGE_MB = 15;
const PARSER_LIMIT = "30mb";

// Parser GRANDE solo para este router (evita el PayloadTooLargeError)
const parseLarge = express.urlencoded({ limit: PARSER_LIMIT, extended: true });

/* ========= helpers ========= */
function ensureAdmin(req,res,next){
  const u = req.session && req.session.user;
  if (!u) return res.redirect("/login");
  if (!u.is_admin) return res.redirect("/");
  next();
}

function ensureSchema(){
  // products
  db.prepare(`CREATE TABLE IF NOT EXISTS products(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    reveal_info TEXT DEFAULT '',
    price REAL NOT NULL,
    currency TEXT NOT NULL CHECK(currency IN ('USD','MXN')),
    image_path TEXT DEFAULT '',
    period_minutes INTEGER NOT NULL DEFAULT 43200, -- 30 días (0 = único)
    billing_type TEXT NOT NULL DEFAULT 'recurring' CHECK(billing_type IN ('recurring','one_time')),
    stock INTEGER NOT NULL DEFAULT -1,            -- -1 = ilimitado, 0 = sin stock
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`).run();

  // Migraciones defensivas por si venía de otra versión
  try{ db.prepare(`ALTER TABLE products ADD COLUMN reveal_info TEXT DEFAULT ''`).run(); }catch{}
  try{ db.prepare(`ALTER TABLE products ADD COLUMN period_minutes INTEGER NOT NULL DEFAULT 43200`).run(); }catch{}
  try{ db.prepare(`ALTER TABLE products ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))`).run(); }catch{}
  try{ db.prepare(`ALTER TABLE products ADD COLUMN billing_type TEXT NOT NULL DEFAULT 'recurring'`).run(); }catch{}
  try{ db.prepare(`UPDATE products SET billing_type='recurring' WHERE billing_type IS NULL OR billing_type=''`).run(); }catch{}
  try{ db.prepare(`ALTER TABLE products ADD COLUMN stock INTEGER NOT NULL DEFAULT -1`).run(); }catch{}
}
ensureSchema();

/* ========= UI: lista ========= */
router.get("/", ensureAdmin, (req,res)=>{
  const site = db.getSetting("site_name","SkyShop");
  const rows = db.prepare(`
    SELECT id,name,price,currency,active,billing_type,stock
    FROM products
    ORDER BY id DESC LIMIT 200
  `).all();

  const items = rows.map(p=>{
    const stockTxt = (p.stock < 0) ? "∞" : String(p.stock);
    const stockClass = (p.stock === 0) ? "out" : (p.stock < 0 ? "inf" : "ok");
    return `
    <tr data-id="${p.id}">
      <td>${p.id}</td>
      <td>${p.name}</td>
      <td>${p.currency} ${Number(p.price).toFixed(2)}</td>
      <td><span class="tag ${p.billing_type==='one_time'?'one':'rec'}">${p.billing_type==='one_time'?'Único':'Recurrente'}</span></td>
      <td><span class="tag ${stockClass}">${stockTxt}</span></td>
      <td><span class="tag ${p.active? 'ok':'mut'}">${p.active? 'Activo' : 'Oculto'}</span></td>
      <td class="right">
        <a class="btn blue" href="/admin/products/new?id=${p.id}">Editar</a>
        <button class="btn red" data-del="${p.id}">Eliminar</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="muted">Sin productos.</td></tr>`;

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Admin · Productos</title>
<style>
  :root{
    --bg:#0b1220; --txt:#e5e7eb; --muted:#9aa4b2; --card:#111827; --line:#ffffff22;
    --accent:#2563eb; --ok:#16a34a; --danger:#ef4444;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt)}
  body.light{background:#ffffff;color:#0b1220}
  body.light .card{background:#fff;border-color:#00000018}
  body.light .muted{color:#667085}

  .wrap{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:18px}
  .top{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:10px}
  .pill{padding:8px 10px;border-radius:999px;background:#ffffff18;border:1px solid #ffffff28;color:inherit;text-decoration:none}
  body.light .pill{background:#00000010;border-color:#00000018}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:9px 12px;border-radius:10px;border:1px solid transparent;cursor:pointer;text-decoration:none}
  .btn.blue{background:var(--accent); color:#fff; border-color:#1d4ed8}
  .btn.red{background:var(--danger); color:#fff; border-color:#b91c1c}
  .btn.ghost{background:transparent;border-color:#334155;color:inherit}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
  .title{display:flex;justify-content:space-between;align-items:center;gap:10px}
  table{width:100%;border-collapse:separate;border-spacing:0;margin-top:12px}
  th,td{padding:12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
  .right{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
  .muted{color:var(--muted)}
  .tag{display:inline-block;padding:4px 8px;border-radius:999px;border:1px solid var(--line);font-size:12px}
  .tag.ok{background:#16a34a22;border-color:#16a34a55}
  .tag.mut{background:#9aa4b222;border-color:#9aa4b255}
  .tag.one{background:#f59e0b22;border-color:#f59e0b55}
  .tag.rec{background:#2563eb22;border-color:#2563eb55}
  .tag.inf{background:#64748b22;border-color:#64748b55}
  .tag.out{background:#ef444422;border-color:#ef444455}
  @media(max-width:920px){
    .title{flex-direction:column;align-items:stretch}
    .right{justify-content:flex-start}
  }
</style>
<body>
  <main class="wrap">
    <div class="top">
      <a class="pill" href="/admin">← Volver a Admin</a>
      <div style="display:flex;gap:8px">
        <a class="btn blue" href="/admin/products/new">Nuevo producto</a>
        <button id="modeBtn" class="pill" type="button">🌙</button>
      </div>
    </div>

    <section class="card">
      <div class="title">
        <h2 style="margin:0">Productos</h2>
        <div class="muted">Crea, edita o elimina productos.</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Nombre</th><th>Precio</th><th>Tipo</th><th>Stock</th><th>Estado</th><th class="right">Acciones</th>
          </tr>
        </thead>
        <tbody id="tbody">${items}</tbody>
      </table>
    </section>
  </main>

<script>
  // Tema
  (function(){
    const btn=document.getElementById('modeBtn');
    function apply(mode){
      const light=(mode==='light');
      document.body.classList.toggle('light', light);
      btn.textContent = light ? '☀️' : '🌙';
      localStorage.setItem('ui:mode', light?'light':'dark');
    }
    apply(localStorage.getItem('ui:mode') || 'dark');
    btn.addEventListener('click', ()=>apply(document.body.classList.contains('light')?'dark':'light'));
  })();

  // Eliminar producto (fetch DELETE)
  (function(){
    const tbody=document.getElementById('tbody');
    tbody.addEventListener('click', async (e)=>{
      const btn = e.target.closest('button[data-del]');
      if(!btn) return;
      const id = btn.getAttribute('data-del');
      if(!id) return;
      if(!confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) return;
      btn.disabled = true;
      try{
        const r = await fetch('/admin/products/'+id, { method:'DELETE' });
        const t = await r.text();
        if (t !== 'OK') { alert(t); btn.disabled=false; return; }
        const tr = btn.closest('tr'); if(tr) tr.remove();
      }catch(err){
        alert('Error: '+err.message);
        btn.disabled=false;
      }
    });
  })();
</script>
</body>
</html>`);
});

/* ========= UI: crear/editar ========= */
router.get("/new", ensureAdmin, (req,res)=>{
  const site = db.getSetting("site_name","SkyShop");
  const id = Number(req.query.id||0);
  let p = id ? db.prepare(`SELECT * FROM products WHERE id=?`).get(id) : null;
  if (!p) p = {
    id:0, name:"", description:"", reveal_info:"",
    price:"", currency:"USD", image_path:"",
    period_minutes:43200, billing_type:"recurring",
    stock:-1, active:1
  };

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · ${p.id?'Editar':'Nuevo'} producto</title>
<style>
  :root{ --bg:#0b1220; --txt:#e5e7eb; --muted:#9aa4b2; --card:#111827; --line:#ffffff22;
         --ok:#16a34a; --danger:#ef4444 }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt)}
  body.light{background:#ffffff;color:#0b1220}
  body.light .card{background:#fff;border-color:#00000018}
  body.light .muted{color:#667085}
  .wrap{position:relative;z-index:1;max-width:900px;margin:0 auto;padding:18px}
  .top{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:10px}
  .pill{padding:8px 10px;border-radius:999px;background:#ffffff18;border:1px solid #ffffff28;color:inherit;text-decoration:none}
  body.light .pill{background:#00000010;border-color:#00000018}
  .btn{display:inline-block;background:var(--ok);color:#fff;text-decoration:none;padding:12px 14px;border-radius:10px;border:0;cursor:pointer}
  .btn.red{background:var(--danger)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .input,textarea,select{width:100%;padding:12px;border-radius:10px;background:#0f172a;color:#fff;border:1px solid #293245}
  body.light .input, body.light textarea, body.light select{background:#fff;color:#0b1220;border-color:#00000022}
  textarea{min-height:120px}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .muted{color:var(--muted)}
  .preview{width:260px;aspect-ratio:1;object-fit:cover;border-radius:10px;border:1px solid #ffffff22;background:#0f172a}
  .hint{font-size:12px;opacity:.85}
  @media(max-width:760px){ .grid{grid-template-columns:1fr} .preview{width:100%} }
</style>
<body>
  <main class="wrap">
    <div class="top">
      <a class="pill" href="/admin/products">← Volver a Productos</a>
      <div style="display:flex;gap:8px">
        <a class="pill" href="/admin">Admin</a>
        <button id="modeBtn" class="pill" type="button">🌙</button>
      </div>
    </div>

    <h2 style="margin:6px 0">${p.id?'Editar':'Nuevo'} producto</h2>
    <form method="post" action="/admin/products/new">
      <input type="hidden" name="id" value="${p.id}">
      <input type="hidden" id="image_b64" name="image_b64">
      <section class="card">
        <div class="grid">
          <div>
            <label>Nombre</label>
            <input class="input" name="name" required value="${p.name}">
          </div>
          <div>
            <label>Estado</label>
            <select class="input" name="active">
              <option value="1" ${p.active? "selected":""}>Activo</option>
              <option value="0" ${!p.active? "selected":""}>Oculto</option>
            </select>
          </div>

          <div>
            <label>Precio</label>
            <input class="input" name="price" type="number" step="0.01" min="0.01" required value="${p.price}">
          </div>
          <div>
            <label>Moneda</label>
            <select class="input" name="currency">
              <option ${p.currency==='USD'?'selected':''} value="USD">USD</option>
              <option ${p.currency==='MXN'?'selected':''} value="MXN">MXN</option>
            </select>
          </div>

          <div>
            <label>Tipo de cobro</label>
            <select class="input" id="billing_type" name="billing_type">
              <option value="recurring" ${p.billing_type==='recurring'?'selected':''}>Recurrente (se renueva)</option>
              <option value="one_time"  ${p.billing_type==='one_time'?'selected':''}>Único (no se renueva)</option>
            </select>
            <div class="hint muted" id="bt_hint"></div>
          </div>

          <div id="period_wrap">
            <label>Periodo de facturación</label>
            <select class="input" id="period_minutes" name="period_minutes" required>
              <option ${p.period_minutes==3?'selected':''} value="3">TEST · 3 minutos</option>
              <option ${p.period_minutes==10080?'selected':''} value="10080">Semanal (1 semana)</option>
              <option ${p.period_minutes==21600?'selected':''} value="21600">15 días</option>
              <option ${p.period_minutes==43200?'selected':''} value="43200">Mensual (30 días)</option>
            </select>
          </div>

          <div>
            <label>Stock</label>
            <input class="input" name="stock" type="number" step="1" min="-1" value="${Number.isFinite(p.stock)?p.stock:-1}">
            <div class="hint muted">-1 = ilimitado · 0 = sin stock · >0 = unidades disponibles</div>
          </div>

          <div>
            <label>Imagen (sube archivo)</label>
            <input class="input" id="file" type="file" accept="image/*">
            <div class="muted">Se guardará como PNG (máx. ${MAX_IMAGE_MB}MB). Actual: ${p.image_path || "—"}</div>
          </div>
        </div>

        <div style="margin:12px 0" class="grid">
          <div>
            <label>Descripción (pública)</label>
            <textarea name="description" class="input" placeholder="Resumen visible del producto...">${p.description||""}</textarea>
          </div>
          <div>
            <label>Información que se revela al pagar</label>
            <textarea name="reveal_info" class="input" placeholder="Licencias, instrucciones, credenciales, etc.">${p.reveal_info||""}</textarea>
          </div>
        </div>

        <div class="row" style="justify-content:space-between">
          <img id="preview" class="preview" src="${p.image_path||''}" alt="">
          <div class="row">
            ${p.id ? `<button id="delBtn" class="btn red" type="button" data-id="${p.id}">Eliminar</button>` : ``}
            <button class="btn" type="submit">Guardar</button>
          </div>
        </div>
      </section>
    </form>
  </main>

<script>
  // Tema
  (function(){
    const btn=document.getElementById('modeBtn');
    function apply(mode){
      const light=(mode==='light');
      document.body.classList.toggle('light', light);
      btn.textContent = light ? '☀️' : '🌙';
      localStorage.setItem('ui:mode', light?'light':'dark');
    }
    apply(localStorage.getItem('ui:mode') || 'dark');
    btn.addEventListener('click', ()=>apply(document.body.classList.contains('light')?'dark':'light'));
  })();

  // Imagen -> base64 (previsualización)
  (function(){
    const file = document.getElementById('file');
    const out  = document.getElementById('image_b64');
    const prev = document.getElementById('preview');
    file?.addEventListener('change', ()=>{
      const f = file.files?.[0]; if(!f) return;
      const r = new FileReader();
      r.onload = ()=>{ out.value = String(r.result||''); prev.src = out.value; };
      r.readAsDataURL(f);
    });
  })();

  // Mostrar/ocultar periodo según tipo
  (function(){
    const typeSel = document.getElementById('billing_type');
    const wrap    = document.getElementById('period_wrap');
    const hint    = document.getElementById('bt_hint');
    const pmSel   = document.getElementById('period_minutes');

    function apply(){
      const one = typeSel.value === 'one_time';
      wrap.style.display = one ? 'none' : 'block';
      pmSel.disabled = one;
      hint.textContent = one
        ? 'Este producto se paga una sola vez. No se generarán renovaciones.'
        : 'Este producto generará facturas automáticamente según el período.';
      if (one) {
        const opt = document.createElement('option');
        opt.value = '0'; opt.selected = true; opt.hidden = true;
        pmSel.appendChild(opt);
      }else{
        const zero = [...pmSel.options].find(o=>o.value==='0');
        if (zero) zero.remove();
      }
    }
    apply();
    typeSel.addEventListener('change', apply);
  })();

  // Eliminar desde la pantalla de edición
  (function(){
    const delBtn = document.getElementById('delBtn');
    if (!delBtn) return;
    delBtn.addEventListener('click', async ()=>{
      const id = delBtn.getAttribute('data-id');
      if(!id) return;
      if(!confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) return;
      delBtn.disabled = true;
      try{
        const r = await fetch('/admin/products/'+id, { method:'DELETE' });
        const t = await r.text();
        if (t !== 'OK'){ alert(t); delBtn.disabled=false; return; }
        location.href='/admin/products';
      }catch(err){ alert('Error: '+err.message); delBtn.disabled=false; }
    });
  })();
</script>
</body>
</html>`);
});

/* ========= POST crear/editar ========= */
router.post("/new", ensureAdmin, parseLarge, (req,res)=>{
  ensureSchema();
  const id = Number(req.body?.id||0);
  const name = String(req.body?.name||"").trim();
  const description = String(req.body?.description||"").trim();
  const reveal_info = String(req.body?.reveal_info||"").trim();
  const price = Number(req.body?.price||0);
  const currency = String(req.body?.currency||"USD").toUpperCase()==="MXN" ? "MXN" : "USD";
  const billing_type = (String(req.body?.billing_type||"recurring")==="one_time") ? "one_time" : "recurring";
  const input_period = parseInt(req.body?.period_minutes||43200,10);
  const period_minutes = billing_type === "one_time" ? 0 : Math.max(3, input_period);
  const stockRaw = parseInt(req.body?.stock ?? "-1", 10);
  const stock = Number.isFinite(stockRaw) ? Math.max(-1, stockRaw) : -1; // -1 ilimitado
  const active = Number(req.body?.active||1) ? 1 : 0;
  const b64 = String(req.body?.image_b64||"");
  const now = new Date().toISOString();

  if (!name || !(price>0)) return res.status(400).send("Datos inválidos");

  if (id){
    db.prepare(`UPDATE products
                SET name=?,description=?,reveal_info=?,price=?,currency=?,period_minutes=?,billing_type=?,stock=?,active=?
                WHERE id=?`)
      .run(name, description, reveal_info, price, currency, period_minutes, billing_type, stock, active, id);
  }else{
    db.prepare(`INSERT INTO products
                (name,description,reveal_info,price,currency,period_minutes,billing_type,stock,active,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(name, description, reveal_info, price, currency, period_minutes, billing_type, stock, active, now);
  }
  const pid = id || db.prepare(`SELECT last_insert_rowid() AS id`).get().id;

  // guardar imagen si llegó base64 (con validación de 15 MB reales)
  if (b64.startsWith("data:image/")){
    const raw = b64.split(",")[1] || "";
    const bytes = Buffer.byteLength(raw, "base64");
    const maxBytes = MAX_IMAGE_MB * 1024 * 1024;
    if (bytes > maxBytes){
      return res.status(413).send(`La imagen supera ${MAX_IMAGE_MB}MB (${(bytes/1024/1024).toFixed(1)}MB).`);
    }
    const dir = path.join(process.cwd(),"uploads","products");
    try{ fs.mkdirSync(dir,{recursive:true}); }catch{}
    const fpath = path.join(dir, `${pid}.png`);
    fs.writeFileSync(fpath, Buffer.from(raw,"base64"));
    const image_path = `/uploads/products/${pid}.png`;
    db.prepare(`UPDATE products SET image_path=? WHERE id=?`).run(image_path, pid);
  }

  res.redirect("/admin/products");
});

/* ========= DELETE producto ========= */
router.delete("/:id", ensureAdmin, (req,res)=>{
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).send("Falta id");

  try{
    const p = db.prepare(`SELECT image_path FROM products WHERE id=?`).get(id);
    if (!p) return res.status(404).send("Producto no encontrado");

    const tx = db.transaction(()=>{
      db.prepare(`DELETE FROM products WHERE id=?`).run(id);
    });
    tx();

    // Borra imagen si es la por defecto /uploads/products/{id}.png
    if (p.image_path && /^\/uploads\/products\/\d+\.png$/.test(p.image_path)){
      const abs = path.join(process.cwd(), p.image_path.replace(/^\//,""));
      try{ if (fs.existsSync(abs)) fs.unlinkSync(abs); }catch{}
    }

    res.send("OK");
  }catch(e){
    res.status(500).send("ERR: " + (e?.message || "delete"));
  }
});

module.exports = router;
