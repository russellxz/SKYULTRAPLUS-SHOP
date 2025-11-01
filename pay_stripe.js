// pay_stripe.js — Stripe Checkout (crea sesión + webhook) con validación de mínimos + soporte de productos COMPARTIDOS
"use strict";

const express = require("express");
const db = require("./db");
const router = express.Router();

const getS = (k, d = "") => {
  try { return db.getSetting ? db.getSetting(k, d) : (db.prepare(`SELECT value FROM settings WHERE key=?`).get(k)?.value ?? d); }
  catch { return d; }
};
function absoluteBase(req){
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host  = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
}
function ensureAuth(req, res, next){
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}
const escapeHtml = (s) => String(s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FAR_FUTURE = "2099-12-31T00:00:00.000Z";

const MINIMUMS = { usd: 0.50, mxn: 10.00 };

let stripe = null;
function getStripe(){
  if (stripe) return stripe;
  const sk = getS("stripe_sk", "");
  if (!sk) return null;
  stripe = require("stripe")(sk);
  return stripe;
}

/* ===== helpers para productos compartidos ===== */
function countPoolAvailable(productId){
  const r = db.prepare(`
    SELECT COUNT(*) AS n
    FROM product_shared_items
    WHERE product_id=? AND revealed_to_user_id IS NULL
  `).get(productId);
  return Number(r?.n || 0);
}
function assignNextSharedItem(productId, userId){
  const nowISO = new Date().toISOString();
  return db.transaction(()=>{
    const row = db.prepare(`
      SELECT id, content, order_index
      FROM product_shared_items
      WHERE product_id=? AND revealed_to_user_id IS NULL
      ORDER BY order_index ASC
      LIMIT 1
    `).get(productId);
    if (!row) throw new Error("No hay información disponible para entregar.");

    db.prepare(`
      UPDATE product_shared_items
      SET revealed_to_user_id=?, revealed_at=?
      WHERE id=?
    `).run(userId, nowISO, row.id);

    return { content: row.content, order_index: row.order_index, revealed_at: nowISO };
  })();
}

/* ===== GET /pay/stripe — crea sesión de Checkout =====
 * Soporta:
 *   - /pay/stripe?invoice_id=XXX  (pago de factura EXISTENTE)
 *   - /pay/stripe?pid=XXX         (compra directa / o pago desde factura si aún mandan pid)
 */
router.get("/stripe", ensureAuth, async (req, res) => {
  const enabled = getS("stripe_enabled", "0") === "1";
  const pk = getS("stripe_pk", "");
  const sk = getS("stripe_sk", "");
  if (!enabled || !pk || !sk){
    return res.status(400).type("html").send(
      `<div style="font-family:system-ui;padding:16px"><h2>Stripe no está configurado</h2>
        <p>Ve a <b>Admin → Stripe</b> y guarda PK/SK/Webhook.</p></div>`
    );
  }

  const u = req.session.user;
  const base = absoluteBase(req);

  /* ---------- RUTA A: pagar una FACTURA existente ---------- */
  const invoiceId = Number(req.query.invoice_id || 0);
  if (invoiceId) {
    const inv = db.prepare(`
      SELECT i.*, p.name AS p_name
      FROM invoices i
      LEFT JOIN products p ON p.id=i.product_id
      WHERE i.id=? AND i.user_id=? AND i.status IN ('pending','unpaid','overdue')
      LIMIT 1
    `).get(invoiceId, u.id);
    if (!inv) return res.status(404).type("text/plain").send("Factura no encontrada o no pagable.");

    const currency = String(inv.currency||"USD").toUpperCase();
    const curLower = currency.toLowerCase();
    const amount   = Number(inv.amount||0);
    const min = MINIMUMS[curLower] ?? 0.50;
    if (amount < min){
      return res.type("html").send(`<!doctype html><meta charset="utf-8">
        <div style="font-family:system-ui;max-width:680px;margin:32px auto;padding:16px">
          <h2 style="margin:0 0 8px">Importe demasiado bajo para Stripe</h2>
          <p>Stripe exige un mínimo de <b>${currency} ${min.toFixed(2)}</b>. 
          Esta factura es de <b>${currency} ${amount.toFixed(2)}</b>.</p>
          <p><a href="/invoices/pay/${inv.id}">← Volver a la factura</a></p>
        </div>`);
    }

    try{
      const cli = getStripe();
      if (!cli) throw new Error("Stripe no inicializado");

      const session = await cli.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: curLower,
            product_data: { name: inv.p_name || `Factura #${inv.number || inv.id}` },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        allow_promotion_codes: false,
        metadata: {
          invoice_id: String(inv.id),
          product_id: String(inv.product_id || ""),
          user_id: String(u.id),
        },
        payment_intent_data: {
          metadata: {
            invoice_id: String(inv.id),
            product_id: String(inv.product_id || ""),
            user_id: String(u.id),
          }
        },
        success_url: `${base}/invoices/confirm/${inv.id}?paid=stripe`,
        cancel_url:  `${base}/invoices/confirm/${inv.id}?canceled=1`,
      });

      if (session?.url) return res.redirect(303, session.url);
      throw new Error("No se pudo obtener la URL de Stripe Checkout.");
    }catch(err){
      const code = err?.raw?.code || err?.code || "";
      const msg  = err?.raw?.message || err?.message || "Error creando sesión";
      const reqLog = err?.raw?.request_log_url || err?.request_log_url || "";
      console.error("[stripe] create-session (invoice) error:", { code, msg, request_log_url: reqLog });

      return res.status(400).type("html").send(`<!doctype html><meta charset="utf-8">
        <div style="font-family:system-ui;max-width:680px;margin:32px auto;padding:16px">
          <h2 style="margin:0 0 8px">No se pudo iniciar el pago con Stripe</h2>
          <p style="color:#ef4444"><b>${escapeHtml(msg)}</b></p>
          ${reqLog ? `<p class="muted" style="color:#6b7280">Log de Stripe: <a href="${escapeHtml(reqLog)}" target="_blank" rel="noopener">ver</a></p>` : ""}
          <p><a href="/invoices/pay/${invoiceId}">← Volver a la factura</a></p>
        </div>`);
    }
  }

  /* ---------- RUTA B: compra directa / o desde factura con pid ---------- */
  const pid = Number(req.query.pid || 0);
  if (!pid) return res.status(400).type("text/plain").send("Parámetros inválidos");

  const p = db.prepare(`SELECT * FROM products WHERE id=? AND active=1`).get(pid);
  if (!p) return res.status(404).type("text/plain").send("Producto no encontrado");

  const isShared   = String(p.delivery_mode || "single") === "shared";
  const isOneTime  = String(p.billing_type) === "one_time" || Number(p.period_minutes) === 0;
  const isRecurring= !isOneTime;

  // ¿Existe YA una factura pendiente del mismo producto?
  const invPending = db.prepare(`
    SELECT * FROM invoices
    WHERE user_id=? AND product_id=? AND status IN ('pending','unpaid','overdue')
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 1
  `).get(u.id, p.id);

  // Si NO hay factura pendiente, aplicamos tus bloqueos/stock como siempre
  if (!invPending) {
    // Bloqueos de recompra (igual que product.js):
    // - single + one_time: bloquea si ya tiene activo
    // - shared + one_time: PERMITE múltiples compras
    // - cualquier recurrente: bloquea si ya tiene activo
    if ((!isShared && isOneTime) || isRecurring){
      const hasActive = !!db.prepare(`SELECT 1 FROM services WHERE user_id=? AND product_id=? AND status='active'`)
        .get(u.id, p.id);
      if (hasActive){
        return res.status(400).type("html").send(
          `<!doctype html><meta charset="utf-8"><div style="font-family:system-ui;max-width:680px;margin:32px auto;padding:16px">
            <h2 style="margin:0 0 8px">No disponible</h2>
            <p>${isOneTime ? "Este producto de pago único ya fue adquirido." : "Este servicio ya está activo."}</p>
            <p><a href="/product?id=${p.id}">← Volver al producto</a></p>
          </div>`
        );
      }
    }

    // Disponibilidad (sólo para compras nuevas)
    if (isShared){
      if (countPoolAvailable(p.id) <= 0){
        return res.status(400).type("html").send(`<!doctype html><meta charset="utf-8">
          <div style="font-family:system-ui;max-width:680px;margin:32px auto;padding:16px">
            <h2 style="margin:0 0 8px">Sin información disponible</h2>
            <p>Este producto compartido no tiene elementos disponibles por ahora.</p>
            <p><a href="/product?id=${p.id}">← Volver al producto</a></p>
          </div>`);
      }
    }else{
      const outOfStock = (typeof p.stock === "number") && p.stock === 0;
      if (outOfStock){
        return res.status(400).type("html").send(`<!doctype html><meta charset="utf-8">
          <div style="font-family:system-ui;max-width:680px;margin:32px auto;padding:16px">
            <h2 style="margin:0 0 8px">Sin stock</h2>
            <p>Este producto no tiene unidades disponibles.</p>
            <p><a href="/product?id=${p.id}">← Volver al producto</a></p>
          </div>`);
      }
    }
  }

  // En este punto:
  //   - si invPending existe: vamos a pagar ESA factura (saltando bloqueos/stock)
  //   - si no existe: creamos/reutilizamos como antes
  let inv = invPending;
  if (!inv){
    const currency = String(p.currency || getS("stripe_currency","USD") || "USD").toUpperCase();
    const curLower = currency.toLowerCase();
    const price = Number(p.price || 0);
    const min = MINIMUMS[curLower] ?? 0.50;

    if (price < min){
      return res.type("html").send(`<!doctype html><meta charset="utf-8">
        <div style="font-family:system-ui;max-width:680px;margin:32px auto;padding:16px">
          <h2 style="margin:0 0 8px">Importe demasiado bajo para Stripe</h2>
          <p>Stripe exige un mínimo de <b>${currency} ${min.toFixed(2)}</b>. 
          Este producto cuesta <b>${currency} ${price.toFixed(2)}</b>.</p>
          <p><a href="/product?id=${p.id}">← Volver al producto</a></p>
        </div>`);
    }

    // Reutiliza o crea factura PENDIENTE
    inv = db.prepare(`
      SELECT * FROM invoices
      WHERE user_id=? AND product_id=? AND status IN ('pending','unpaid','overdue')
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `).get(u.id, p.id);

    if (!inv){
      const number = (() => {
        const now = new Date();
        const ym = now.toISOString().slice(0,7).replace("-","");
        const seq = db.transaction(() => {
          db.prepare(`INSERT OR IGNORE INTO settings(key,value) VALUES('invoice_seq','0')`).run();
          db.prepare(`UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key='invoice_seq'`).run();
          return parseInt(db.prepare(`SELECT value FROM settings WHERE key='invoice_seq'`).get().value,10) || 1;
        })();
        return `INV-${ym}-${String(seq).padStart(4,"0")}`;
      })();
      const nowISO = new Date().toISOString();
      db.prepare(`
        INSERT INTO invoices(number,user_id,product_id,amount,currency,status,created_at)
        VALUES(?,?,?,?,?,'pending',?)
      `).run(number, u.id, p.id, price, currency, nowISO);
      inv = db.prepare(`SELECT * FROM invoices WHERE number=?`).get(number);
    }
    if (!inv) return res.status(500).type("text/plain").send("No se pudo generar la factura");
  }

  // Crear sesión con los datos correctos (si invPending, usar montos/moneda de la factura)
  const curUpper = String(inv.currency || p.currency || "USD").toUpperCase();
  const curLower = curUpper.toLowerCase();
  const amount   = Number(inv.amount || p.price || 0);

  try{
    const cli = getStripe();
    if (!cli) throw new Error("Stripe no inicializado");

    const session = await cli.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: curLower,
          product_data: { name: (p.name || inv.number || `Producto #${p.id}`) },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      allow_promotion_codes: false,
      metadata: { invoice_id: String(inv.id), product_id: String(p.id), user_id: String(u.id) },
      payment_intent_data: {
        metadata: { invoice_id: String(inv.id), product_id: String(p.id), user_id: String(u.id) }
      },
      success_url: `${base}/invoices/confirm/${inv.id}?paid=stripe`,
      cancel_url:  `${base}/invoices/confirm/${inv.id}?canceled=1`,
    });

    if (session?.url) return res.redirect(303, session.url);
    throw new Error("No se pudo obtener la URL de Stripe Checkout.");
  }catch(err){
    const code = err?.raw?.code || err?.code || "";
    const msg  = err?.raw?.message || err?.message || "Error creando sesión";
    const reqLog = err?.raw?.request_log_url || err?.request_log_url || "";
    console.error("[stripe] create-session error:", { code, msg, request_log_url: reqLog });

    let extra = "";
    const min = MINIMUMS[curLower] ?? 0.50;
    if (code === "amount_too_small"){
      const minTxt = `${curUpper} ${min.toFixed(2)}`;
      extra = `<p>Stripe requiere un importe mínimo de <b>${minTxt}</b> para esta moneda.</p>`;
    }

    return res.status(400).type("html").send(`<!doctype html><meta charset="utf-8">
      <div style="font-family:system-ui;max-width:680px;margin:32px auto;padding:16px">
        <h2 style="margin:0 0 8px">No se pudo iniciar el pago con Stripe</h2>
        <p style="color:#ef4444"><b>${escapeHtml(msg)}</b></p>
        ${extra}
        ${reqLog ? `<p class="muted" style="color:#6b7280">Log de Stripe: <a href="${escapeHtml(reqLog)}" target="_blank" rel="noopener">ver</a></p>` : ""}
        <p><a href="/product?id=${p.id}">← Volver al producto</a></p>
      </div>`);
  }
});

/* ===== Webhook: ***usar body RAW*** para verificar firma ===== */
router.post("/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const whsec = getS("stripe_webhook_secret", "");
  if (!whsec){
    console.warn("[stripe] webhook: sin whsec configurado");
    return res.status(200).send("OK");
  }
  const stripe = getStripe();
  let event = req.body;

  try{
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], whsec);
  }catch (err){
    console.warn("[stripe] webhook verify error:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try{
    if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded"){
      const obj = event.data?.object || {};
      const md = obj.metadata || obj.payment_intent?.metadata || {};
      const invoiceId = Number(md.invoice_id || 0);
      const productId = Number(md.product_id || 0);
      const userId = Number(md.user_id || 0);

      if (invoiceId){
        const inv = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(invoiceId);
        const p = productId ? db.prepare(`SELECT * FROM products WHERE id=?`).get(productId) : null;
        if (!inv || !p){ return res.status(200).send("OK"); }

        const isShared   = String(p.delivery_mode || "single") === "shared";
        const isOneTime  = String(p.billing_type) === "one_time" || Number(p.period_minutes) === 0;
        const isRecurring= !isOneTime;

        const now = new Date();
        const nowISO = now.toISOString();
        const pm = Number(p.period_minutes || 43200);
        const nextDue = isRecurring ? new Date(now.getTime() + pm*60*1000) : now;
        const cycleEndISO = isRecurring ? nextDue.toISOString() : nowISO;

        db.transaction(() => {
          // 1) Stock solo para SINGLE (se conserva tu lógica original)
          if (!isShared && typeof p.stock === "number" && p.stock >= 0) {
            db.prepare(`UPDATE products SET stock = stock - 1 WHERE id=? AND stock > 0`).run(p.id);
          }

          // 2) Crear/actualizar service:
          //   - SINGLE + ÚNICO: sí crea service (bloquea recompra).
          //   - SHARED + ÚNICO: NO crea service (permite recompras).
          //   - Cualquier RECURRENTE: crea/actualiza service.
          let serviceId = null;
          if ((!isShared && isOneTime) || isRecurring){
            db.prepare(`
              INSERT INTO services(user_id,product_id,period_minutes,next_invoice_at,status)
              VALUES(?,?,?,?, 'active')
              ON CONFLICT(user_id,product_id) DO UPDATE SET
                period_minutes=excluded.period_minutes,
                next_invoice_at=excluded.next_invoice_at,
                status='active'
            `).run(userId, p.id, isRecurring ? pm : 0, isRecurring ? nextDue.toISOString() : FAR_FUTURE);
            const svc = db.prepare(`SELECT id FROM services WHERE user_id=? AND product_id=?`).get(userId, p.id);
            serviceId = svc?.id || null;
          }

          // 3) Marcar factura pagada y rellenar campos
          db.prepare(`
            UPDATE invoices
               SET status='paid',
                   payment_method='stripe',
                   paid_at=?,
                   due_at=?,
                   cycle_end_at=?,
                   service_id=COALESCE(?, service_id)
             WHERE id=?
          `).run(nowISO, nowISO, cycleEndISO, serviceId, invoiceId);

          // 4) Para COMPARTIDOS: asignar la siguiente info del pool
          if (isShared){
            assignNextSharedItem(p.id, userId); // lanza si no hay info
          }

          // 5) Limpiar otras pendientes del mismo usuario/producto (y service si aplica)
          const leftovers = db.prepare(`
            SELECT id, external_id FROM invoices
            WHERE user_id=? AND (product_id=? ${serviceId ? "OR service_id="+serviceId : ""})
              AND status IN ('pending','unpaid','overdue') AND id<>?
          `).all(userId, p.id, invoiceId);
          leftovers.forEach(r => {
            try{
              if (r.external_id) {
                const rel = String(r.external_id).replace(/^\/+/, "");
                const abs = require("path").resolve(process.cwd(), rel);
                const safe = require("path").resolve(process.cwd(), "uploads", "invoices");
                if (abs.startsWith(safe) && require("fs").existsSync(abs)) require("fs").unlinkSync(abs);
              }
            }catch{}
            db.prepare(`DELETE FROM invoices WHERE id=?`).run(r.id);
          });
        })();
      }
    }
  }catch(e){
    console.error("[stripe] webhook handler error:", e?.message || e);
  }

  return res.status(200).send("OK");
});

module.exports = router;
