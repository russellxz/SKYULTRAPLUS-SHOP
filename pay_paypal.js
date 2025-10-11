// pay_paypal.js — Pasarela PayPal (Orders API + IPN real)
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
const enabled = (k) => String(db.getSetting(k, "0")) === "1";

function apiRoot() {
  return get("paypal_api_mode", "sandbox") === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}
function isLive() {
  return get("paypal_api_mode", "sandbox") === "live";
}
function baseUrl(req) {
  const proto =
    (req.headers["x-forwarded-proto"] || "").split(",")[0] ||
    (req.secure ? "https" : "http");
  const host =
    req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${proto}://${host}`;
}
async function getAccessToken() {
  const cid = get("paypal_api_client_id", "");
  const sec = get("paypal_api_secret", "");
  const r = await fetch(apiRoot() + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(cid + ":" + sec).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error("OAuth " + r.status);
  return (await r.json()).access_token;
}
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso || "";
  }
}
function esc(s) {
  return String(s == null ? "" : s);
}

/* === generar PDF simple (igual estilo a invoices.js) === */
async function createInvoicePDF(inv, user, product, site, logoUrl) {
  const number = inv.number || `INV-${inv.id}`;
  const dir = path.join(process.cwd(), "uploads", "invoices");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  const outFile = path.join(dir, `${number}.pdf`);

  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const stream = fs.createWriteStream(outFile);
  doc.pipe(stream);

  doc.rect(0, 0, doc.page.width, 90).fill("#0b1220");
  try {
    if (logoUrl && /^\/uploads\//.test(logoUrl)) {
      const absLogo = path.join(process.cwd(), logoUrl.replace(/^\//, ""));
      if (fs.existsSync(absLogo)) doc.image(absLogo, 36, 18, { height: 54 });
    }
  } catch {}
  doc.fillColor("#fff").fontSize(20).text(get("site_name", "SkyShop"), 0, 24, { align: "right" });
  const numberTxt = inv.number || `INV-${inv.id}`;
  doc.fontSize(11).text(`Factura: ${numberTxt}`, 0, 48, { align: "right" });
  doc.text(`Fecha: ${fmtDate(inv.created_at)}`, 0, 64, { align: "right" });

  const paid = inv.status === "paid";
  doc.save();
  doc.roundedRect(36, 100, 120, 24, 8).fill(paid ? "#16a34a" : "#f59e0b");
  doc
    .fillColor("#fff")
    .fontSize(12)
    .text(paid ? "PAGADO" : "PENDIENTE", 36, 104, { width: 120, align: "center" });
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
  if (inv.due_at) doc.text(`Vence: ${fmtDate(inv.due_at)}`);

  doc.moveDown(1);
  doc.fillColor("#111827").fontSize(16).text("Resumen");
  doc.fillColor("#0b1220").fontSize(13);
  doc.text(`Total: ${inv.currency} ${Number(inv.amount).toFixed(2)}`);

  doc.end();
  await new Promise((res, rej) => {
    stream.on("finish", res);
    stream.on("error", rej);
  });

  return `/uploads/invoices/${numberTxt}.pdf`;
}

/* =========================================================
   ===============  CHECKOUT – PAYPAL API  =================
   ========================================================= */
router.post("/pay/paypal/api/create", ensureAuth, async (req, res) => {
  try {
    if (!enabled("paypal_api_enabled"))
      return res.status(400).send("PayPal API está deshabilitado.");
    const cid = get("paypal_api_client_id", "");
    const sec = get("paypal_api_secret", "");
    if (!cid || !sec)
      return res
        .status(400)
        .send("Falta Client ID/Secret en ajustes de PayPal.");

    const u = req.session.user;
    const invoice_id = Number(req.body?.invoice_id || 0);
    if (!invoice_id) return res.status(400).send("Falta invoice_id");

    const inv = db
      .prepare(`SELECT * FROM invoices WHERE id=? AND user_id=?`)
      .get(invoice_id, u.id);
    if (!inv) return res.status(404).send("Factura no encontrada");
    if (String(inv.status).toLowerCase() === "paid")
      return res.status(409).send("Esta factura ya está pagada.");

    const site = get("site_name", "SkyShop");
    const access = await getAccessToken();

    const desc =
      inv.description ||
      (inv.product_id
        ? db.prepare(`SELECT name FROM products WHERE id=?`).get(inv.product_id)
            ?.name || "Producto"
        : "Factura");

    const orderBody = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: "inv-" + inv.id,
          custom_id: String(inv.id),
          // Usar un invoice_id único para evitar DUPLICATE_INVOICE_ID al reintentar
          invoice_id: (inv.number || `INV-${inv.id}`) + "-" + Date.now(),
          description: desc,
          amount: {
            currency_code: inv.currency,
            value: Number(inv.amount).toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: site.slice(0, 127),
        user_action: "PAY_NOW",
        return_url:
          baseUrl(req) + `/pay/paypal/return?invoice_id=${inv.id}`,
        cancel_url:
          baseUrl(req) + `/pay/paypal/cancel?invoice_id=${inv.id}`,
      },
    };

    const r = await fetch(apiRoot() + "/v2/checkout/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + access,
      },
      body: JSON.stringify(orderBody),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("PayPal create error:", data);
      return res.status(500).send("No se pudo crear la orden PayPal.");
    }

    const approve = (data.links || []).find((l) => l.rel === "approve")?.href;
    if (!approve)
      return res.status(500).send("Respuesta PayPal sin link de aprobación.");

    return res.redirect(302, approve);
  } catch (e) {
    console.error(e);
    res.status(500).send("ERR: " + e.message);
  }
});

/* === Return (captura) === */
router.get("/pay/paypal/return", ensureAuth, async (req, res) => {
  const u = req.session.user;
  const invoice_id = Number(req.query.invoice_id || 0);
  const token = String(req.query.token || ""); // order ID

  if (!invoice_id || !token) return res.status(400).send("Faltan parámetros.");
  try {
    if (!enabled("paypal_api_enabled"))
      return res.status(400).send("PayPal API deshabilitado.");
    const inv = db
      .prepare(`SELECT * FROM invoices WHERE id=? AND user_id=?`)
      .get(invoice_id, u.id);
    if (!inv) return res.status(404).send("Factura no encontrada.");

    if (String(inv.status).toLowerCase() === "paid") {
      return res.redirect(`/invoices/pay/${invoice_id}`);
    }

    const access = await getAccessToken();
    const cap = await fetch(apiRoot() + `/v2/checkout/orders/${token}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + access },
    });
    const data = await cap.json();
    if (!cap.ok) {
      console.error("PayPal capture error:", data);
      return res.status(500).send("No se pudo capturar el pago.");
    }

    const status = data.status; // COMPLETED
    const pu = (data.purchase_units && data.purchase_units[0]) || {};
    const amount = pu.payments?.captures?.[0]?.amount || pu.amount || {};
    const value = Number(amount.value || 0);
    const curr = amount.currency_code || inv.currency;

    if (status !== "COMPLETED") return res.status(400).send("Pago no completado en PayPal.");
    if (curr !== inv.currency || Math.abs(value - Number(inv.amount)) > 0.01) {
      console.warn("Monto/currency no coinciden con la factura", { curr, value, inv });
    }

    const now = new Date().toISOString();
    const number = inv.number || db.nextInvoiceNumber();

    db.transaction(() => {
      db.prepare(
        `UPDATE invoices SET number=?, status='paid', payment_method='paypal', paid_at=? WHERE id=?`
      ).run(number, now, invoice_id);
    })();

    // Crear PDF si falta
    try {
      const inv2 = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(invoice_id);
      let pdfUrl = inv2.external_id;
      if (!pdfUrl) {
        const product = inv2.product_id
          ? db.prepare(`SELECT * FROM products WHERE id=?`).get(inv2.product_id)
          : null;
        const user = db
          .prepare(`SELECT id,username,name,surname,email,phone FROM users WHERE id=?`)
          .get(u.id);
        const site = get("site_name", "SkyShop");
        const logo = get("logo_url", "");
        const url = await createInvoicePDF(inv2, user, product, site, logo);
        db.prepare(`UPDATE invoices SET external_id=? WHERE id=?`).run(url, invoice_id);
      }
    } catch (e) {
      console.error("PDF error:", e);
    }

    return res.redirect(`/invoices/pay/${invoice_id}`);
  } catch (e) {
    console.error(e);
    res.status(500).send("ERR: " + e.message);
  }
});

/* === Cancel (API) === */
router.get("/pay/paypal/cancel", ensureAuth, (req, res) => {
  const invoice_id = Number(req.query.invoice_id || 0);
  return res.redirect(invoice_id ? `/invoices/pay/${invoice_id}` : "/invoices");
});

/* =========================================================
   ===============  CHECKOUT – PAYPAL IPN  =================
   ========================================================= */

/* 1) El botón “IPN” del UI envía aquí.
   Este endpoint arma el formulario real a PayPal usando tu correo y pone
   notify_url / return / cancel correctamente. */
router.post("/pay/paypal/ipn/checkout", ensureAuth, (req, res) => {
  if (!enabled("paypal_ipn_enabled")) return res.status(400).send("PayPal IPN deshabilitado.");
  const email = get("paypal_ipn_email", "");
  if (!email) return res.status(400).send("Falta correo IPN en ajustes.");
  const u = req.session.user;
  const invoice_id = Number(req.body?.invoice_id || 0);
  if (!invoice_id) return res.status(400).send("Falta invoice_id");

  const inv = db
    .prepare(`SELECT * FROM invoices WHERE id=? AND user_id=?`)
    .get(invoice_id, u.id);
  if (!inv) return res.status(404).send("Factura no encontrada");
  if (String(inv.status).toLowerCase() === "paid")
    return res.redirect(`/invoices/pay/${invoice_id}`);

  const webscr = isLive()
    ? "https://www.paypal.com/cgi-bin/webscr"
    : "https://www.sandbox.paypal.com/cgi-bin/webscr";

  const retOk = baseUrl(req) + `/pay/paypal/ok?invoice_id=${inv.id}`;
  const retCancel = baseUrl(req) + `/pay/paypal/cancel_ipn?invoice_id=${inv.id}`;
  const notify = baseUrl(req) + `/pay/paypal/ipn`;

  // Respuesta HTML con auto-submit
  res.type("html").send(`<!doctype html>
<meta charset="utf-8">
<title>Redirigiendo a PayPal…</title>
<p>Redirigiendo a PayPal…</p>
<form id="f" method="post" action="${webscr}">
  <input type="hidden" name="cmd" value="_xclick">
  <input type="hidden" name="business" value="${esc(email)}">
  <input type="hidden" name="item_name" value="${esc(inv.product_id ? (db.prepare('SELECT name FROM products WHERE id=?').get(inv.product_id)?.name || 'Factura') : 'Factura')}">
  <input type="hidden" name="amount" value="${Number(inv.amount).toFixed(2)}">
  <input type="hidden" name="currency_code" value="${inv.currency}">
  <input type="hidden" name="invoice" value="${esc(inv.number || ('INV-'+inv.id))}">
  <input type="hidden" name="custom" value="${inv.id}">
  <input type="hidden" name="notify_url" value="${notify}">
  <input type="hidden" name="return" value="${retOk}">
  <input type="hidden" name="cancel_return" value="${retCancel}">
  <input type="hidden" name="no_shipping" value="1">
  <input type="hidden" name="rm" value="2">
</form>
<script>document.getElementById('f').submit()</script>`);
});

/* 2) Página de “gracias” (no cambia estado: lo hace el IPN) */
router.get("/pay/paypal/ok", (req, res) => {
  const id = Number(req.query.invoice_id || 0);
  res.type("html").send(`<!doctype html>
<meta charset="utf-8">
<title>Gracias</title>
<body>
  <div style="max-width:820px;margin:20px auto;padding:12px;font-family:system-ui">
    <h2>Gracias. Estamos confirmando tu pago…</h2>
    <p>Tu factura: #${id}. En cuanto PayPal envíe la notificación (IPN) y se verifique, se marcará como pagada.</p>
    <p><a href="/invoices/pay/${id}">Volver a la factura</a></p>
  </div>
</body>`);
});

/* 3) Cancelación desde PayPal (IPN) */
router.get("/pay/paypal/cancel_ipn", (req, res) => {
  const id = Number(req.query.invoice_id || 0);
  res.redirect(id ? `/invoices/pay/${id}` : "/invoices");
});

/* 4) Listener IPN (VERIFICA con PayPal y actualiza factura) */
router.post(
  "/pay/paypal/ipn",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      if (!enabled("paypal_ipn_enabled")) return res.status(200).end();

      // 4.1 Verificar con PayPal
      const verifyUrl = isLive()
        ? "https://ipnpb.paypal.com/cgi-bin/webscr"
        : "https://ipnpb.sandbox.paypal.com/cgi-bin/webscr";

      // reconstruir payload + cmd=_notify-validate
      const params = new URLSearchParams(req.body);
      params.append("cmd", "_notify-validate");

      const vr = await fetch(verifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const text = (await vr.text()).trim();
      if (text !== "VERIFIED") {
        console.warn("IPN NOT VERIFIED:", text, req.body);
        return res.status(200).end(); // PayPal solo necesita 200
      }

      // 4.2 Validaciones mínimas
      const payment_status = String(req.body.payment_status || "");
      const receiver_email = String(req.body.receiver_email || req.body.business || "");
      const gross = String(req.body.mc_gross || req.body.gross_total || "");
      const currency = String(req.body.mc_currency || req.body.settle_currency || "");
      const custom = Number(req.body.custom || 0);
      const invoiceStr = String(req.body.invoice || "");
      const txn_id = String(req.body.txn_id || "");

      // Localizar la factura por custom (id) preferentemente, si no por invoice
      let inv = null;
      if (custom) {
        inv = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(custom);
      }
      if (!inv && invoiceStr) {
        inv = db.prepare(`SELECT * FROM invoices WHERE number=?`).get(invoiceStr);
      }
      if (!inv) {
        console.warn("IPN: factura no encontrada", { custom, invoiceStr });
        return res.status(200).end();
      }

      // correo destino
      const cfgEmail = get("paypal_ipn_email", "");
      if (cfgEmail && receiver_email && cfgEmail.toLowerCase() !== receiver_email.toLowerCase()) {
        console.warn("IPN: receiver_email no coincide", { cfgEmail, receiver_email });
        // Continuamos pero lo registramos; si quieres, puedes return aquí.
      }

      // status y montos
      if (payment_status !== "Completed") {
        console.warn("IPN: pago no Completed", payment_status);
        return res.status(200).end();
      }
      const amountOk =
        Math.abs(parseFloat(gross || "0") - parseFloat(inv.amount)) < 0.01 &&
        (currency || inv.currency) === inv.currency;
      if (!amountOk) {
        console.warn("IPN: monto/currency no cuadra", { gross, currency, inv });
      }

      // 4.3 Marcar pagado si no lo está
      if (String(inv.status).toLowerCase() !== "paid") {
        const now = new Date().toISOString();
        const number = inv.number || db.nextInvoiceNumber();
        db.transaction(() => {
          db.prepare(
            `UPDATE invoices SET number=?, status='paid', payment_method='paypal_ipn', paid_at=? WHERE id=?`
          ).run(number, now, inv.id);
        })();

        // PDF si falta
        try {
          const inv2 = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(inv.id);
          let pdfUrl = inv2.external_id;
          if (!pdfUrl) {
            const product = inv2.product_id
              ? db.prepare(`SELECT * FROM products WHERE id=?`).get(inv2.product_id)
              : null;
            const user = db
              .prepare(`SELECT id,username,name,surname,email,phone FROM users WHERE id=?`)
              .get(inv2.user_id);
            const site = get("site_name", "SkyShop");
            const logo = get("logo_url", "");
            const url = await createInvoicePDF(inv2, user, product, site, logo);
            db.prepare(`UPDATE invoices SET external_id=? WHERE id=?`).run(url, inv.id);
          }
        } catch (e) {
          console.error("IPN PDF error:", e);
        }
      }

      // Log útil
      console.log("IPN VERIFIED OK", { invoice: inv.id, txn_id });

      // Responder 200 siempre
      return res.status(200).end();
    } catch (e) {
      console.error("IPN error:", e);
      return res.status(200).end(); // PayPal sólo espera 200
    }
  }
);

module.exports = router;