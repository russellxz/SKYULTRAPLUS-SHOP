// admin_products.js — Admin: lista, creación/edición y eliminación de productos
"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const db = require("./db");

const router = express.Router();

/* ========= helpers ========= */
function ensureAdmin(req,res,next){
  const u = req.session && req.session.user;
  if (!u) return res.redirect("/login");
  if (!u.is_admin) return res.redirect("/");
  next();
}

function ensureSchema(){
  // products (con period_minutes, reveal_info y created_at)
  db.prepare(`CREATE TABLE IF NOT EXISTS products(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    reveal_info TEXT DEFAULT '',
    price REAL NOT NULL,
    currency TEXT NOT NULL CHECK(currency IN ('USD','MXN')),
    image_path TEXT DEFAULT '',
    period_minutes INTEGER NOT NULL DEFAULT 43200, -- 30 días
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`).run();

  // Migraciones defensivas por si venía de otra versión
  try{ db.prepare(`ALTER TABLE products ADD COLUMN reveal_info TEXT DEFAULT ''`).run(); }catch{}
  try{ db.prepare(`ALTER TABLE products ADD COLUMN period_minutes INTEGER NOT NULL DEFAULT 43200`).run(); }catch{}
  try{ db.prepare(`ALTER TABLE products ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))`).run(); }catch{}

  // services (para renovaciones)
  db.prepare(`CREATE TABLE IF NOT EXISTS services(
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    period_minutes INTEGER NOT NULL,
    next_invoice_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    UNIQUE(user_id, product_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  )`).run();
}
ensureSchema();

/* ========= UI: lista ========= */
/* Este router se monta en /admin/products (index.js: app.use("/admin/products", require("./admin_products")) ) */
router.get("/", ensureAdmin, (req,res)=>{
  const site = db.getSetting("site_name","SkyShop");
  const rows = db.prepare(`SELECT id,name,price,currency,active FROM products ORDER BY id DESC LIMIT 200`).all();
  const items = rows.map(p=>`
    <tr data-id="${p.id}">
      <td>${p.id}</td>
      <td>${p.name}</td>
      <td>${p.currency} ${Number(p.price).toFixed(2)}</td>
      <td><span class="tag ${p.active? 'ok':'mut'}">${p.active? 'Activo' : 'Oculto'}</span></td>
      <td class="right">
        <a class="btn blue" href="/admin/products/new?id=${p.id}">Editar</a>
        <button class="btn red" data-del="${p.id}">Eliminar</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="5" class="muted">Sin productos.</td></tr>`;

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

  .sky{position:fixed;inset:0;pointer-events:none;z-index:0}
  .star{position:absolute;width:2px;height:2px;background:#fff;border-radius:50%;opacity:.9;animation:twinkle 3s linear infinite}
  .shoot{position:absolute;width:140px;height:2px;background:linear-gradient(90deg,#fff,transparent);transform:rotate(18deg);filter:drop-shadow(0 0 6px #ffffff55);animation:shoot 5.5s linear infinite}
  @keyframes twinkle{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
  @keyframes shoot{0%{transform:translate(-10vw,-10vh) rotate(18deg)}100%{transform:translate(110vw,110vh) rotate(18deg)}}

  .icons{position:fixed;inset:0;z-index:0;pointer-events:none;display:none}
  body.light .icons{display:block}
  .icons span{position:absolute;font-size:34px;opacity:.24;animation:floatUp linear infinite}
  @keyframes floatUp{0%{transform:translateY(20vh);opacity:0}10%{opacity:.24}90%{opacity:.24}100%{transform:translateY(-30vh);opacity:0}}

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
  @media(max-width:720px){
    .title{flex-direction:column;align-items:stretch}
    .right{justify-content:flex-start}
  }
</style>
<body>
  <div class="sky" id="sky"></div>
  <div class="icons" id="icons"></div>

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
        <thead><tr><th>ID</th><th>Nombre</th><th>Precio</th><th>Estado</th><th class="right">Acciones</th></tr></thead>
        <tbody id="tbody">${items}</tbody>
      </table>
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
    for(let i=0;i<26;i++){
      const sp=document.createElement('span');
      sp.textContent=set[i%set.length];
      sp.style.left=(Math.random()*100).toFixed(2)+'%';
      sp.style.top=(Math.random()*100).toFixed(2)+'%';
      sp.style.animationDuration=(20+Math.random()*18).toFixed(1)+'s';
      sp.style.animationDelay=(Math.random()*8).toFixed(1)+'s';
      icons.appendChild(sp);
    }
  })();

  // Tema
  (function(){
    const btn=document.getElementById('modeBtn');
    function apply(mode){
      const light=(mode==='light');
      document.body.classList.toggle('light', light);
      document.getElementById('sky').style.display = light ? 'none' : 'block';
      document.getElementById('icons').style.display = light ? 'block' : 'none';
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
  if (!p) p = { id:0, name:"", description:"", reveal_info:"", price:"", currency:"USD", image_path:"", period_minutes:43200, active:1 };

  const sel = v => (p.currency===v ? "selected" : "");
  const selPeriod = m => (p.period_minutes==m ? "selected":"");

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

  .sky{position:fixed;inset:0;pointer-events:none;z-index:0}
  .star{position:absolute;width:2px;height:2px;background:#fff;border-radius:50%;opacity:.9;animation:twinkle 3s linear infinite}
  .shoot{position:absolute;width:140px;height:2px;background:linear-gradient(90deg,#fff,transparent);transform:rotate(18deg);filter:drop-shadow(0 0 6px #ffffff55);animation:shoot 5.5s linear infinite}
  @keyframes twinkle{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
  @keyframes shoot{0%{transform:translate(-10vw,-10vh) rotate(18deg)}100%{transform:translate(110vw,110vh) rotate(18deg)}}

  .icons{position:fixed;inset:0;z-index:0;pointer-events:none;display:none}
  body.light .icons{display:block}
  .icons span{position:absolute;font-size:34px;opacity:.24;animation:floatUp linear infinite}
  @keyframes floatUp{0%{transform:translateY(20vh);opacity:0}10%{opacity:.24}90%{opacity:.24}100%{transform:translateY(-30vh);opacity:0}}

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
  @media(max-width:760px){ .grid{grid-template-columns:1fr} .preview{width:100%} }
</style>
<body>
  <div class="sky" id="sky"></div>
  <div class="icons" id="icons"></div>

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
            <input class="input" name="price" type="number" step="0.01" required value="${p.price}">
          </div>
          <div>
            <label>Moneda</label>
            <select class="input" name="currency">
              <option ${sel('USD')} value="USD">USD</option>
              <option ${sel('MXN')} value="MXN">MXN</option>
            </select>
          </div>
          <div>
            <label>Periodo de facturación</label>
            <select class="input" name="period_minutes" required>
              <option ${selPeriod(3)} value="3">TEST · 3 minutos</option>
              <option ${selPeriod(10080)} value="10080">Semanal (1 semana)</option>
              <option ${selPeriod(21600)} value="21600">15 días</option>
              <option ${selPeriod(43200)} value="43200">Mensual (30 días)</option>
            </select>
          </div>
          <div>
            <label>Imagen (sube archivo)</label>
            <input class="input" id="file" type="file" accept="image/*">
            <div class="muted">Se guardará como PNG. Actual: ${p.image_path || "—"}</div>
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
  // Animaciones
  (function(){
    const sky=document.getElementById('sky');
    for(let i=0;i<90;i++){
      const s=document.createElement('div'); s.className='star';
      s.style.top=(Math.random()*100).toFixed(2)+'%';
      s.style.left=(Math.random()*100).toFixed(2)+'%';
      s.style.opacity=(0.35+Math.random()*0.65).toFixed(2);
      s.style.transform='scale('+(0.6+Math.random()*1.6).toFixed(2)+')';
      s.style.animationDelay=(Math.random()*3).toFixed(2)+'s';
      sky.appendChild(s);
    }
    for(let i=0;i<3;i++){
      const sh=document.createElement('div'); sh.className='shoot';
      sh.style.top=(Math.random()*25).toFixed(2)+'%';
      sh.style.left=(Math.random()*60).toFixed(2)+'%';
      sh.style.animationDelay=(1+Math.random()*5).toFixed(2)+'s';
      sky.appendChild(sh);
    }
    const icons=document.getElementById('icons');
    const set=['🎵','🎬','🎮','📷','🎧','📱','💾','🛒','📺','📀','💡','🚀'];
    for(let i=0;i<26;i++){
      const sp=document.createElement('span');
      sp.textContent=set[i%set.length];
      sp.style.left=(Math.random()*100).toFixed(2)+'%';
      sp.style.top=(Math.random()*100).toFixed(2)+'%';
      sp.style.animationDuration=(20+Math.random()*18).toFixed(1)+'s';
      sp.style.animationDelay=(Math.random()*8).toFixed(1)+'s';
      icons.appendChild(sp);
    }
  })();

  // Tema
  (function(){
    const btn=document.getElementById('modeBtn');
    function apply(mode){
      const light=(mode==='light');
      document.body.classList.toggle('light', light);
      document.getElementById('sky').style.display = light ? 'none' : 'block';
      document.getElementById('icons').style.display = light ? 'block' : 'none';
      btn.textContent = light ? '☀️' : '🌙';
      localStorage.setItem('ui:mode', light?'light':'dark');
    }
    apply(localStorage.getItem('ui:mode') || 'dark');
    btn.addEventListener('click', ()=>apply(document.body.classList.contains('light')?'dark':'light'));
  })();

  // Imagen -> base64
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
router.post("/new", ensureAdmin, (req,res)=>{
  ensureSchema();
  const id = Number(req.body?.id||0);
  const name = String(req.body?.name||"").trim();
  const description = String(req.body?.description||"").trim();
  const reveal_info = String(req.body?.reveal_info||"").trim();
  const price = Number(req.body?.price||0);
  const currency = String(req.body?.currency||"USD").toUpperCase()==="MXN" ? "MXN" : "USD";
  const period_minutes = Math.max(3, parseInt(req.body?.period_minutes||43200,10));
  const active = Number(req.body?.active||1) ? 1 : 0;
  const b64 = String(req.body?.image_b64||"");
  const now = new Date().toISOString();

  if (!name || !(price>0)) return res.status(400).send("Datos inválidos");

  if (id){
    db.prepare(`UPDATE products
                SET name=?,description=?,reveal_info=?,price=?,currency=?,period_minutes=?,active=?
                WHERE id=?`)
      .run(name, description, reveal_info, price, currency, period_minutes, active, id);
  }else{
    db.prepare(`INSERT INTO products
                (name,description,reveal_info,price,currency,period_minutes,active,created_at)
                VALUES(?,?,?,?,?,?,?,?)`)
      .run(name, description, reveal_info, price, currency, period_minutes, active, now);
  }
  const pid = id || db.prepare(`SELECT last_insert_rowid() AS id`).get().id;

  // guardar imagen si llegó base64
  if (b64.startsWith("data:image/")){
    const dir = path.join(process.cwd(),"uploads","products");
    try{ fs.mkdirSync(dir,{recursive:true}); }catch{}
    const fpath = path.join(dir, `${pid}.png`);
    const data = b64.split(",")[1];
    fs.writeFileSync(fpath, Buffer.from(data,"base64"));
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