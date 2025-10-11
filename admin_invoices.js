// admin_invoices.js — Admin: ver/buscar/descargar/eliminar/cancelar servicios (claro/oscuro)
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const db = require("./db");

const router = express.Router();

/* ===== body parsers ===== */
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

/* ===== middleware ===== */
function ensureAdmin(req, res, next) {
  const u = req.session && req.session.user;
  if (!u) return res.redirect("/login");
  if (!u.is_admin) return res.redirect("/");
  next();
}

/* ===== schema defensivo ===== */
function ensureSchema() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS services(
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      period_minutes INTEGER NOT NULL,
      next_invoice_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      canceled_at TEXT,
      UNIQUE(user_id, product_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    )`).run();
  try { db.prepare(`ALTER TABLE services ADD COLUMN canceled_at TEXT`).run(); } catch {}
}
ensureSchema();

/* ===== page ===== */
router.get("/", ensureAdmin, (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  res.type("html").send(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Admin · Facturas</title>
<style>
  :root{
    --bg:#0b1220; --card:#111827; --txt:#e5e7eb; --muted:#9aa4b2; --line:#ffffff22;
    --accent:#2563eb; --danger:#ef4444; --ok:#16a34a;
  }
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
  .btn.red{background:var(--danger);border-color:#b91c1c}
  .btn.ok{background:var(--ok);border-color:#15803d}
  .btn[disabled]{opacity:.6;cursor:not-allowed}
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

  .wrap{max-width:1200px;margin:0 auto;padding:14px}
  .title{margin:10px 0 6px 0}
  .muted{color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}

  .toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
  .input{width:320px;max-width:100%;padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:inherit}
  body.light .input{background:#fff;border-color:#00000022}

  .seg{display:inline-flex;border:1px solid #334155;border-radius:10px;overflow:hidden}
  .seg button{padding:8px 12px;background:transparent;border:0;color:inherit;cursor:pointer}
  .seg button.active{background:#1f2a44}
  body.light .seg{border-color:#00000022}
  body.light .seg button.active{background:#eef2ff;color:#111}

  table{width:100%;border-collapse:separate;border-spacing:0}
  th,td{padding:12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
  tbody tr:hover{background:#ffffff0c}
  body.light tbody tr:hover{background:#00000006}
  .tag{display:inline-block;padding:4px 8px;border-radius:999px;border:1px solid var(--line);font-size:12px}
  .right{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}
  .nowrap{white-space:nowrap}
  .ellipsis{max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  .selcol{width:36px}
  .sel{width:16px;height:16px}

  .actionsbar{display:flex;gap:8px;align-items:center;margin:8px 0}
  @media(max-width:760px){
    .hide-sm{display:none}
    .toolbar{flex-direction:column;align-items:stretch}
    .input{width:100%}
  }
</style>
</head>
<body>
  <div class="topbar">
    <div class="row">
      <button id="menuBtn" class="burger" aria-label="Abrir menú"><span></span></button>
      <div class="brand">${site} · Admin</div>
    </div>
    <div class="row">
      <button id="modeBtn" class="btn ghost" type="button">🌙</button>
      <a class="btn ghost" href="/">← Dashboard</a>
      <a class="btn red" href="/logout">Salir</a>
    </div>
  </div>

  <div class="drawer" id="drawer">
    <div class="panel">
      <h3 style="margin:0 0 10px">Menú</h3>
      <nav class="nav" id="sidenav">
        <a href="/admin" data-match="^/admin/?$"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7v-1a5 5 0 0 1 10 0v1H3z"/></svg>Usuarios</a>
        <a href="/admin/mail" data-match="^/admin/mail"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3h13A1.5 1.5 0 0 1 16 4.5v7A1.5 1.5 0 0 1 14.5 13h-13A1.5 1.5 0 0 1 0 11.5v-7A1.5 1.5 0 0 1 1.5 3Zm.5 1.8 6 3.7 6-3.7V5L8 8.7 2 5v-.2Z"/></svg>Correo (SMTP)</a>
        <a href="/admin/brand" data-match="^/admin/brand"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm1 8h10l-3.2-4-2.3 3L6 8 3 11Zm6-6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>Logo y nombre</a>
        <a href="/admin/store" data-match="^/admin/store"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>Resumen tienda</a>
        <a href="/admin/products" data-match="^/admin/products"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 4.5 8 1l6 3.5V12l-6 3.5L2 12V4.5Zm6 1L4 3.3v2.9l4 2.3 4-2.3V3.3L8 5.5Z"/></svg>Productos</a>
        <a href="/admin/invoices" data-match="^/admin/invoices"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>Facturas</a>
        <a href="/admin/tickets" data-match="^/admin/tickets"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0-1 1 1 1 0 0 0 1 1v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a1 1 0 0 0 1-1 1 1 0 0 0-1-1V5Z"/></svg>Tickets</a>
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>

  <div class="wrap">
    <h2 class="title">Facturas y cancelaciones</h2>
    <p class="muted">Buscar por número, correo, nombre o usuario. Descargar PDF, eliminar o cancelar servicio.</p>

    <section class="card">
      <div class="toolbar">
        <div class="seg" role="tablist">
          <button id="tabBtnInvoices" class="active" data-tab="invoices" type="button">Facturas</button>
          <button id="tabBtnUnpaid" data-tab="unpaid" type="button">Pendientes</button>
          <button id="tabBtnCanceled" data-tab="canceled" type="button">Cancelados</button>
        </div>
        <input id="q" class="input" placeholder="Buscar… (INV-..., @usuario, correo, nombre, producto)">
        <button id="refreshBtn" class="btn ghost" type="button">Actualizar</button>
      </div>

      <!-- TAB FACTURAS -->
      <div id="tabInvoices">
        <div class="actionsbar">
          <label><input id="chkAllInv" class="sel" type="checkbox"> Seleccionar todo</label>
          <button id="bulkDelInv" class="btn red" type="button" disabled>Eliminar seleccionadas</button>
        </div>
        <div class="tablewrap">
          <table id="tblInv">
            <thead>
              <tr>
                <th class="selcol"></th>
                <th class="hide-sm">ID</th>
                <th>Número</th>
                <th>Usuario</th>
                <th class="hide-sm">Email</th>
                <th class="hide-sm">Producto</th>
                <th>Monto</th>
                <th>Estado</th>
                <th class="hide-sm">Método</th>
                <th class="hide-sm">Fecha</th>
                <th class="right">Acciones</th>
              </tr>
            </thead>
            <tbody id="tbodyInv">
              <tr><td colspan="11" class="muted">Cargando…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB PENDIENTES -->
      <div id="tabUnpaid" style="display:none">
        <div class="actionsbar">
          <label><input id="chkAllUnp" class="sel" type="checkbox"> Seleccionar todo</label>
          <button id="bulkDelUnp" class="btn red" type="button" disabled>Eliminar seleccionadas</button>
        </div>
        <div class="tablewrap">
          <table id="tblUnp">
            <thead>
              <tr>
                <th class="selcol"></th>
                <th class="hide-sm">ID</th>
                <th>Número</th>
                <th>Usuario</th>
                <th class="hide-sm">Email</th>
                <th class="hide-sm">Producto</th>
                <th>Monto</th>
                <th>Estado</th>
                <th class="hide-sm">Fecha</th>
                <th class="right">Acciones</th>
              </tr>
            </thead>
            <tbody id="tbodyUnp">
              <tr><td colspan="10" class="muted">Cargando…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB CANCELADOS -->
      <div id="tabCanceled" style="display:none">
        <div class="actionsbar">
          <label><input id="chkAllCan" class="sel" type="checkbox"> Seleccionar todo</label>
          <button id="bulkDelCan" class="btn red" type="button" disabled>Eliminar seleccionados</button>
        </div>
        <div class="tablewrap">
          <table id="tblCan">
            <thead>
              <tr>
                <th class="selcol"></th>
                <th class="hide-sm">ID</th>
                <th>Usuario</th>
                <th class="hide-sm">Email</th>
                <th>Producto</th>
                <th class="hide-sm">Activo desde</th>
                <th>Cancelado el</th>
              </tr>
            </thead>
            <tbody id="tbodyCan">
              <tr><td colspan="7" class="muted">Cargando…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>

<script>
(function(){
  /* tema */
  var modeBtn=document.getElementById('modeBtn');
  function applyMode(m){var l=(m==='light');document.body.classList.toggle('light',l);modeBtn.textContent=l?'☀️':'🌙';localStorage.setItem('ui:mode',l?'light':'dark')}
  applyMode(localStorage.getItem('ui:mode')||'dark');
  modeBtn.addEventListener('click',()=>applyMode(document.body.classList.contains('light')?'dark':'light'));

  /* drawer */
  var drawer=document.getElementById('drawer'), scrim=document.getElementById('scrim');
  document.getElementById('menuBtn').addEventListener('click',()=>{drawer.classList.add('open');scrim.classList.add('show')});
  scrim.addEventListener('click',()=>{drawer.classList.remove('open');scrim.classList.remove('show')});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'){drawer.classList.remove('open');scrim.classList.remove('show')}});

  /* active nav */
  (function(){var p=location.pathname;document.querySelectorAll('#sidenav a').forEach(a=>{var re=new RegExp(a.getAttribute('data-match')); if(re.test(p)) a.classList.add('active')})})();

  /* refs y helpers generales */
  var q = document.getElementById('q');
  var tabInv=document.getElementById('tabInvoices');
  var tabUnp=document.getElementById('tabUnpaid');
  var tabCan=document.getElementById('tabCanceled');
  var currentTab = localStorage.getItem('admin:invTab') || 'invoices';
  var t=null; function debounce(fn,ms){ clearTimeout(t); t=setTimeout(fn,ms||220); }
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  function fmtAmt(a,c){a=Number(a||0); return (c==='USD'?'$ ':'MXN ')+a.toFixed(2)}

  /* tabs */
  function setTab(t){
    currentTab = t;
    tabInv.style.display = (t==='invoices') ? 'block':'none';
    tabUnp.style.display  = (t==='unpaid')   ? 'block':'none';
    tabCan.style.display  = (t==='canceled') ? 'block':'none';
    document.getElementById('tabBtnInvoices').classList.toggle('active',t==='invoices');
    document.getElementById('tabBtnUnpaid').classList.toggle('active',t==='unpaid');
    document.getElementById('tabBtnCanceled').classList.toggle('active',t==='canceled');
    localStorage.setItem('admin:invTab', t);
    load();
  }
  document.getElementById('tabBtnInvoices').onclick=()=>setTab('invoices');
  document.getElementById('tabBtnUnpaid').onclick =()=>setTab('unpaid');
  document.getElementById('tabBtnCanceled').onclick=()=>setTab('canceled');

  /* cargar según tab */
  async function load(){
    if (currentTab==='invoices') return loadInvoices();
    if (currentTab==='unpaid')   return loadUnpaid();
    return loadCanceled();
  }

  /* ===== FACTURAS ===== */
  async function loadInvoices(){
    try{
      var r=await fetch('/admin/invoices/api?q='+encodeURIComponent(q.value.trim()),{credentials:'same-origin',cache:'no-store'});
      var data=await r.json();
      renderInvoices(Array.isArray(data)?data:[]);
    }catch(e){
      document.getElementById('tbodyInv').innerHTML='<tr><td colspan="11">Error cargando</td></tr>';
    }
  }
  function renderInvoices(rows){
    var tb=document.getElementById('tbodyInv');
    if(!rows.length){ tb.innerHTML='<tr><td colspan="11" class="muted">Sin resultados.</td></tr>'; toggleBulkBtns(); return; }
    var h='';
    rows.forEach(x=>{
      var status=x.status||'paid';
      h+=
      '<tr data-id="'+x.id+'">'
      +  '<td><input class="sel" type="checkbox" name="selInv"></td>'
      +  '<td class="hide-sm">'+x.id+'</td>'
      +  '<td class="nowrap">'+esc(x.number||'—')+'</td>'
      +  '<td class="ellipsis">@'+esc(x.username||'')+' · '+esc((x.name||"")+" "+(x.surname||"")).trim()+'</td>'
      +  '<td class="hide-sm ellipsis">'+esc(x.email||'')+'</td>'
      +  '<td class="hide-sm ellipsis">'+esc(x.product_name||'—')+'</td>'
      +  '<td>'+fmtAmt(x.amount,x.currency)+'</td>'
      +  '<td><span class="tag">'+esc(status)+'</span></td>'
      +  '<td class="hide-sm">'+esc(x.payment_method||'—')+'</td>'
      +  '<td class="hide-sm nowrap">'+esc((x.created_at||'').replace('T',' ').slice(0,19))+'</td>'
      +  '<td class="right">'
      +     (x.external_id?('<a class="btn ghost" href="'+esc(x.external_id)+'" target="_blank" rel="noopener">PDF</a>'):'')
      +     '<button class="btn ok" data-cancel>Cancelar servicio</button>'
      +     '<button class="btn red" data-del>Eliminar</button>'
      +  '</td>'
      +'</tr>';
    });
    tb.innerHTML=h;
    toggleBulkBtns();
  }

  /* ===== PENDIENTES ===== */
  async function loadUnpaid(){
    try{
      var r=await fetch('/admin/invoices/api/unpaid?q='+encodeURIComponent(q.value.trim()),{credentials:'same-origin',cache:'no-store'});
      var data=await r.json();
      renderUnpaid(Array.isArray(data)?data:[]);
    }catch(e){
      document.getElementById('tbodyUnp').innerHTML='<tr><td colspan="10">Error cargando</td></tr>';
    }
  }
  function renderUnpaid(rows){
    var tb=document.getElementById('tbodyUnp');
    if(!rows.length){ tb.innerHTML='<tr><td colspan="10" class="muted">Sin pendientes.</td></tr>'; toggleBulkBtns(); return; }
    var h='';
    rows.forEach(x=>{
      h+=
      '<tr data-id="'+x.id+'">'
      +  '<td><input class="sel" type="checkbox" name="selUnp"></td>'
      +  '<td class="hide-sm">'+x.id+'</td>'
      +  '<td class="nowrap">'+esc(x.number||'—')+'</td>'
      +  '<td class="ellipsis">@'+esc(x.username||'')+' · '+esc((x.name||"")+" "+(x.surname||"")).trim()+'</td>'
      +  '<td class="hide-sm ellipsis">'+esc(x.email||'')+'</td>'
      +  '<td class="hide-sm ellipsis">'+esc(x.product_name||'—')+'</td>'
      +  '<td>'+fmtAmt(x.amount,x.currency)+'</td>'
      +  '<td><span class="tag">'+esc(x.status||'pending')+'</span></td>'
      +  '<td class="hide-sm nowrap">'+esc((x.created_at||'').replace('T',' ').slice(0,19))+'</td>'
      +  '<td class="right">'
      +     (x.external_id?('<a class="btn ghost" href="'+esc(x.external_id)+'" target="_blank" rel="noopener">PDF</a>'):'')
      +     '<button class="btn red" data-del>Eliminar</button>'
      +  '</td>'
      +'</tr>';
    });
    tb.innerHTML=h;
    toggleBulkBtns();
  }

  /* ===== CANCELADOS ===== */
  async function loadCanceled(){
    try{
      var r=await fetch('/admin/invoices/api/canceled?q='+encodeURIComponent(q.value.trim()),{credentials:'same-origin',cache:'no-store'});
      var data=await r.json();
      renderCanceled(Array.isArray(data)?data:[]);
    }catch(e){
      document.getElementById('tbodyCan').innerHTML='<tr><td colspan="7">Error cargando</td></tr>';
    }
  }
  function renderCanceled(rows){
    var tb=document.getElementById('tbodyCan');
    if(!rows.length){ tb.innerHTML='<tr><td colspan="7" class="muted">Sin cancelados.</td></tr>'; toggleBulkBtns(); return; }
    var h='';
    rows.forEach(x=>{
      h+=
      '<tr data-service-id="'+x.service_id+'">'
      +  '<td><input class="sel" type="checkbox" name="selCan"></td>'
      +  '<td class="hide-sm">'+x.service_id+'</td>'
      +  '<td class="ellipsis">@'+esc(x.username||'')+' · '+esc((x.name||"")+" "+(x.surname||"")).trim()+'</td>'
      +  '<td class="hide-sm ellipsis">'+esc(x.email||'')+'</td>'
      +  '<td class="ellipsis">'+esc(x.product_name||'')+'</td>'
      +  '<td class="hide-sm nowrap">'+esc((x.started_at||'').replace('T',' ').slice(0,19))+'</td>'
      +  '<td class="nowrap">'+esc((x.canceled_at||'').replace('T',' ').slice(0,19))+'</td>'
      +'</tr>';
    });
    tb.innerHTML=h;
    toggleBulkBtns();
  }

  /* selección múltiple + acciones en lote */
  function getSelectedIds(tbodyId, attr){
    return Array.from(document.querySelectorAll('#'+tbodyId+' input.sel:checked'))
      .map(chk=>Number(chk.closest('tr').getAttribute(attr)||0))
      .filter(Boolean);
  }
  function toggleBulkBtns(){
    var invSel = getSelectedIds('tbodyInv','data-id');
    var unpSel = getSelectedIds('tbodyUnp','data-id');
    var canSel = getSelectedIds('tbodyCan','data-service-id');
    document.getElementById('bulkDelInv').disabled = invSel.length===0;
    document.getElementById('bulkDelUnp').disabled = unpSel.length===0;
    document.getElementById('bulkDelCan').disabled = canSel.length===0;
  }
  document.addEventListener('change', e=>{
    if (e.target.matches('#chkAllInv')) {
      document.querySelectorAll('#tbodyInv input.sel').forEach(c=>c.checked=e.target.checked);
      toggleBulkBtns(); return;
    }
    if (e.target.matches('#chkAllUnp')) {
      document.querySelectorAll('#tbodyUnp input.sel').forEach(c=>c.checked=e.target.checked);
      toggleBulkBtns(); return;
    }
    if (e.target.matches('#chkAllCan')) {
      document.querySelectorAll('#tbodyCan input.sel').forEach(c=>c.checked=e.target.checked);
      toggleBulkBtns(); return;
    }
    if (e.target.matches('tbody input.sel')) toggleBulkBtns();
  });

  // borrar en lote: facturas (cualquier tab de facturas)
  document.getElementById('bulkDelInv').addEventListener('click', async ()=>{
    var ids=getSelectedIds('tbodyInv','data-id');
    if(!ids.length) return;
    if(!confirm('¿Eliminar '+ids.length+' factura(s)?')) return;
    const url='/admin/invoices/api/bulk?ids='+encodeURIComponent(ids.join(','));
    const r = await fetch(url,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
    const t = await r.text(); if(t!=='OK'){ alert(t); return; }
    load();
  });
  document.getElementById('bulkDelUnp').addEventListener('click', async ()=>{
    var ids=getSelectedIds('tbodyUnp','data-id');
    if(!ids.length) return;
    if(!confirm('¿Eliminar '+ids.length+' factura(s) pendientes?')) return;
    const url='/admin/invoices/api/bulk?ids='+encodeURIComponent(ids.join(','));
    const r = await fetch(url,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
    const t = await r.text(); if(t!=='OK'){ alert(t); return; }
    load();
  });

  // borrar en lote: cancelados (servicios)
  document.getElementById('bulkDelCan').addEventListener('click', async ()=>{
    var service_ids=getSelectedIds('tbodyCan','data-service-id');
    if(!service_ids.length) return;
    if(!confirm('¿Eliminar definitivamente '+service_ids.length+' servicio(s) cancelado(s)? Se borrarán sus facturas.')) return;
    const url='/admin/invoices/api/canceled/bulk?service_ids='+encodeURIComponent(service_ids.join(','));
    const r = await fetch(url,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({service_ids})});
    const t = await r.text(); if(t!=='OK'){ alert(t); return; }
    load();
  });

  document.getElementById('refreshBtn').addEventListener('click',load);
  q.addEventListener('input',()=>debounce(load,220));

  /* acciones por fila (delete + cancel-service) */
  function actionHandler(e){
    var tr=e.target.closest('tr'); if(!tr) return;
    var id=Number(tr.getAttribute('data-id')||0); if(!id) return;

    if (e.target.closest('[data-del]')){
      if(!confirm('¿Eliminar esta factura?')) return;
      e.target.disabled=true;
      fetch('/admin/invoices/api/'+id,{method:'DELETE'})
        .then(r=>r.text())
        .then(t=>{ if(t!=='OK'){ alert(t); e.target.disabled=false; return; } tr.remove(); toggleBulkBtns(); })
        .catch(err=>{ alert('Error: '+err.message); e.target.disabled=false; });
      return;
    }

    if (e.target.closest('[data-cancel]')){
      if(!confirm('¿Cancelar el servicio asociado? Se moverá a "Cancelados" y se borrarán sus facturas.')) return;
      e.target.disabled=true;
      fetch('/admin/invoices/api/cancel-service',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ invoice_id:id })
      })
      .then(r=>r.text())
      .then(t=>{
        if (t!=='OK'){ alert(t); e.target.disabled=false; return; }
        alert('Servicio cancelado y facturas eliminadas.');
        load();
      })
      .catch(err=>{ alert('Error: '+err.message); e.target.disabled=false; });
    }
  }
  document.getElementById('tbodyInv').addEventListener('click', actionHandler);
  document.getElementById('tbodyUnp').addEventListener('click', actionHandler);

  setTab(currentTab);
})();
</script>
</body>
</html>`);
});

/* ===== API: lista/búsqueda de facturas (todas) ===== */
router.get("/api", ensureAdmin, (req, res) => {
  const q = String(req.query.q || "").trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT i.id, i.number, i.amount, i.currency, i.status, i.payment_method,
             i.external_id, i.created_at, i.user_id, i.product_id,
             u.username, u.name, u.surname, u.email,
             p.name AS product_name
      FROM invoices i
      LEFT JOIN users u   ON u.id = i.user_id
      LEFT JOIN products p ON p.id = i.product_id
      WHERE i.number     LIKE ?
         OR u.username   LIKE ?
         OR u.name       LIKE ?
         OR u.surname    LIKE ?
         OR u.email      LIKE ?
         OR p.name       LIKE ?
      ORDER BY datetime(i.created_at) DESC, i.id DESC
      LIMIT 300
    `).all(like, like, like, like, like, like);
  } else {
    rows = db.prepare(`
      SELECT i.id, i.number, i.amount, i.currency, i.status, i.payment_method,
             i.external_id, i.created_at, i.user_id, i.product_id,
             u.username, u.name, u.surname, u.email,
             p.name AS product_name
      FROM invoices i
      LEFT JOIN users u   ON u.id = i.user_id
      LEFT JOIN products p ON p.id = i.product_id
      ORDER BY datetime(i.created_at) DESC, i.id DESC
      LIMIT 150
    `).all();
  }
  res.json(rows);
});

/* ===== API: facturas pendientes (unpaid/pending/overdue) ===== */
router.get("/api/unpaid", ensureAdmin, (req, res) => {
  const q = String(req.query.q || "").trim();
  const whereStatus = `i.status IN ('pending','unpaid','overdue')`;
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT i.id, i.number, i.amount, i.currency, i.status,
             i.external_id, i.created_at, i.user_id, i.product_id,
             u.username, u.name, u.surname, u.email,
             p.name AS product_name
      FROM invoices i
      LEFT JOIN users u ON u.id=i.user_id
      LEFT JOIN products p ON p.id=i.product_id
      WHERE ${whereStatus} AND (
           i.number LIKE ? OR u.username LIKE ? OR u.name LIKE ? OR u.surname LIKE ? OR u.email LIKE ? OR p.name LIKE ?
      )
      ORDER BY datetime(i.created_at) DESC, i.id DESC
      LIMIT 300
    `).all(like, like, like, like, like, like);
  } else {
    rows = db.prepare(`
      SELECT i.id, i.number, i.amount, i.currency, i.status,
             i.external_id, i.created_at, i.user_id, i.product_id,
             u.username, u.name, u.surname, u.email,
             p.name AS product_name
      FROM invoices i
      LEFT JOIN users u ON u.id=i.user_id
      LEFT JOIN products p ON p.id=i.product_id
      WHERE ${whereStatus}
      ORDER BY datetime(i.created_at) DESC, i.id DESC
      LIMIT 150
    `).all();
  }
  res.json(rows);
});

/* ===== API: servicios cancelados ===== */
router.get("/api/canceled", ensureAdmin, (req, res) => {
  const q = String(req.query.q || "").trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT s.id AS service_id, s.canceled_at, s.user_id, s.product_id,
             u.username, u.name, u.surname, u.email,
             p.name AS product_name,
             (SELECT MIN(created_at) FROM invoices i
               WHERE i.user_id=s.user_id AND (i.product_id=s.product_id OR i.service_id=s.id)
             ) AS started_at
      FROM services s
      JOIN users u ON u.id=s.user_id
      JOIN products p ON p.id=s.product_id
      WHERE s.status='canceled' AND (
            u.username LIKE ? OR u.email LIKE ? OR u.name LIKE ? OR u.surname LIKE ? OR p.name LIKE ?
      )
      ORDER BY datetime(COALESCE(s.canceled_at, s.next_invoice_at)) DESC, s.id DESC
      LIMIT 300
    `).all(like, like, like, like, like);
  } else {
    rows = db.prepare(`
      SELECT s.id AS service_id, s.canceled_at, s.user_id, s.product_id,
             u.username, u.name, u.surname, u.email,
             p.name AS product_name,
             (SELECT MIN(created_at) FROM invoices i
               WHERE i.user_id=s.user_id AND (i.product_id=s.product_id OR i.service_id=s.id)
             ) AS started_at
      FROM services s
      JOIN users u ON u.id=s.user_id
      JOIN products p ON p.id=s.product_id
      WHERE s.status='canceled'
      ORDER BY datetime(COALESCE(s.canceled_at, s.next_invoice_at)) DESC, s.id DESC
      LIMIT 150
    `).all();
  }
  res.json(rows);
});

/* ===== util: borrar archivo PDF si aplica ===== */
function tryDeletePDF(external_id) {
  if (!external_id) return;
  const rel = String(external_id).replace(/^\/+/, "");
  const abs = path.resolve(process.cwd(), rel);
  const safeBase = path.resolve(process.cwd(), "uploads", "invoices");
  if (abs.startsWith(safeBase)) {
    try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch {}
  }
}

/* ===== API: eliminar factura (borra también el PDF si existe) ===== */
router.delete("/api/:id", ensureAdmin, (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).send("Falta id");
  try {
    const inv = db.prepare(`SELECT external_id FROM invoices WHERE id=?`).get(id);
    if (!inv) return res.status(404).send("No encontrada");
    tryDeletePDF(inv.external_id);
    db.prepare(`DELETE FROM invoices WHERE id=?`).run(id);
    res.send("OK");
  } catch (e) {
    res.status(500).send("ERR: " + (e?.message || "delete"));
  }
});

/* ===== helpers extracción de IDs (robusto) ===== */
function extractNumericIds(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") return input.split(/[,\s]+/).filter(Boolean);
  return [];
}
function getIdsFromReq(req, fieldName) {
  let raw = [];
  // JSON / urlencoded: ids o ids[]
  if (req.body && (req.body[fieldName] != null)) raw = raw.concat(req.body[fieldName]);
  if (req.body && (req.body[`${fieldName}[]`] != null)) raw = raw.concat(req.body[`${fieldName}[]`]);
  // Querystring: ?ids=1,2,3 o ?ids[]=1&ids[]=2
  if (req.query && (req.query[fieldName] != null)) raw = raw.concat(req.query[fieldName]);
  if (req.query && (req.query[`${fieldName}[]`] != null)) raw = raw.concat(req.query[`${fieldName}[]`]);
  const flat = extractNumericIds(raw).map(n => Number(n)).filter(Boolean);
  // Quita duplicados
  return Array.from(new Set(flat));
}

/* ===== API: eliminar facturas en lote ===== */
// Acepta DELETE y POST para máxima compatibilidad
const bulkDeleteInvoices = (req, res) => {
  const ids = getIdsFromReq(req, "ids");
  if (!ids.length) return res.status(400).send("Faltan ids");
  try {
    const tx = db.transaction(() => {
      const get = db.prepare(`SELECT external_id FROM invoices WHERE id=?`);
      const del = db.prepare(`DELETE FROM invoices WHERE id=?`);
      ids.forEach(id => {
        const inv = get.get(id);
        if (inv) tryDeletePDF(inv.external_id);
        del.run(id);
      });
    });
    tx();
    res.send("OK");
  } catch (e) {
    res.status(500).send("ERR: " + (e?.message || "bulk-delete"));
  }
};
router.delete("/api/bulk", ensureAdmin, bulkDeleteInvoices);
router.post("/api/bulk", ensureAdmin, bulkDeleteInvoices);

/* ===== API: cancelar servicio desde una factura ===== */
router.post("/api/cancel-service", ensureAdmin, (req, res) => {
  const invoice_id = Number(req.body?.invoice_id || 0);
  if (!invoice_id) return res.status(400).send("Falta invoice_id");

  const inv = db.prepare(`SELECT user_id, product_id FROM invoices WHERE id=?`).get(invoice_id);
  if (!inv) return res.status(404).send("Factura no encontrada");

  const svc = db.prepare(`SELECT id,status FROM services WHERE user_id=? AND product_id=?`).get(inv.user_id, inv.product_id);
  if (!svc) return res.status(404).send("Servicio no existe para este usuario/producto");

  try{
    const tx = db.transaction(() => {
      if ((svc.status||"active").toLowerCase() !== "canceled") {
        db.prepare(`UPDATE services SET status='canceled', canceled_at=? WHERE id=?`)
          .run(new Date().toISOString(), svc.id);
      }
      const invs = db.prepare(`SELECT id, external_id FROM invoices WHERE user_id=? AND (product_id=? OR service_id=?)`)
                     .all(inv.user_id, inv.product_id, svc.id);
      invs.forEach(r => tryDeletePDF(r.external_id));
      db.prepare(`DELETE FROM invoices WHERE user_id=? AND (product_id=? OR service_id=?)`)
        .run(inv.user_id, inv.product_id, svc.id);
    });
    tx();
    res.send("OK");
  }catch(e){
    res.status(500).send("ERR: " + (e?.message || "cancel"));
  }
});

/* ===== API: eliminar servicios cancelados en lote (y sus facturas) ===== */
const bulkDeleteCanceled = (req, res) => {
  const service_ids = getIdsFromReq(req, "service_ids");
  if (!service_ids.length) return res.status(400).send("Faltan service_ids");
  try{
    const tx = db.transaction(() => {
      const getSvc = db.prepare(`SELECT id, user_id, product_id FROM services WHERE id=? AND status='canceled'`);
      const getInvs = db.prepare(`SELECT id, external_id FROM invoices WHERE user_id=? AND (product_id=? OR service_id=?)`);
      const delInv  = db.prepare(`DELETE FROM invoices WHERE user_id=? AND (product_id=? OR service_id=?)`);
      const delSvc  = db.prepare(`DELETE FROM services WHERE id=?`);

      service_ids.forEach(sid=>{
        const svc = getSvc.get(sid);
        if (!svc) return;
        const invs = getInvs.all(svc.user_id, svc.product_id, svc.id);
        invs.forEach(r => tryDeletePDF(r.external_id));
        delInv.run(svc.user_id, svc.product_id, svc.id);
        delSvc.run(svc.id);
      });
    });
    tx();
    res.send("OK");
  }catch(e){
    res.status(500).send("ERR: " + (e?.message || "bulk-canceled-delete"));
  }
};
router.delete("/api/canceled/bulk", ensureAdmin, bulkDeleteCanceled);
router.post("/api/canceled/bulk", ensureAdmin, bulkDeleteCanceled);

module.exports = router;