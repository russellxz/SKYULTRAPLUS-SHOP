// invoices.js — Mis facturas (lista + pagar + PDF + confirm) con light/dark + drawer + quick + perfil + selector PayPal
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const db = require("./db");

const router = express.Router();

/* ===== helpers ===== */
function ensureAuth(req,res,next){
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}
function esc(s){ return String(s==null?'':s); }
function fmtAmount(v,c){ const n=Number(v||0); return c==="USD"?`$ ${n.toFixed(2)}`:`MXN ${n.toFixed(2)}`; }
function fmtDate(iso){ try{ return new Date(iso).toLocaleString(); }catch{ return iso||''; } }
function baseUrl(req){
  const proto = (req.headers["x-forwarded-proto"]||"").split(",")[0] || (req.secure?"https":"http");
  const host  = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

/* ==== util: siguiente número de factura (fallback) ==== */
function nextInvoiceNumber() {
  if (typeof db.nextInvoiceNumber === "function") {
    return db.nextInvoiceNumber();
  }
  const now = new Date();
  const ym = now.toISOString().slice(0,7).replace("-","");
  const seq = db.transaction(()=>{
    db.prepare(`INSERT OR IGNORE INTO settings(key,value) VALUES('invoice_seq','0')`).run();
    db.prepare(`UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key='invoice_seq'`).run();
    const r = db.prepare(`SELECT value FROM settings WHERE key='invoice_seq'`).get();
    return parseInt(r.value,10) || 1;
  })();
  return `INV-${ym}-${String(seq).padStart(4,"0")}`;
}

/* ==== util: PDF de factura ==== */
async function createInvoicePDF(inv, user, product, site, logoUrl){
  const number = inv.number || `INV-${inv.id}`;
  const dir = path.join(process.cwd(), "uploads", "invoices");
  try { fs.mkdirSync(dir, { recursive:true }); } catch {}
  const outFile = path.join(dir, `${number}.pdf`);

  const doc = new PDFDocument({ size:"A4", margin:36 });
  const stream = fs.createWriteStream(outFile);
  doc.pipe(stream);

  // Encabezado
  doc.rect(0,0,doc.page.width,90).fill("#0b1220");
  try{
    if (logoUrl && /^\/uploads\//.test(logoUrl)) {
      const absLogo = path.join(process.cwd(), logoUrl.replace(/^\//,""));
      if (fs.existsSync(absLogo)) doc.image(absLogo, 36, 18, { height:54 });
    }
  }catch{}
  doc.fillColor("#fff").fontSize(20).text(site, 0, 24, { align:"right" });
  doc.fontSize(11).text(`Factura: ${number}`, 0, 48, { align:"right" });
  doc.text(`Fecha: ${fmtDate(inv.created_at || inv.paid_at)}`, 0, 64, { align:"right" });

  const paid = (inv.status === "paid");
  doc.save();
  doc.roundedRect(36,100,120,24,8).fill(paid ? "#16a34a" : "#f59e0b");
  doc.fillColor("#fff").fontSize(12).text(paid?"PAGADO":"PENDIENTE",36,104,{width:120,align:"center"});
  doc.restore();

  doc.moveDown(2);
  doc.fillColor("#111827").fontSize(16).text("Cliente");
  doc.fillColor("#374151").fontSize(11);
  doc.text(`Nombre: ${user.name} ${user.surname}`);
  doc.text(`Usuario: @${user.username}`);
  doc.text(`Correo: ${user.email}`);
  doc.text(`Teléfono: ${user.phone || "—"}`);

  doc.moveDown(1);
  doc.fillColor("#111827").fontSize(16).text("Detalle");
  doc.fillColor("#374151").fontSize(11);
  doc.text(`Producto: ${product?.name || "—"}`);
  doc.text(`Descripción: ${product?.description || "—"}`);
  if (inv.cycle_end_at) doc.text(`Próximo ciclo: ${fmtDate(inv.cycle_end_at)}`);

  doc.moveDown(1);
  doc.fillColor("#111827").fontSize(16).text("Resumen");
  doc.fillColor("#0b1220").fontSize(13);
  doc.text(`Total: ${inv.currency} ${Number(inv.amount).toFixed(2)}`);

  doc.end();
  await new Promise((res,rej)=>{ stream.on("finish",res); stream.on("error",rej); });

  return `/uploads/invoices/${number}.pdf`;
}

/* ========== FULFILLMENT idempotente (activa servicio si está pagada) ========== */
function fulfillPaidInvoice(invoiceId, userId) {
  const inv = db
    .prepare(
      `SELECT i.*, p.name AS p_name, p.description AS p_desc, p.reveal_info, p.period_minutes, p.image_path
       FROM invoices i
       JOIN products p ON p.id = i.product_id
       WHERE i.id = ? AND i.user_id = ?`
    )
    .get(invoiceId, userId);

  if (!inv) return { ok: false, error: "Factura no encontrada" };

  if (inv.status !== "paid") {
    return { ok: true, pending: true, inv, product: inv };
  }

  const paidAt = inv.paid_at ? new Date(inv.paid_at) : new Date();
  const cycleEnd =
    inv.cycle_end_at ||
    new Date(paidAt.getTime() + (inv.period_minutes || 43200) * 60 * 1000).toISOString();

  db.transaction(() => {
    const exist = db
      .prepare(`SELECT * FROM services WHERE user_id=? AND product_id=?`)
      .get(userId, inv.product_id);
    if (!exist) {
      db.prepare(
        `INSERT INTO services(user_id,product_id,period_minutes,next_invoice_at,status)
         VALUES(?,?,?,?, 'active')`
      ).run(userId, inv.product_id, inv.period_minutes, cycleEnd);
    } else {
      db.prepare(
        `UPDATE services
           SET period_minutes=?, next_invoice_at=?, status='active'
         WHERE id=?`
      ).run(inv.period_minutes, cycleEnd, exist.id);
    }

    db.prepare(
      `UPDATE invoices
         SET cycle_end_at = COALESCE(cycle_end_at, ?)
       WHERE id=?`
    ).run(cycleEnd, inv.id);
  })();

  return {
    ok: true,
    pending: false,
    inv: { ...inv, cycle_end_at: inv.cycle_end_at || cycleEnd },
    product: inv,
  };
}

/* ====== UI LISTADO ====== */
router.get("/", ensureAuth, (req,res)=>{
  const site = db.getSetting("site_name","SkyShop");
  const logo = db.getSetting("logo_url","");
  const u = req.session.user;
  const isAdmin = !!u.is_admin;

  // Avatar
  const avatarUrl = (u.avatar_url || "").trim();
  const avatarLetter = String(u.name||"?").charAt(0).toUpperCase();
  const avatarHtml = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="avatar">` : `${avatarLetter}`;

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${site} · Mis facturas</title>
<style>
  :root{
    --bg:#0b1220; --txt:#e5e7eb; --muted:#9ca3af; --card:#111827; --line:#ffffff15;
    --accent:#f43f5e; --accent2:#fb7185;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt);min-height:100vh;overflow-x:hidden}

  /* Cielo oscuro */
  .sky{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}
  .star{position:absolute;width:2px;height:2px;background:#fff;border-radius:50%;opacity:.9;animation:twinkle 3s linear infinite}
  .shoot{position:absolute;width:140px;height:2px;background:linear-gradient(90deg,#fff,transparent);transform:rotate(18deg);filter:drop-shadow(0 0 6px #ffffff55);animation:shoot 5.5s linear infinite}
  @keyframes twinkle{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
  @keyframes shoot{0%{transform:translate(-10vw,-10vh) rotate(18deg)}100%{transform:translate(110vw,110vh) rotate(18deg)}}

  /* Modo claro */
  body.light{background:#fff;color:#0b1220}
  .icons{position:fixed;inset:0;z-index:0;pointer-events:none;display:none}
  body.light .icons{display:block}
  .icons span{position:absolute;font-size:34px;opacity:.24;animation:floatUp linear infinite;filter:saturate(120%) drop-shadow(0 0 1px #00000010)}
  @media(min-width:900px){.icons span{font-size:40px}}
  @keyframes floatUp{0%{transform:translateY(20vh);opacity:.0}10%{opacity:.24}90%{opacity:.24}100%{transform:translateY(-30vh);opacity:.0}}

  /* Top + brand + quick + avatar */
  .top{position:sticky;top:0;z-index:6;backdrop-filter:blur(8px);background:linear-gradient(#0b1220cc,#0b1220aa);border-bottom:1px solid var(--line)}
  body.light .top{background:linear-gradient(#fff8,#fff6)}
  .nav{max-width:1100px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px}
  .brand{display:flex;align-items:center;gap:10px}
  .brand img{width:36px;height:36px;border-radius:8px;object-fit:cover;display:${logo?'block':'none'}}
  .brand-name{font-weight:900;letter-spacing:.2px;font-size:18px;background:linear-gradient(90deg,#ffffff,#ef4444);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
  body.light .brand-name{background:linear-gradient(90deg,#111111,#ef4444);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
  .quick{display:flex;gap:8px;margin-left:6px}
  .qbtn{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;text-decoration:none;font-weight:700;background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff;border:1px solid #ffffff22}
  .qbtn svg{width:16px;height:16px}

  .grow{flex:1}
  .pill{padding:8px 12px;border-radius:999px;background:#ffffff18;border:1px solid #ffffff28;color:inherit;text-decoration:none;cursor:pointer}
  body.light .pill{background:#00000010;border-color:#00000018}

  .avatar{ width:32px;height:32px;border-radius:50%;background:#64748b;color:#fff;display:grid;place-items:center;font-weight:700;overflow:hidden }
  .avatar img{width:100%;height:100%;object-fit:cover;display:block}

  /* Drawer */
  .burger{width:40px;height:40px;display:grid;place-items:center;border-radius:10px;border:1px solid #334155;background:transparent;cursor:pointer}
  .burger span{width:20px;height:2px;background:currentColor;position:relative;display:block}
  .burger span:before,.burger span:after{content:"";position:absolute;left:0;right:0;height:2px;background:currentColor}
  .burger span:before{top:-6px}.burger span:after{top:6px}
  .drawer{position:fixed;inset:0 auto 0 0;width:300px;transform:translateX(-100%);transition:transform .22s ease;z-index:7}
  .drawer.open{transform:none}
  .drawer .panel{height:100%;background:rgba(17,25,40,.85);backdrop-filter:blur(10px);border-right:1px solid var(--line);padding:14px}
  body.light .drawer .panel{background:#fff}
  .scrim{position:fixed;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(1px);opacity:0;visibility:hidden;transition:.18s ease;z-index:6}
  .scrim.show{opacity:1;visibility:visible}
  .navlist a{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #334155;border-radius:10px;margin-bottom:8px;color:inherit;text-decoration:none}
  .navlist a:hover{border-color:#64748b}
  .navlist svg{width:18px;height:18px;opacity:.95}

  /* Dropdown user */
  .udrop{ position:absolute; right:16px; top:60px; background:var(--card); border:1px solid var(--line); border-radius:12px;
          padding:10px; width:230px; box-shadow:0 10px 30px #0007; display:none; z-index:9 }
  body.light .udrop{ background:#fff; }
  .udrop a{ display:block; padding:8px 10px; border-radius:8px; color:inherit; text-decoration:none; }
  .udrop a:hover{ background:#ffffff12 } body.light .udrop a:hover{ background:#0000000a }

  /* Content */
  .wrap{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:18px 16px 60px}
  h1{margin:10px 0 6px}
  .muted{color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px}
  body.light .card{background:#fff}
  .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
  .input,select{padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:#e5e7eb}
  body.light .input, body.light select{background:#fff;border-color:#00000022;color:#0b1220}
  table{width:100%;border-collapse:separate;border-spacing:0}
  th,td{padding:12px;border-bottom:1px solid var(--line);text-align:left}
  .right{text-align:right}
  .badge{display:inline-block;padding:4px 8px;border-radius:999px;border:1px solid #ffffff24;background:#0b1325;color:#cbd5e1;font-size:12px}
  body.light .badge{background:#f8fafc;color:#0b1220;border-color:#00000018}
  .tag-ok{color:#10b981;border-color:#10b98133;background:#10b98114}
  .tag-warn{color:#f59e0b;border-color:#f59e0b33;background:#f59e0b14}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;color:#fff;text-decoration:none;background:linear-gradient(90deg,var(--accent),var(--accent2))}
  .btn.ghost{background:transparent;color:inherit;border:1px solid #334155}
  .btn[disabled]{opacity:.5;pointer-events:none}
</style>
<body>
  <div class="sky" id="sky"></div>
  <div class="icons" id="icons"></div>

  <!-- Drawer -->
  <div class="drawer" id="drawer">
    <div class="panel">
      <h3 style="margin:0 0 10px">Menú</h3>
      <nav class="navlist">
        <a href="/"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3 1 8h2v5h4V9h2v4h4V8h2L8 3z"/></svg>Inicio</a>
        <a href="/invoices"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>Mis facturas</a>
        <a href="/services"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>Mis servicios</a>
        <a href="/tickets"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0-1 1 1 1 0 0 0 1 1v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a1 1 0 0 0 1-1 1 1 0 0 0-1-1V5Z"/></svg>Soporte</a>
        <a href="/profile"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7v-1a5 5 0 0 1 10 0v1H3z"/></svg>Mi perfil</a>
        ${isAdmin ? `<a href="/admin"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M7 1h2l1 3h3l-2 2 1 3-3-1-2 2-2-2-3 1 1-3L1 4h3l1-3z"/></svg>Admin</a>`:""}
        <a href="/logout"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h3v2H6v8h3v2H4V2h2zm7 6-3-3v2H7v2h3v2l3-3z"/></svg>Salir</a>
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>

  <header class="top">
    <nav class="nav">
      <button id="menuBtn" class="burger" aria-label="Abrir menú"><span></span></button>
      <div class="brand">
        ${logo ? `<img src="${logo}" alt="logo">` : ``}
        <div class="brand-name">${site}</div>

        <!-- Accesos rápidos (como dashboard) -->
        <div class="quick">
          <a class="qbtn" href="/">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3 1 8h2v5h4V9h2v4h4V8h2L8 3z"/></svg>
            Inicio
          </a>
          <a class="qbtn" href="/invoices">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>
            Facturas
          </a>
          <a class="qbtn" href="/services">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>
            Servicios
          </a>
        </div>
      </div>

      <div class="grow"></div>
      <button id="mode" class="pill" type="button" aria-label="Cambiar tema">🌙</button>

      <div id="ua" class="pill" style="display:flex;gap:8px;align-items:center;position:relative;cursor:pointer">
        <div class="avatar">${avatarHtml}</div>
        <span>${esc(u.username||"")}</span>
        <div id="udrop" class="udrop">
          <div style="padding:6px 8px; font-weight:700">${esc(u.name||"")} ${esc(u.surname||"")}</div>
          <a href="/profile">Mi perfil</a>
          <a href="/invoices">Mis facturas</a>
          <a href="/services">Mis servicios</a>
          <a href="/tickets">Tickets</a>
          ${isAdmin ? `<a href="/admin">Administración</a>` : ``}
          <a href="/logout">Salir</a>
        </div>
      </div>
    </nav>
  </header>

  <main class="wrap">
    <h1>Mis facturas</h1>
    <div class="muted">Descarga tus facturas, págales y revisa su estado.</div>

    <section class="card" style="margin-top:12px">
      <div class="toolbar">
        <input id="q" class="input" placeholder="Buscar por número o producto…">
        <select id="st">
          <option value="">Todas</option>
          <option value="paid">Pagadas</option>
          <option value="unpaid">Pendientes</option>
        </select>
        <button id="refresh" class="pill" type="button">Actualizar</button>
      </div>

      <div class="tablewrap">
        <table id="tbl" aria-label="Listado de facturas">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Fecha</th>
              <th>Producto</th>
              <th>Total</th>
              <th>Estado</th>
              <th>Método</th>
              <th class="right">Acciones</th>
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="7" class="muted">Cargando…</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>

<script>
  // Drawer (abre/cierra)
  (function(){
    const drawer = document.getElementById('drawer');
    const scrim  = document.getElementById('scrim');
    const btn    = document.getElementById('menuBtn');
    function open(){ drawer.classList.add('open'); scrim.classList.add('show'); }
    function close(){ drawer.classList.remove('open'); scrim.classList.remove('show'); }
    btn?.addEventListener('click', open);
    scrim?.addEventListener('click', close);
    window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });
  })();

  // Dropdown usuario
  (function(){
    const a=document.getElementById('ua'), d=document.getElementById('udrop');
    let open=false;
    a?.addEventListener('click', (e)=>{ e.stopPropagation(); open=!open; d.style.display=open?'block':'none'; });
    document.addEventListener('click', ()=>{ if(open){ open=false; d.style.display='none'; }});
  })();

  // Estrellas (oscuro)
  ;(function(){
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
    for(let i=0;i<2;i++){
      const sh=document.createElement('div');
      sh.className='shoot';
      sh.style.top=(Math.random()*25).toFixed(2)+'%';
      sh.style.left=(Math.random()*60).toFixed(2)+'%';
      sh.style.animationDelay=(1+Math.random()*5).toFixed(2)+'s';
      sky.appendChild(sh);
    }
  })();

  // Emojis (claro)
  ;(function(){
    const icons=document.getElementById('icons');
    const set=['🎵','🎬','🎮','📷','🎧','📱','💾','🛒','📺','📀','💡','🚀'];
    for(let i=0;i<24;i++){
      const sp=document.createElement('span');
      sp.textContent=set[i%set.length];
      sp.style.left=(Math.random()*100).toFixed(2)+'%';
      sp.style.top=(Math.random()*100).toFixed(2)+'%';
      sp.style.animationDuration=(20+Math.random()*18).toFixed(1)+'s';
      sp.style.animationDelay=(Math.random()*8).toFixed(1)+'s';
      icons.appendChild(sp);
    }
  })();

  // Tema 🌙/☀️
  ;(function(){
    const btn=document.getElementById('mode');
    function apply(mode){
      const light=(mode==='light');
      document.body.classList.toggle('light',light);
      document.getElementById('sky').style.display=light?'none':'block';
      document.getElementById('icons').style.display=light?'block':'none';
      btn.textContent=light?'☀️':'🌙';
      localStorage.setItem('mode', light?'light':'dark');
    }
    apply(localStorage.getItem('mode')||'dark');
    btn.addEventListener('click',()=>apply(document.body.classList.contains('light')?'dark':'light'));
  })();

  // Cargar facturas
  ;(function(){
    const q   = document.getElementById('q');
    const st  = document.getElementById('st');
    const btn = document.getElementById('refresh');
    const tb  = document.getElementById('tbody');
    let t=null; function deb(fn,ms){ clearTimeout(t); t=setTimeout(fn,ms||220); }

    function h(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function fmtD(iso){ try{ return new Date(iso).toLocaleString(); }catch{ return iso||''; } }

    async function load(){
      try{
        const url = '/invoices/api?status='+encodeURIComponent(st.value||'')+'&q='+encodeURIComponent(q.value.trim());
        const r = await fetch(url, {cache:'no-store'});
        const data = await r.json();
        if (!Array.isArray(data)) throw new Error('Formato');
        if (!data.length){ tb.innerHTML='<tr><td colspan="7" class="muted">Sin resultados.</td></tr>'; return; }
        let html='';
        for(const it of data){
          const isPaid = it.status==='paid';
          const status = isPaid
            ? '<span class="badge tag-ok">Pagado</span>'
            : '<span class="badge tag-warn">Pendiente</span>';

          const pdfBtn = it.pdf_url
            ? '<a class="btn" href="'+h(it.pdf_url)+'" target="_blank" rel="noopener">PDF</a>'
            : '<button class="btn" disabled>PDF</button>';

          const payPageBtn = isPaid ? '' : '<a class="btn" href="/invoices/pay/'+it.id+'">Pagar</a>';

          html += '<tr>'
               +  '<td>'+h(it.number||('INV-'+it.id))+'</td>'
               +  '<td>'+h(fmtD(it.created_at))+'</td>'
               +  '<td>'+h(it.product_name||'—')+'</td>'
               +  '<td>'+h(it.currency)+' '+Number(it.amount||0).toFixed(2)+'</td>'
               +  '<td>'+status+'</td>'
               +  '<td><span class="badge">'+h(it.payment_method||'—')+'</span></td>'
               +  '<td class="right">'+ payPageBtn + (isPaid?'':' ') + ' ' + pdfBtn +'</td>'
               +  '</tr>';
        }
        tb.innerHTML = html;
      }catch(e){
        tb.innerHTML = '<tr><td colspan="7">Error cargando</td></tr>';
      }
    }

    q.addEventListener('input', ()=>deb(load, 200));
    st.addEventListener('change', load);
    btn.addEventListener('click', load);
    load();
  })();
</script>
</body>
</html>`);
});

/* ====== API LISTADO ====== */
router.get("/api", ensureAuth, (req,res)=>{
  const u = req.session.user;
  const status = String(req.query.status||"").toLowerCase().trim(); // '', 'paid', 'unpaid'
  const q = String(req.query.q||"").trim();

  const where = ["i.user_id = ?"];
  const args = [u.id];

  if (status === "paid"){
    where.push("i.status = 'paid'");
  } else if (status === "unpaid"){
    where.push("i.status IN ('pending','unpaid','overdue')");
  }
  if (q){
    where.push("(i.number LIKE ? OR p.name LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like);
  }

  const sql = `
    SELECT i.id, i.number, i.amount, i.currency, i.status, i.payment_method,
           i.created_at, i.external_id, p.name AS product_name
    FROM invoices i
    LEFT JOIN products p ON p.id = i.product_id
    WHERE ${where.join(" AND ")}
    ORDER BY datetime(i.created_at) DESC, i.id DESC
    LIMIT 200`;

  const rows = db.prepare(sql).all(...args)
    .map(r=>({
      id:r.id,
      number:r.number,
      amount:r.amount,
      currency:r.currency,
      status:r.status,
      payment_method:r.payment_method,
      created_at:r.created_at,
      product_name:r.product_name,
      pdf_url: r.external_id ? String(r.external_id) : ""
    }));

  res.json(rows);
});

/* ====== UI PAGO DE UNA FACTURA (opciones) ====== */
router.get("/pay/:id", ensureAuth, (req,res)=>{
  const site = db.getSetting("site_name","SkyShop");
  const logo = db.getSetting("logo_url","");
  const u = req.session.user;
  const id = Number(req.params.id||0);

  const inv = db.prepare(`
    SELECT i.*, p.name AS product_name, p.description AS product_description, p.image_path, p.id AS pid
    FROM invoices i
    LEFT JOIN products p ON p.id=i.product_id
    WHERE i.id=? AND i.user_id=? LIMIT 1
  `).get(id, u.id);
  if (!inv) return res.status(404).send("Factura no encontrada.");

  // recordar para retornos sin id
  try { req.session.last_invoice_id = inv.id; } catch {}

  // si ya está pagada → confirm
  if (inv.status === 'paid') {
    return res.redirect(302, `/invoices/confirm/${inv.id}`);
  }

  const balUSD = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='USD'`).get(u.id)?.balance || 0;
  const balMXN = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='MXN'`).get(u.id)?.balance || 0;
  const canPay = (inv.currency==='USD' ? balUSD : balMXN) >= inv.amount;

  // ===== flags PayPal + URLs =====
  const ppApiEnabled = db.getSetting("paypal_api_enabled","0")==="1"
                    && !!db.getSetting("paypal_api_client_id","")
                    && !!db.getSetting("paypal_api_secret","");
  const ppIpnEnabled = db.getSetting("paypal_ipn_enabled","0")==="1"
                    && !!db.getSetting("paypal_ipn_email","");
  const ppEmail = db.getSetting("paypal_ipn_email","");
  const ppModeLive = db.getSetting("paypal_api_mode","sandbox")==="live";
  const webscr = ppModeLive
    ? "https://www.paypal.com/cgi-bin/webscr"
    : "https://www.sandbox.paypal.com/cgi-bin/webscr";
  const base = baseUrl(req);
  const ipnNotify = `${base}/pay/paypal/ipn`;

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Pagar factura</title>
<style>
  :root{ --bg:#0b1220; --txt:#e5e7eb; --muted:#9aa4b2; --card:#111827; --line:#ffffff22; --accent:#2563eb }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:#e5e7eb}
  body.light{background:#fff;color:#0b1220}
  body.light .card{background:#fff;border-color:#00000018}
  body.light .muted{color:#667085}
  .wrap{max-width:900px;margin:0 auto;padding:18px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  .pill{padding:8px 10px;border-radius:999px;background:#ffffff18;border:1px solid #ffffff28;color:inherit;text-decoration:none}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:var(--accent);color:#fff;text-decoration:none;border:0;cursor:pointer}
  .btn[disabled]{opacity:.5;cursor:not-allowed}
  .alt{display:inline-flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:#ffffff10;color:inherit;text-decoration:none}

  /* Modal */
  .modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;place-items:center;z-index:30}
  .modal.show{display:grid}
  .panel{background:#0b1325;border:1px solid #ffffff22;border-radius:16px;max-width:520px;width:92%;padding:14px}
  body.light .panel{background:#fff;border-color:#00000018}
  .opt{display:flex;align-items:center;gap:10px;border:1px solid #ffffff22;border-radius:12px;padding:12px;margin:8px 0;cursor:pointer;background:#0f172a}
  body.light .opt{background:#f8fafc;border-color:#00000018}
  .opt small{opacity:.8}
</style>
<body>
  <main class="wrap">
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <a class="pill" href="/invoices">← Volver a facturas</a>
      <a class="pill" href="/">Dashboard</a>
    </div>

    <section class="card">
      <h2 style="margin:0 0 6px">Factura ${inv.number || ('INV-'+inv.id)}</h2>
      <div class="muted" style="margin-bottom:10px">Estado: Pendiente</div>

      <div class="row">
        <div style="flex:1">
          <div class="muted">Producto</div>
          <div style="font-weight:800">${esc(inv.product_name)||'—'}</div>
          <div class="muted">${esc(inv.product_description)||''}</div>
        </div>
        <div style="min-width:260px">
          <div class="muted">Total</div>
          <div style="font-size:22px;font-weight:900">${inv.currency} ${Number(inv.amount).toFixed(2)}</div>
          <div class="muted">Tu saldo ${inv.currency}: ${(inv.currency==='USD'?balUSD:balMXN).toFixed(2)}</div>
        </div>
      </div>

      <div class="row" style="margin-top:12px; gap:8px; align-items:center">

        <!-- Créditos -->
        <form method="post" action="/invoices/pay/${inv.id}/credits" style="display:inline">
          <button class="btn" type="submit" ${canPay?'':'disabled title="Saldo insuficiente"'}>Pagar con créditos</button>
        </form>

        <!-- Recargar créditos -->
        <a class="alt" href="/comprar-creditos?currency=${inv.currency}">Recargar créditos</a>

        <!-- PayPal (selector API/IPN) -->
        <button id="paypalBtn" class="alt" type="button">PayPal</button>

        <!-- Stripe -->
        <a class="alt" href="/pay/stripe?invoice_id=${inv.id}">Stripe</a>
      </div>
    </section>
  </main>

  <!-- PayPal API -->
  <form id="ppApiForm" method="post" action="/pay/paypal/api/create" style="display:none">
    <input type="hidden" name="invoice_id" value="${inv.id}">
  </form>

  <!-- PayPal IPN directo (webscr) — rm=1 => return por GET -->
  <form id="ppIpnForm" method="post" action="${webscr}" style="display:none">
    <input type="hidden" name="cmd" value="_xclick">
    <input type="hidden" name="business" value="${esc(ppEmail)}">
    <input type="hidden" name="item_name" value="${esc(inv.product_name || 'Producto')}">
    <input type="hidden" name="amount" value="${Number(inv.amount).toFixed(2)}">
    <input type="hidden" name="currency_code" value="${inv.currency}">
    <input type="hidden" name="invoice" value="">
    <input type="hidden" name="custom" value="">
    <input type="hidden" name="notify_url" value="">
    <input type="hidden" name="return" value="">
    <input type="hidden" name="cancel_return" value="">
    <input type="hidden" name="no_shipping" value="1">
    <input type="hidden" name="rm" value="1">
  </form>

  <!-- Modal opciones PayPal -->
  <div id="ppModal" class="modal" aria-hidden="true">
    <div class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px">
        <h3 style="margin:0">Elige cómo pagar con PayPal</h3>
        <button id="ppClose" class="pill" type="button">✕</button>
      </div>
      ${ppApiEnabled ? `
        <div class="opt" id="ppOptApi">
          <div>🧩</div>
          <div>
            <div><b>PayPal (API / Checkout)</b></div>
            <small>Redirección a PayPal y confirmación automática al volver.</small>
          </div>
        </div>` : ``}
      ${ppIpnEnabled ? `
        <div class="opt" id="ppOptIpn">
          <div>✉️</div>
          <div>
            <div><b>PayPal por correo (IPN)</b></div>
            <small>Pago directo al correo ${esc(ppEmail)}. La confirmación llega por IPN.</small>
          </div>
        </div>` : ``}
      ${(!ppApiEnabled && !ppIpnEnabled) ? `
        <div class="muted">PayPal no está configurado por el administrador.</div>` : ``}
    </div>
  </div>

<script>
  (function(){
    const btn = document.getElementById('paypalBtn');
    const apiForm = document.getElementById('ppApiForm');
    const ipnForm = document.getElementById('ppIpnForm');
    const m = document.getElementById('ppModal');
    const apiReady = ${ppApiEnabled ? 'true' : 'false'};
    const ipnReady = ${ppIpnEnabled ? 'true' : 'false'};
    const base = ${JSON.stringify(base)};
    const notify = ${JSON.stringify(ipnNotify)};
    const invId = ${inv.id};
    const invNumber = ${JSON.stringify(inv.number || '')};
    const itemName = ${JSON.stringify(inv.product_name || 'Producto')};

    function open(){ m.classList.add('show'); m.setAttribute('aria-hidden','false'); }
    function close(){ m.classList.remove('show'); m.setAttribute('aria-hidden','true'); }
    btn?.addEventListener('click', ()=>{
      if (!apiReady && !ipnReady) { alert('PayPal no está disponible.'); return; }
      if (apiReady && ipnReady) open();
      else if (apiReady) apiForm.submit();
      else startIPN();
    });
    document.getElementById('ppClose')?.addEventListener('click', close);
    m?.addEventListener('click', (e)=>{ if(e.target.id==='ppModal') close(); });
    document.getElementById('ppOptApi')?.addEventListener('click', ()=>{ apiForm.submit(); });
    document.getElementById('ppOptIpn')?.addEventListener('click', startIPN);
    window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });

    function startIPN(){
      try{
        // rellena el webscr directo como en product.js
        const f = ipnForm;
        const suffix = Date.now().toString(36);
        f.item_name.value = itemName;
        f.invoice.value = (invNumber || ('INV-' + String(invId))) + '-' + suffix;
        f.custom.value  = String(invId);                  // para que el IPN local identifique la factura
        f.notify_url.value = notify;                      // listener IPN
        f.return.value  = base + '/invoices/confirm/' + String(invId) + '?paid=paypal_ipn';
        f.cancel_return.value = base + '/invoices/confirm/' + String(invId) + '?canceled=1';
        f.submit();
      }catch(e){
        alert('Error iniciando PayPal: ' + e.message);
      }finally{
        close();
      }
    }
  })();
</script>
</body>
</html>`);
});

/* ====== POST PAGO CON CRÉDITOS (con fulfillment) ====== */
router.post("/pay/:id/credits", ensureAuth, async (req,res)=>{
  const u = req.session.user;
  const id = Number(req.params.id||0);

  const inv = db.prepare(`SELECT * FROM invoices WHERE id=? AND user_id=?`).get(id,u.id);
  if (!inv) return res.status(404).send("Factura no encontrada.");
  if (inv.status === "paid") return res.redirect(`/invoices/confirm/${id}`);

  const cur = inv.currency;
  const bal = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency=?`).get(u.id, cur)?.balance || 0;
  if (bal < inv.amount) return res.status(400).send("Saldo insuficiente.");

  // Traemos producto (para PDF) y user info
  const product = inv.product_id ? db.prepare(`SELECT * FROM products WHERE id=?`).get(inv.product_id) : null;
  const user = db.prepare(`SELECT id,username,name,surname,email,phone FROM users WHERE id=?`).get(u.id);
  const site = db.getSetting("site_name","SkyShop");
  const logo = db.getSetting("logo_url","");

  // Pagar
  const now = new Date().toISOString();
  const number = inv.number || nextInvoiceNumber();

  const txRes = db.transaction(()=>{
    db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`).run(u.id, cur);
    db.prepare(`UPDATE credits SET balance=balance-? WHERE user_id=? AND currency=?`).run(inv.amount, u.id, cur);
    db.prepare(`UPDATE invoices SET number=?, status='paid', payment_method='credits', paid_at=? WHERE id=?`)
      .run(number, now, id);
    return db.prepare(`SELECT * FROM invoices WHERE id=?`).get(id);
  })();

  // Fulfillment idempotente
  fulfillPaidInvoice(id, u.id);

  // PDF si falta
  let pdfUrl = txRes.external_id;
  try{
    if (!pdfUrl){
      const url = await createInvoicePDF(
        { ...txRes, status: "paid" },
        user,
        product,
        site,
        logo
      );
      db.prepare(`UPDATE invoices SET external_id=? WHERE id=?`).run(url, id);
      pdfUrl = url;
    }
  }catch(e){ console.error("PDF error:", e); }

  res.redirect(`/invoices/confirm/${id}`);
});

/* ====== CONFIRM / SUCCESS (PayPal API/IPN, Stripe y Créditos) ====== */
router.get("/confirm/:id", ensureAuth, async (req, res) => {
  const site = db.getSetting("site_name","SkyShop");
  const logo = db.getSetting("logo_url","");
  const u = req.session.user;
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).send("Factura inválida");

  const result = fulfillPaidInvoice(id, u.id);
  if (!result.ok) {
    if (req.query.json === "1") return res.json({ ok:false, error: result.error||"Error" });
    return res.status(404).send(result.error || "Error");
  }

  // JSON (polling)
  if (req.query.json === "1") {
    return res.json({
      ok: true,
      pending: !!result.pending,
      invoice_id: id,
      status: result.pending ? "pending" : "paid"
    });
  }

  // Espera si aún está pendiente
  if (result.pending) {
    return res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Confirmación pendiente</title>
<style>
  :root{ --bg:#0b1220; --txt:#e5e7eb; --card:#111827; --line:#ffffff22 }
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt)}
  .wrap{max-width:760px;margin:0 auto;padding:20px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
  .btn{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 12px;border-radius:10px}
  .muted{opacity:.8}
</style>
<body><main class="wrap">
  <section class="card">
    <h2>Esperando confirmación de PayPal…</h2>
    <p class="muted">Esto suele tardar unos segundos. No cierres esta ventana.</p>
    <a class="btn" href="/">Volver al panel</a>
  </section>
</main>
<script>
  (function(){
    const started = Date.now();
    const maxMs = 5*60*1000;
    async function tick(){
      try{
        const r = await fetch(location.pathname + '?json=1', { credentials:'same-origin' });
        const j = await r.json();
        if (j && j.ok && !j.pending){
          location.replace(location.pathname);
          return;
        }
      }catch(e){}
      if (Date.now() - started < maxMs){
        setTimeout(tick, 3000);
      }
    }
    setTimeout(tick, 1500);
  })();
</script>
</body></html>`);
  }

  const inv = result.inv;
  const user = db
    .prepare(`SELECT id,username,name,surname,email,phone FROM users WHERE id=?`)
    .get(u.id);

  // Genera PDF si falta
  let pdfRel = inv.external_id;
  try {
    if (!pdfRel || !/^\/uploads\/invoices\/.+\.pdf$/.test(pdfRel)) {
      await createInvoicePDF({
        number: inv.number,
        site,
        logoUrl: logo,
        user,
        product: {
          name: inv.p_name,
          description: inv.p_desc,
          period_minutes: inv.period_minutes,
        },
        amount: inv.amount,
        currency: inv.currency,
        createdAt: inv.paid_at || inv.created_at,
        cycleEnd: inv.cycle_end_at,
      });
      pdfRel = `/uploads/invoices/${inv.number}.pdf`;
      db.prepare(`UPDATE invoices SET external_id=? WHERE id=?`).run(pdfRel, inv.id);
    }
  } catch (e) {}

  // Página de éxito
  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Pago confirmado</title>
<style>
  :root{ --bg:#0b1220; --txt:#e5e7eb; --card:#111827; --line:#ffffff22 }
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt)}
  .wrap{max-width:760px;margin:0 auto;padding:20px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
  .btn{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 12px;border-radius:10px}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  .muted{opacity:.8}
</style>
<body><main class="wrap">
  <section class="card">
    <h2>¡Pago confirmado!</h2>
    <p>Producto: <b>${inv.p_name}</b></p>
    <p>Total: <b>${inv.currency} ${Number(inv.amount).toFixed(2)}</b></p>
    <p>Nº de factura: <b>${inv.number}</b></p>
    <p>Próximo ciclo: <b>${new Date(inv.cycle_end_at).toLocaleString()}</b></p>
    <div class="row">
      ${pdfRel ? `<a class="btn" href="${pdfRel}" target="_blank">Ver factura PDF</a>` : ``}
      <a class="btn" href="/invoices">Volver a facturas</a>
      <a class="btn" href="/">Ir al panel</a>
    </div>
    <hr>
    <h3>Información del producto</h3>
    <pre style="white-space:pre-wrap">${inv.reveal_info || '—'}</pre>
    <p class="muted">Guarda esta información en un lugar seguro.</p>
  </section>
</main></body></html>`);
});

/* ====== ALIAS/RETORNOS PayPal ====== */
function extractInvoiceId(req){
  const b = req.body || {};
  const q = req.query || {};
  const p = req.params || {};
  const all = { ...q, ...b, ...p };
  const keys = [
    "id","invoice_id","invoice","inv","order_id","order","tx","txn_id",
    "token","paymentId","payerId","PayerID","resource_id","subscription_id","subscriptionID","custom"
  ];
  for(const k of keys){
    const v = all[k];
    if (v==null) continue;
    if (/^\d+$/.test(String(v))) return Number(v);
    if (k==="custom") {
      try { const j = JSON.parse(String(v)); if (j && j.invoice_id && /^\d+$/.test(String(j.invoice_id))) return Number(j.invoice_id); } catch {}
      if (/^\d+$/.test(String(v))) return Number(v);
    }
  }
  if (req.session && req.session.last_invoice_id) return Number(req.session.last_invoice_id);
  return 0;
}
function softRedirectToConfirm(req, res) {
  const id = extractInvoiceId(req);
  return res.redirect(303, id ? `/invoices/confirm/${id}` : `/invoices/confirm`);
}

/* POST (sin sesión) → 303 a GET local */
const parseBody = express.urlencoded({ extended: true });
router.post("/confirm/:id", parseBody, (req,res)=> softRedirectToConfirm(req,res));
router.post("/confirm",     parseBody, (req,res)=> softRedirectToConfirm(req,res));
router.post("/success/:id", parseBody, (req,res)=> softRedirectToConfirm(req,res));
router.post("/success",     parseBody, (req,res)=> softRedirectToConfirm(req,res));
router.post("/return/:id",  parseBody, (req,res)=> softRedirectToConfirm(req,res));
router.post("/return",      parseBody, (req,res)=> softRedirectToConfirm(req,res));
router.post("/pay/:id/success", parseBody, (req,res)=> softRedirectToConfirm(req,res));

/* GET alias (SIN ensureAuth, solo puente 303) → confirm/:id */
router.get("/pay/confirm/:id", (req,res)=> res.redirect(303, `/invoices/confirm/${Number(req.params.id||0) || ''}` || `/invoices/confirm`));
router.get("/success/:id",      (req,res)=> res.redirect(303, `/invoices/confirm/${Number(req.params.id||0) || ''}` || `/invoices/confirm`));
router.get("/return/:id",       (req,res)=> res.redirect(303, `/invoices/confirm/${Number(req.params.id||0) || ''}` || `/invoices/confirm`));
router.get("/pay/:id/success",  (req,res)=> res.redirect(303, `/invoices/confirm/${Number(req.params.id||0) || ''}` || `/invoices/confirm`));

/* ====== /invoices/confirm (GET) resuelve factura sin id ====== */
router.get("/confirm", ensureAuth, (req,res)=>{
  const u = req.session.user;
  const fromQuery = Number(req.query.id||0);
  const fromSess  = Number(req.session.last_invoice_id||0);

  let id = fromQuery || fromSess;

  if (!id) {
    const paid = db.prepare(`
      SELECT id FROM invoices
      WHERE user_id=? AND status='paid'
      ORDER BY datetime(COALESCE(paid_at,created_at)) DESC, id DESC LIMIT 1
    `).get(u.id)?.id;

    id = paid || db.prepare(`
      SELECT id FROM invoices
      WHERE user_id=?
      ORDER BY datetime(created_at) DESC, id DESC LIMIT 1
    `).get(u.id)?.id || 0;
  }

  if (!id) return res.redirect("/invoices");
  return res.redirect(302, `/invoices/confirm/${id}`);
});

module.exports = router;
