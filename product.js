// product.js — detalle y compra con créditos + PayPal (API/IPN) desde la ficha
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const db = require("./db");

const router = express.Router();

/* ===== helpers ===== */
function ensureAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}
const get = (k, d = "") => db.getSetting(k, d);
const FAR_FUTURE = "2099-12-31T00:00:00.000Z";

function baseUrl(req) {
  const proto =
    (req.headers["x-forwarded-proto"] || "").split(",")[0] ||
    (req.secure ? "https" : "http");
  const host =
    req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

function tryDeletePDF(external_id) {
  if (!external_id) return;
  const rel = String(external_id).replace(/^\/+/, "");
  const abs = path.resolve(process.cwd(), rel);
  const safeBase = path.resolve(process.cwd(), "uploads", "invoices");
  if (abs.startsWith(safeBase)) {
    try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch {}
  }
}

// Solo aseguramos services (invoices ya las crea db.js)
function ensureSchema() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS services(
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      period_minutes INTEGER NOT NULL,
      next_invoice_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      UNIQUE(user_id, product_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `).run();
}
ensureSchema();

/* ==== util: etiquetas de periodo/tipo ==== */
function periodLabel(pm) {
  if (pm === 3) return "TEST · 3 min";
  if (pm === 10080) return "Semanal";
  if (pm === 21600) return "Cada 15 días";
  return "Mensual";
}
function typeLabel(product) {
  const isOneTime = String(product.billing_type) === "one_time" || Number(product.period_minutes) === 0;
  return isOneTime ? "Pago único" : periodLabel(Number(product.period_minutes || 43200));
}

/* ==== util: siguiente número de factura ==== */
function nextInvoiceNumber() {
  const now = new Date();
  const ym = now.toISOString().slice(0, 7).replace("-", ""); // YYYYMM
  const seq = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO settings(key,value) VALUES('invoice_seq','0')`).run();
    db.prepare(`UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key='invoice_seq'`).run();
    const r = db.prepare(`SELECT value FROM settings WHERE key='invoice_seq'`).get();
    return parseInt(r.value, 10) || 1;
  })();
  return `INV-${ym}-${String(seq).padStart(4, "0")}`;
}

/* ==== util: crear PDF (con chip PAGADO) ==== */
async function createInvoicePDF({
  number, site, logoUrl, user, product, amount, currency, createdAt, cycleEnd,
}) {
  const dir = path.join(process.cwd(), "uploads", "invoices");
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const file = path.join(dir, `${number}.pdf`);

  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const stream = fs.createWriteStream(file);
  doc.pipe(stream);

  // Encabezado
  doc.rect(0, 0, doc.page.width, 90).fill("#0b1220");
  try {
    if (logoUrl && /^\/uploads\//.test(logoUrl)) {
      const absLogo = path.join(process.cwd(), logoUrl.replace(/^\//, ""));
      if (fs.existsSync(absLogo)) doc.image(absLogo, 36, 18, { height: 54 });
    }
  } catch {}
  doc.fillColor("#ffffff").fontSize(20).text(site, 0, 24, { align: "right" });
  doc.fontSize(11).text(`Factura: ${number}`, 0, 48, { align: "right" });
  doc.text(`Fecha: ${new Date(createdAt).toLocaleString()}`, 0, 64, { align: "right" });

  // Chip PAGADO
  doc.save();
  doc.roundedRect(36, 100, 90, 22, 8).fill("#16a34a");
  doc.fillColor("#fff").fontSize(11).text("PAGADO", 36, 104, { width: 90, align: "center" });
  doc.restore();

  // Datos cliente
  doc.moveDown(2);
  doc.fillColor("#111827").fontSize(15).text("Datos del cliente");
  doc.moveDown(0.2);
  doc.fillColor("#374151").fontSize(11);
  doc.text(`Nombre: ${user.name} ${user.surname}`);
  doc.text(`Usuario: @${user.username}`);
  doc.text(`Correo: ${user.email}`);
  doc.text(`Teléfono: ${user.phone || "—"}`);

  // Producto
  const isOneTime = String(product.billing_type) === "one_time" || Number(product.period_minutes) === 0;
  const renewText = isOneTime ? "Pago único" : periodLabel(Number(product.period_minutes || 43200));

  doc.moveDown(1);
  doc.fillColor("#111827").fontSize(15).text("Detalle del producto");
  doc.moveDown(0.2);
  doc.fillColor("#374151").fontSize(11);
  doc.text(`Producto: ${product.name}`);
  doc.text(`Descripción: ${product.description || "—"}`);
  doc.text(`Tipo: ${renewText}`);
  doc.text(`Próximo ciclo hasta: ${isOneTime ? "—" : new Date(cycleEnd).toLocaleString()}`);

  // Resumen
  doc.moveDown(1);
  doc.fillColor("#111827").fontSize(15).text("Resumen de pago");
  doc.moveDown(0.2);
  doc.roundedRect(36, doc.y, doc.page.width - 72, 40, 10).stroke("#e5e7eb");
  doc.fontSize(13).fillColor("#0b1220").text(
    `Total: ${currency} ${Number(amount).toFixed(2)}`,
    46,
    doc.y - 35
  );

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return file;
}

/* ===== GET /product?id=xx ===== */
router.get("/product", ensureAuth, (req, res) => {
  const site = get("site_name", "SkyShop");
  const u = req.session.user;
  const id = Number(req.query.id || 0);
  const p = db.prepare(`SELECT * FROM products WHERE id=? AND active=1`).get(id);
  if (!p) return res.status(404).send("Producto no encontrado");

  const isOneTime = String(p.billing_type) === "one_time" || Number(p.period_minutes) === 0;
  const userHasActive = !!db.prepare(`SELECT 1 FROM services WHERE user_id=? AND product_id=? AND status='active'`).get(u.id, p.id);
  const outOfStock = (typeof p.stock === "number") && p.stock === 0;

  // Saldos
  const balUSD = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='USD'`).get(u.id)?.balance || 0;
  const balMXN = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='MXN'`).get(u.id)?.balance || 0;

  // Texto tipo
  const tipo = typeLabel(p);

  // Deshabilitar compra si corresponde
  const disableReason = outOfStock
    ? "Sin stock"
    : (isOneTime && userHasActive)
      ? "Ya comprado"
      : "";

  const canPayByCredits = disableReason
    ? false
    : ((p.currency === "USD" ? balUSD : balMXN) >= p.price);

  // ===== flags PayPal =====
  const ppApiEnabled = get("paypal_api_enabled", "0") === "1"
                    && !!get("paypal_api_client_id", "")
                    && !!get("paypal_api_secret", "");
  const ppIpnEnabled = get("paypal_ipn_enabled", "0") === "1"
                    && !!get("paypal_ipn_email", "");
  const ppModeLive = get("paypal_api_mode", "sandbox") === "live";
  const ppEmail = get("paypal_ipn_email", "");
  const webscr = ppModeLive
    ? "https://www.paypal.com/cgi-bin/webscr"
    : "https://www.sandbox.paypal.com/cgi-bin/webscr";
  const base = baseUrl(req);
  const ipnNotify = `${base}/pay/paypal/ipn`; // tu listener IPN

  const stockText = (typeof p.stock === "number")
    ? (p.stock < 0 ? "∞" : String(p.stock))
    : "—";

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · ${p.name}</title>
<style>
  :root{
    --bg:#0b1220; --txt:#e5e7eb; --muted:#9aa4b2; --card:#111827; --line:#ffffff22;
    --accent1:#f43f5e; --accent2:#fb7185; --accent:#2563eb;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt)}
  body.light{background:#ffffff;color:#0b1220}
  body.light .card{background:#fff;border-color:#00000018}
  body.light .muted{color:#667085}

  .sky{position:fixed;inset:0;pointer-events:none;z-index:0}
  .star{position:absolute;width:2px;height:2px;background:#fff;border-radius:50%;opacity:.9;animation:twinkle 3s linear infinite}
  .shoot{position:absolute;width:140px;height:2px;background:linear-gradient(90deg,#fff,transparent);
         transform:rotate(18deg);filter:drop-shadow(0 0 6px #ffffff55);animation:shoot 5.5s linear infinite}
  @keyframes twinkle{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
  @keyframes shoot{0%{transform:translate(-10vw,-10vh) rotate(18deg)}100%{transform:translate(110vw,110vh) rotate(18deg)}}

  .icons{position:fixed;inset:0;z-index:0;pointer-events:none;display:none}
  body.light .icons{display:block}
  .icons span{position:absolute;font-size:34px;opacity:.24;animation:floatUp linear infinite}
  @keyframes floatUp{0%{transform:translateY(20vh);opacity:0}10%{opacity:.24}90%{opacity:.24}100%{transform:translateY(-30vh);opacity:0}}

  .wrap{position:relative;z-index:1;max-width:1000px;margin:0 auto;padding:18px}
  .top{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:10px}
  .pill{padding:8px 10px;border-radius:999px;background:#ffffff18;border:1px solid #ffffff28;color:inherit;text-decoration:none}
  body.light .pill{background:#00000010;border-color:#00000018}
  .btn{display:inline-block;background:linear-gradient(90deg,var(--accent1),var(--accent2));color:#fff;text-decoration:none;
       padding:12px 14px;border-radius:12px;border:0;cursor:pointer}
  .btn[disabled]{opacity:.5;cursor:not-allowed}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
  .grid{display:grid;grid-template-columns:360px 1fr;gap:16px}
  @media(max-width:900px){.grid{grid-template-columns:1fr}}
  .img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;background:#0f172a}
  .muted{color:var(--muted)}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  .paycard{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
  @media(max-width:560px){.paycard{grid-template-columns:1fr}}
  .altpay{display:flex;align-items:center;justify-content:center;gap:10px;padding:12px;border-radius:12px;border:1px solid var(--line);
          background:#ffffff10;text-decoration:none;color:inherit; cursor:pointer}
  body.light .altpay{background:#00000006}
  .altpay[disabled]{opacity:.4;cursor:not-allowed}

  .modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;place-items:center;z-index:30}
  .modal.show{display:grid}
  .panel{background:#0b1325;border:1px solid #ffffff22;border-radius:16px;max-width:520px;width:92%;padding:14px}
  body.light .panel{background:#fff;border-color:#00000018}
  .opt{display:flex;align-items:center;gap:10px;border:1px solid #ffffff22;border-radius:12px;padding:12px;margin:8px 0;cursor:pointer;background:#0f172a}
  body.light .opt{background:#f8fafc;border-color:#00000018}
  .opt small{opacity:.8}
  .badges{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}
  .badge{display:inline-block;font-size:12px;padding:4px 8px;border-radius:999px;border:1px solid #ffffff24;background:#0b1325;color:#cbd5e1}
  body.light .badge{background:#f8fafc;color:#0b1220;border-color:#00000018}
</style>
<body>
  <div class="sky" id="sky"></div>
  <div class="icons" id="icons"></div>

  <main class="wrap">
    <div class="top">
      <a class="pill" href="/">← Volver al panel</a>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="muted" style="font-weight:700">${site}</span>
        <button id="modeBtn" class="pill" type="button">🌙</button>
      </div>
    </div>

    <div class="grid">
      <div class="card"><img class="img" src="${p.image_path || ''}" alt=""></div>

      <section class="card">
        <h1 style="margin:0 0 6px">${p.name}</h1>
        <div class="muted" style="margin-bottom:8px">${p.description || ''}</div>
        <div class="badges">
          <span class="badge" title="Tipo de cobro">${tipo}</span>
          <span class="badge" title="Stock">Stock: ${stockText}</span>
        </div>
        <div style="font-size:22px;font-weight:900;margin:10px 0">${p.currency} ${Number(p.price).toFixed(2)}</div>
        <div class="muted" style="margin:6px 0 12px">Tu saldo — USD: $${Number(balUSD).toFixed(2)} · MXN: ${Number(balMXN).toFixed(2)}</div>

        <form method="post" action="/product/buy" class="row" style="margin-top:6px">
          <input type="hidden" name="id" value="${p.id}">
          <button class="btn" type="submit" ${canPayByCredits ? '' : 'disabled title="' + (disableReason || 'Saldo insuficiente') + '"'}>Pagar con créditos</button>
          <a class="pill" href="/comprar-creditos?currency=${p.currency}">Recargar créditos</a>
        </form>

        <div class="paycard">
          <button id="paypalBtn" class="altpay" ${(disableReason || (!ppApiEnabled && !ppIpnEnabled)) ? 'disabled' : ''}
            title="${disableReason || ((!ppApiEnabled && !ppIpnEnabled) ? 'PayPal no disponible' : '')}">PayPal</button>
          <a class="altpay" ${disableReason ? 'aria-disabled="true" tabindex="-1" style="pointer-events:none;opacity:.4"' : ''} href="/pay/stripe?pid=${p.id}" title="Pagar con Stripe">Stripe</a>
        </div>

        ${disableReason ? `<div class="muted" style="margin-top:8px">No disponible: ${disableReason}.</div>` : ``}
      </section>
    </div>
  </main>

  <!-- Forms ocultos para PayPal -->
  <form id="ppApiForm" method="post" action="/pay/paypal/api/create" style="display:none">
    <input type="hidden" name="invoice_id" value="">
  </form>

  <!-- IPN directo (webscr) — rm=1 para volver por GET -->
  <form id="ppIpnForm" method="post" action="${webscr}" style="display:none">
    <input type="hidden" name="cmd" value="_xclick">
    <input type="hidden" name="business" value="${ppEmail}">
    <input type="hidden" name="item_name" value="${(p.name || 'Producto').replace(/"/g,'&quot;')}">
    <input type="hidden" name="amount" value="${Number(p.price).toFixed(2)}">
    <input type="hidden" name="currency_code" value="${p.currency}">
    <input type="hidden" name="invoice" value="">
    <input type="hidden" name="custom" value="">
    <input type="hidden" name="notify_url" value="${ipnNotify}">
    <input type="hidden" name="return" value="">
    <input type="hidden" name="cancel_return" value="">
    <input type="hidden" name="no_shipping" value="1">
    <input type="hidden" name="rm" value="1"><!-- GET en return -->
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
            <small>Pago directo al correo ${ppEmail}. La factura se marcará pagada al llegar la notificación (IPN).</small>
          </div>
        </div>` : ``}
      ${(!ppApiEnabled && !ppIpnEnabled) ? `<div class="muted">PayPal no está configurado por el administrador.</div>` : ``}
    </div>
  </div>

<script>
  // Animaciones + tema + flujo PayPal (igual que antes)
  (function(){
    const sky = document.getElementById('sky');
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

    const apiReady = ${ppApiEnabled ? 'true' : 'false'};
    const ipnReady = ${ppIpnEnabled ? 'true' : 'false'};
    const pid = ${p.id};
    const base = ${JSON.stringify(base)};
    const disabledReason = ${JSON.stringify(disableReason)};
    const modal = document.getElementById('ppModal');
    const ppBtn = document.getElementById('paypalBtn');

    function openModal(){ modal.classList.add('show'); modal.setAttribute('aria-hidden','false'); }
    function closeModal(){ modal.classList.remove('show'); modal.setAttribute('aria-hidden','true'); }

    if (disabledReason && ppBtn) { ppBtn.disabled = true; ppBtn.title = disabledReason; }
    ppBtn?.addEventListener('click', ()=>{
      if (disabledReason) { alert(disabledReason); return; }
      if (!apiReady && !ipnReady) { alert('PayPal no está disponible.'); return; }
      if (apiReady && ipnReady) openModal();
      else if (apiReady) startAndGo('api');
      else startAndGo('ipn');
    });
    document.getElementById('ppClose')?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e)=>{ if(e.target.id==='ppModal') closeModal(); });
    document.getElementById('ppOptApi')?.addEventListener('click', ()=> startAndGo('api'));
    document.getElementById('ppOptIpn')?.addEventListener('click', ()=> startAndGo('ipn'));
    window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeModal(); });

    async function startAndGo(kind){
      try{
        const body = new URLSearchParams();
        body.set('id', String(pid));
        const r = await fetch('/product/paypal/start', {
          method: 'POST',
          headers: { 'Content-Type':'application/x-www-form-urlencoded' },
          body: body.toString(),
          credentials: 'same-origin'
        });

        const ct = (r.headers.get('content-type') || '').toLowerCase();
        const data = ct.includes('application/json') ? await r.json() : { ok:false, error:'Respuesta no válida del servidor' };
        if (!data.ok) throw new Error(data.error || 'No se pudo iniciar el pago.');

        const invoiceId = data.invoice_id;
        const invNumber = data.number;

        if (kind==='api'){
          document.querySelector('#ppApiForm input[name="invoice_id"]').value = String(invoiceId);
          document.getElementById('ppApiForm').submit();
        }else{
          const f = document.getElementById('ppIpnForm');
          const attempt = Date.now().toString(36);
          f.invoice.value = String(invNumber || ('INV-' + invoiceId)) + '-' + attempt;
          f.custom.value  = String(invoiceId);
          f.return.value  = base + '/invoices/confirm/' + String(invoiceId) + '?paid=paypal_ipn';
          f.cancel_return.value = base + '/invoices/confirm/' + String(invoiceId) + '?canceled=1';
          f.submit();
        }
      }catch(e){
        alert('Error: ' + e.message);
      }finally{
        closeModal();
      }
    }
  })();
</script>
</body>
</html>`);
});

/* ===== POST pagar con créditos (compra directa) =====
   Descuenta stock SOLO si se paga (transacción) y bloquea pago único ya adquirido.
   FIX: reusa factura pendiente (por product_id O service_id) y limpia duplicadas. */
router.post("/product/buy", ensureAuth, async (req, res) => {
  ensureSchema();
  const u = req.session.user;
  const id = Number(req.body?.id || 0);
  const p = db.prepare(`SELECT * FROM products WHERE id=? AND active=1`).get(id);
  if (!p) return res.status(400).send("Producto inválido");

  const isOneTime = String(p.billing_type) === "one_time" || Number(p.period_minutes) === 0;

  // Bloqueo: pago único ya activo
  if (isOneTime) {
    const hasActive = !!db.prepare(`SELECT 1 FROM services WHERE user_id=? AND product_id=? AND status='active'`).get(u.id, p.id);
    if (hasActive) return res.status(400).send("Este producto de pago único ya fue adquirido.");
  }

  // Bloqueo: sin stock
  const outOfStock = (typeof p.stock === "number") && p.stock === 0;
  if (outOfStock) return res.status(400).send("Sin stock.");

  // Saldo
  const cur = p.currency;
  const bal = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency=?`).get(u.id, cur)?.balance || 0;
  if (bal < p.price) return res.status(400).send("Saldo insuficiente");

  const now = new Date();
  const pm = Number(p.period_minutes || 43200);
  const isRecurring = !isOneTime;
  const nextDue = isRecurring ? new Date(now.getTime() + pm * 60 * 1000) : new Date(FAR_FUTURE); // para únicos, muy lejos

  try {
    const result = db.transaction(() => {
      // 1) Stock
      if (typeof p.stock === "number" && p.stock >= 0) {
        const upd = db.prepare(`
          UPDATE products
          SET stock = stock - 1
          WHERE id=? AND stock > 0
        `).run(p.id);
        if (upd.changes === 0) throw new Error("Sin stock.");
      }

      // 2) Descuenta créditos
      db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`).run(u.id, cur);
      db.prepare(`UPDATE credits SET balance = balance - ? WHERE user_id=? AND currency=?`).run(p.price, u.id, cur);

      // 3) Servicio
      let svc = db.prepare(`SELECT * FROM services WHERE user_id=? AND product_id=?`).get(u.id, p.id);
      if (!svc) {
        db.prepare(`
          INSERT INTO services(user_id,product_id,period_minutes,next_invoice_at,status)
          VALUES(?,?,?,?, 'active')
        `).run(u.id, p.id, isRecurring ? pm : 0, nextDue.toISOString());
        svc = db.prepare(`SELECT * FROM services WHERE user_id=? AND product_id=?`).get(u.id, p.id);
      } else {
        db.prepare(`
          UPDATE services SET period_minutes=?, next_invoice_at=?, status='active' WHERE id=?
        `).run(isRecurring ? pm : 0, nextDue.toISOString(), svc.id);
      }

      const nowISO = now.toISOString();
      const cycleEndISO = isRecurring ? nextDue.toISOString() : nowISO;

      // 4) Reutilizar factura pendiente (product_id O service_id)
      let inv = db.prepare(`
        SELECT * FROM invoices
        WHERE user_id=? AND (product_id=? OR service_id=?) AND status IN ('pending','unpaid','overdue')
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
      `).get(u.id, p.id, svc.id);

      if (inv) {
        // Marcar como pagada por créditos y vincular al servicio
        db.prepare(`
          UPDATE invoices
          SET status='paid',
              payment_method='credits',
              due_at=?,
              paid_at=?,
              cycle_end_at=?,
              service_id=?,
              external_id=NULL
          WHERE id=?
        `).run(nowISO, nowISO, cycleEndISO, svc.id, inv.id);
      } else {
        // Crear nueva factura pagada y vincular al servicio
        const number = nextInvoiceNumber();
        db.prepare(`
          INSERT INTO invoices
            (number,user_id,product_id,service_id,amount,currency,status,payment_method,external_id,created_at,due_at,paid_at,cycle_end_at)
          VALUES (?,?,?,?,?,?,'paid','credits',NULL,?,?,?,?)
        `).run(number, u.id, p.id, svc.id, p.price, cur, nowISO, nowISO, nowISO, cycleEndISO);
        inv = db.prepare(`SELECT * FROM invoices WHERE number=?`).get(number);
      }

      // Limpiar otras pendientes del mismo producto/servicio (si hubiera)
      const leftovers = db.prepare(`
        SELECT id, external_id FROM invoices
        WHERE user_id=? AND (product_id=? OR service_id=?) AND status IN ('pending','unpaid','overdue') AND id<>?
      `).all(u.id, p.id, svc.id, inv.id);
      leftovers.forEach(r => {
        tryDeletePDF(r.external_id);
        db.prepare(`DELETE FROM invoices WHERE id=?`).run(r.id);
      });

      return { invoiceId: inv.id, number: inv.number, createdAt: nowISO, cycleEnd: cycleEndISO };
    })();

    // Datos para PDF
    const user = db.prepare(`SELECT id,username,name,surname,email,phone FROM users WHERE id=?`).get(u.id);
    const site = get("site_name", "SkyShop");
    const logo = get("logo_url", "");

    try {
      await createInvoicePDF({
        number: result.number, site, logoUrl: logo, user, product: p,
        amount: p.price, currency: cur, createdAt: result.createdAt, cycleEnd: result.cycleEnd,
      });
      const rel = `/uploads/invoices/${result.number}.pdf`;
      db.prepare(`UPDATE invoices SET external_id=? WHERE id=?`).run(rel, result.invoiceId);
    } catch (err) {
      console.error("PDF error:", err);
    }

    res.redirect(`/invoices/confirm/${result.invoiceId}`);
  } catch (e) {
    res.status(400).send(String(e?.message || "Error en el pago"));
  }
});

/* ===== POST /product/paypal/start =====
   Crea (o reutiliza) una factura PENDIENTE para el producto.
   NOTA: No descuenta stock aquí; debe descontarse al marcar la factura como 'paid'
   en tus controladores de PayPal API/IPN (para evitar reservas que no se pagan). */
router.post(
  "/product/paypal/start",
  ensureAuth,
  express.urlencoded({ extended: true }),
  (req, res) => {
    try {
      const u = req.session.user;
      const pid = Number((req.body && req.body.id) || req.query.id || 0);
      if (!pid) return res.json({ ok: false, error: "Producto inválido" });

      const p = db.prepare(`SELECT * FROM products WHERE id=? AND active=1`).get(pid);
      if (!p) return res.json({ ok: false, error: "Producto no encontrado" });

      const isOneTime = String(p.billing_type) === "one_time" || Number(p.period_minutes) === 0;
      const userHasActive = !!db.prepare(`SELECT 1 FROM services WHERE user_id=? AND product_id=? AND status='active'`).get(u.id, p.id);
      if (isOneTime && userHasActive) {
        return res.json({ ok: false, error: "Este producto de pago único ya fue adquirido." });
      }

      const outOfStock = (typeof p.stock === "number") && p.stock === 0;
      if (outOfStock) {
        return res.json({ ok: false, error: "Sin stock." });
      }

      // Reutiliza la última PENDIENTE; si no, crea una con "number"
      let inv = db.prepare(`
        SELECT * FROM invoices
        WHERE user_id=? AND product_id=? AND status IN ('pending','unpaid','overdue')
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
      `).get(u.id, pid);

      if (!inv) {
        const nowISO = new Date().toISOString();
        const number = nextInvoiceNumber();
        db.prepare(`
          INSERT INTO invoices(number,user_id,product_id,amount,currency,status,created_at)
          VALUES(?,?,?,?,?,'pending',?)
        `).run(number, u.id, pid, p.price, p.currency, nowISO);
        inv = db.prepare(`SELECT * FROM invoices WHERE number=?`).get(number);
      }

      if (!inv) return res.json({ ok: false, error: "No se pudo generar la factura" });
      res.json({ ok: true, invoice_id: inv.id, number: inv.number });
    } catch (e) {
      console.error("paypal/start error:", e);
      res.status(500).json({ ok: false, error: "Error creando factura" });
    }
  }
);

module.exports = router;
