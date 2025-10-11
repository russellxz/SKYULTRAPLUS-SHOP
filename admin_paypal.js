// admin_paypal.js — Configuración de PayPal (API/Eventos + IPN)
"use strict";

const express = require("express");
const db = require("./db");

const router = express.Router();

/* ===== middleware ===== */
function ensureAdmin(req, res, next) {
  const u = req.session && req.session.user;
  if (!u) return res.redirect("/login");
  if (!u.is_admin) return res.redirect("/");
  next();
}

/* ===== helpers ===== */
const get = (k, d = "") => db.getSetting(k, d);
const set = (k, v) => db.setSetting(k, String(v));

function bool(v) {
  return String(v) === "1" || v === 1 || v === true || v === "on";
}
function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "").split(",")[0] || (req.secure ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

/* ===== PAGE: GET /admin/paypal ===== */
router.get("/", ensureAdmin, (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  const ok = String(req.query.ok || "");

  // API/Eventos
  const api_enabled = get("paypal_api_enabled", "0") === "1";
  const api_mode = get("paypal_api_mode", "sandbox"); // sandbox | live
  const api_client_id = get("paypal_api_client_id", "");
  const api_secret_masked = get("paypal_api_secret", "") ? "••••••••••" : "";
  const api_subs = get("paypal_api_subscriptions", "0") === "1";

  // IPN
  const ipn_enabled = get("paypal_ipn_enabled", "0") === "1";
  const ipn_email = get("paypal_ipn_email", "");

  const r = (id) => (ok === id ? "" : "display:none");

  const base = baseUrl(req);
  const ipn_url = `${base}/pay/paypal/ipn`;
  const webhook_url = `${base}/pay/paypal/webhook`;

  res.type("html").send(`<!doctype html>
<html lang="es">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · Admin · PayPal</title>
<style>
  :root{
    --bg:#0b1220; --txt:#e5e7eb; --muted:#9aa4b2; --card:#111827; --line:#ffffff22;
    --ok:#16a34a; --danger:#ef4444; --accent:#2563eb;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:var(--bg);color:var(--txt)}
  body.light{background:#fff;color:#0b1220}
  body.light .card{background:#fff;border-color:#00000018}
  body.light .muted{color:#667085}
  .wrap{max-width:900px;margin:0 auto;padding:18px}
  .top{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .pill{padding:8px 10px;border-radius:999px;background:#ffffff18;border:1px solid #ffffff28;color:inherit;text-decoration:none}
  body.light .pill{background:#00000010;border-color:#00000018}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin-top:12px}
  .title{display:flex;align-items:center;justify-content:space-between}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media(max-width:760px){.grid{grid-template-columns:1fr}}
  label{display:block;font-weight:600;margin:4px 0}
  .muted{color:var(--muted)}
  .input, select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #293245;background:#0f172a;color:#fff}
  body.light .input, body.light select{background:#fff;color:#0b1220;border-color:#00000022}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:9px 12px;border-radius:10px;color:#fff;text-decoration:none;border:1px solid transparent;cursor:pointer}
  .btn.ok{background:var(--ok);border-color:#15803d}
  .btn.red{background:var(--danger);border-color:#b91c1c}
  .btn.blue{background:var(--accent);border-color:#1d4ed8}
  .hint{font-size:12px;margin-top:4px}
  .kbd{font-family:ui-monospace, SFMono-Regular, Menlo, monospace; background:#00000030; padding:2px 6px; border-radius:6px}
  .note{border:1px dashed #ffffff33; border-radius:10px; padding:10px; font-size:13px; margin-top:6px}
  .okmsg{background:#16a34a22;border:1px solid #16a34a55;color:#a7f3d0;padding:8px 10px;border-radius:10px;margin:10px 0; ${r("saved")}}
  .errmsg{background:#ef444422;border:1px solid #ef444455;color:#fecaca;padding:8px 10px;border-radius:10px;margin:10px 0; ${r("err")}}
</style>
<body>
  <main class="wrap">
    <div class="top">
      <a class="pill" href="/admin">← Volver a Admin</a>
      <div style="display:flex;gap:8px">
        <a class="pill" href="/">Dashboard</a>
      </div>
    </div>

    <h1 style="margin:10px 0">Configuración de PayPal</h1>
    <div class="muted">Activa uno o ambos métodos. El de <b>Eventos/API</b> usa credenciales (Client ID/Secret). El de <b>IPN</b> solo requiere correo.</div>

    <div class="okmsg">¡Guardado correctamente!</div>
    <div class="errmsg">Ocurrió un error al guardar.</div>

    <!-- API / Eventos -->
    <section class="card">
      <div class="title">
        <h3 style="margin:0">PayPal (Eventos/API)</h3>
        <form method="post" action="/admin/paypal/api" style="margin:0">
          <input type="hidden" name="toggleQuick" value="1">
          <input type="hidden" name="enabled" value="${api_enabled ? 0 : 1}">
          <button class="btn ${api_enabled ? 'red':'blue'}" type="submit">${api_enabled ? 'Desactivar':'Activar'}</button>
        </form>
      </div>
      <form method="post" action="/admin/paypal/api">
        <div class="grid">
          <div>
            <label>Estado</label>
            <select class="input" name="enabled">
              <option value="1" ${api_enabled?'selected':''}>Activado</option>
              <option value="0" ${!api_enabled?'selected':''}>Desactivado</option>
            </select>
          </div>
          <div>
            <label>Modo</label>
            <select class="input" name="mode">
              <option value="sandbox" ${api_mode==='sandbox'?'selected':''}>Sandbox</option>
              <option value="live" ${api_mode==='live'?'selected':''}>Live</option>
            </select>
          </div>
          <div>
            <label>Client ID</label>
            <input class="input" name="client_id" value="${api_client_id}">
            <div class="hint muted">Desde <span class="kbd">developer.paypal.com</span> → Apps & Credentials.</div>
          </div>
          <div>
            <label>Secret</label>
            <input class="input" name="secret" value="${api_secret_masked}" placeholder="${api_secret_masked ? '(secreto guardado)' : ''}">
            <div class="hint muted">Déjalo en blanco para mantener el actual.</div>
          </div>
          <div>
            <label><input type="checkbox" name="subscriptions" ${api_subs?'checked':''}> Activar suscripciones (planes/billing)</label>
            <div class="hint muted">Opcional. Solo controla un toggle interno.</div>
          </div>
          <div class="note">
            <div><b>Webhook recomendado</b> (si usas eventos):</div>
            <div class="kbd">${webhook_url}</div>
            <div class="hint muted">Configúralo en PayPal → Webhooks. (Endpoint opcional)</div>
          </div>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn ok" type="submit">Guardar API</button>
        </div>
      </form>
    </section>

    <!-- IPN -->
    <section class="card">
      <div class="title">
        <h3 style="margin:0">PayPal IPN</h3>
        <form method="post" action="/admin/paypal/ipn" style="margin:0">
          <input type="hidden" name="toggleQuick" value="1">
          <input type="hidden" name="enabled" value="${ipn_enabled ? 0 : 1}">
          <button class="btn ${ipn_enabled ? 'red':'blue'}" type="submit">${ipn_enabled ? 'Desactivar':'Activar'}</button>
        </form>
      </div>
      <form method="post" action="/admin/paypal/ipn">
        <div class="grid">
          <div>
            <label>Estado</label>
            <select class="input" name="enabled">
              <option value="1" ${ipn_enabled?'selected':''}>Activado</option>
              <option value="0" ${!ipn_enabled?'selected':''}>Desactivado</option>
            </select>
          </div>
          <div>
            <label>Correo de PayPal (IPN)</label>
            <input class="input" name="email" value="${ipn_email}">
            <div class="hint muted">El correo de tu cuenta PayPal que recibirá pagos.</div>
          </div>
          <div class="note">
            <div><b>IPN Listener</b> (URL de notificación):</div>
            <div class="kbd">${ipn_url}</div>
            <div class="hint muted">Configúralo en PayPal → IPN.</div>
          </div>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn ok" type="submit">Guardar IPN</button>
        </div>
      </form>
    </section>

    <div class="row" style="margin-top:14px">
      <a class="pill" href="/admin">← Volver a Admin</a>
    </div>
  </main>
</body>
</html>`);
});

/* ===== POST: guardar API/Eventos ===== */
router.post("/api", ensureAdmin, (req, res) => {
  try{
    if (req.body?.toggleQuick) {
      set("paypal_api_enabled", bool(req.body.enabled) ? "1" : "0");
      return res.redirect("/admin/paypal?ok=saved");
    }

    const enabled = bool(req.body?.enabled) ? "1" : "0";
    const mode = (String(req.body?.mode || "sandbox").toLowerCase() === "live") ? "live" : "sandbox";
    const client_id = String(req.body?.client_id || "").trim();
    const secret_in = String(req.body?.secret || "").trim();
    const subs = bool(req.body?.subscriptions) ? "1" : "0";

    if (enabled === "1") {
      if (!client_id) return res.redirect("/admin/paypal?ok=err");
      const currentSecret = get("paypal_api_secret", "");
      if (!currentSecret && !secret_in) return res.redirect("/admin/paypal?ok=err");
    }

    set("paypal_api_enabled", enabled);
    set("paypal_api_mode", mode);
    set("paypal_api_client_id", client_id);
    if (secret_in && !/^•/.test(secret_in)) set("paypal_api_secret", secret_in);
    set("paypal_api_subscriptions", subs);

    return res.redirect("/admin/paypal?ok=saved");
  }catch(e){
    console.error("paypal/api save:", e);
    return res.redirect("/admin/paypal?ok=err");
  }
});

/* ===== POST: guardar IPN ===== */
router.post("/ipn", ensureAdmin, (req, res) => {
  try{
    if (req.body?.toggleQuick) {
      set("paypal_ipn_enabled", bool(req.body.enabled) ? "1" : "0");
      return res.redirect("/admin/paypal?ok=saved");
    }

    const enabled = bool(req.body?.enabled) ? "1" : "0";
    const email = String(req.body?.email || "").trim();

    if (enabled === "1") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect("/admin/paypal?ok=err");
    }

    set("paypal_ipn_enabled", enabled);
    set("paypal_ipn_email", email);

    return res.redirect("/admin/paypal?ok=saved");
  }catch(e){
    console.error("paypal/ipn save:", e);
    return res.redirect("/admin/paypal?ok=err");
  }
});

/* ===== GET: estado (para otros módulos) ===== */
router.get("/state", ensureAdmin, (req, res) => {
  const state = {
    api: {
      enabled: get("paypal_api_enabled","0")==="1",
      mode: get("paypal_api_mode","sandbox"),
      client_id_present: !!get("paypal_api_client_id",""),
      secret_present: !!get("paypal_api_secret",""),
      subscriptions: get("paypal_api_subscriptions","0")==="1"
    },
    ipn: {
      enabled: get("paypal_ipn_enabled","0")==="1",
      email: get("paypal_ipn_email","")
    }
  };
  res.json(state);
});

module.exports = router;