// pay.js — Stubs de PayPal/Stripe para que no crashee el server
"use strict";

const express = require("express");
const db = require("./db");
const router = express.Router();

function ensureAuth(req,res,next){
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}

function getProduct(pid){
  return db.prepare(`SELECT id, name, price, currency FROM products WHERE id=? AND active=1`).get(pid);
}

function renderNotConfigured(res, site, p, provider){
  res.type("html").send(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} · ${provider}</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:#0b1220;color:#e5e7eb}
  .wrap{max-width:720px;margin:0 auto;padding:24px}
  .card{background:#111827;border:1px solid #ffffff22;border-radius:16px;padding:18px}
  .btn{display:inline-block;margin-top:10px;background:#2563eb;color:#fff;text-decoration:none;padding:10px 12px;border-radius:10px}
</style>
<body>
  <main class="wrap">
    <section class="card">
      <h2>${provider} no está configurado</h2>
      <p>Producto: <b>${p.name}</b> — <b>${p.currency} ${Number(p.price).toFixed(2)}</b></p>
      <p>Por ahora puedes <b>pagar con créditos</b> desde la página del producto.</p>
      <a class="btn" href="/product?id=${p.id}">Volver al producto</a>
    </section>
  </main>
</body>`);
}

/* ===== /pay/paypal?pid=xx ===== */
router.get("/paypal", ensureAuth, (req,res)=>{
  const site = db.getSetting("site_name", "SkyShop");
  const pid = Number(req.query.pid || 0);
  const p = getProduct(pid);
  if (!p) return res.status(404).send("Producto no encontrado");
  return renderNotConfigured(res, site, p, "PayPal");
});

/* ===== /pay/stripe?pid=xx ===== */
router.get("/stripe", ensureAuth, (req,res)=>{
  const site = db.getSetting("site_name", "SkyShop");
  const pid = Number(req.query.pid || 0);
  const p = getProduct(pid);
  if (!p) return res.status(404).send("Producto no encontrado");
  return renderNotConfigured(res, site, p, "Stripe");
});

module.exports = router;