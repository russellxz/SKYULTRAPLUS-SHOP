// index.js
"use strict";

const express = require("express");
const session = require("express-session");
const BetterSQLiteStore = require("better-sqlite3-session-store")(session);
const cookie = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const db = require("./db");

// ⬇️ Motor de facturación (tolerante)
const billingMod   = require("./billing_engine");
const startBilling = billingMod.start || billingMod;
const stopBilling  = billingMod.stop  || (() => {});

// ⬇️ Watcher de notificaciones (pagadas/pendientes/canceladas)
let notifierMod = null;
try {
  notifierMod = require("./notifier"); // debe exportar { start, stop, runOnce }
  console.log("[notifier] módulo cargado correctamente");
} catch (e) {
  console.warn("[notifier] módulo no disponible:", e?.message || e);
}
const startNotifier = notifierMod?.start || (() => {});
const stopNotifier  = notifierMod?.stop  || (() => {});

// Utils
function maskPhone(p) {
  const s = String(p || "");
  if (s.length <= 4) return "****";
  const tail = s.slice(-4);
  return s.slice(0, -4).replace(/\d/g, "*") + tail;
}
function setSetting(key, value){
  if (typeof db.setSetting === "function") return db.setSetting(key, value);
  db.prepare(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)`).run();
  db.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(key, String(value ?? ""));
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

/* ===== Estáticos ===== */
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ===== Parsers globales (con EXCEPCIÓN para /pay/stripe/webhook) ===== */
const jsonParser = express.json({ limit: "50mb" });
const urlParser  = express.urlencoded({ extended: true, limit: "50mb", parameterLimit: 100000 });
function isStripeWebhook(req){ return req.originalUrl === "/pay/stripe/webhook"; }
app.use((req,res,next)=> isStripeWebhook(req) ? next() : jsonParser(req,res,next));
app.use((req,res,next)=> isStripeWebhook(req) ? next() : urlParser(req,res,next));
app.use(cookie());

/* ===== Auto-descubrir y guardar la URL pública ===== */
app.use((req, _res, next) => {
  try {
    const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
    const host  = (req.headers["x-forwarded-host"]  || req.headers.host || "").split(",")[0].trim();
    if (host) {
      const current = db.getSetting("public_base_url", "") || db.getSetting("site_url", "");
      const url = `${proto}://${host}`;
      if (!current || /localhost|127\.0\.0\.1/.test(current)) {
        setSetting("public_base_url", url);
        if (current !== url) console.log("[boot] public_base_url ->", url);
      }
    }
  } catch {}
  next();
});

/* ===== Handler de error por payload grande ===== */
app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") {
    console.warn("[http] Payload demasiado grande para", req.method, req.url);
    return res.status(413).type("text/plain").send("Archivo demasiado grande. Máximo 15MB.");
  }
  next(err);
});

/* ===== Seguridad ===== */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

/* ===== Sesiones (SQLite) ===== */
app.use(session({
  secret: process.env.SESSION_SECRET || "skysecret",
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: "lax" },
  store: new BetterSQLiteStore({
    client: db,
    expired: { clear: true, intervalMs: 15 * 60 * 1000 },
  }),
}));

/* ===== Rutas públicas ===== */
app.use("/", require("./login"));            // /login
app.use("/", require("./register"));         // /register
app.use("/", require("./forgot"));           // /forgot
app.use("/", require("./reset"));            // /reset
app.use("/", require("./dashboard"));        // "/" y /dashboard
app.use("/", require("./product"));          // /product y /product/buy

/* ===== Pagos =====
   - Stripe bajo /pay (su webhook usa raw body, por eso la excepción arriba).
   - PayPal se monta en "/" para que rutas absolutas como /pay/paypal/api/create EXISTAN.
*/
app.use("/pay", require("./pay_stripe"));    // Stripe (incluye /pay/stripe y /pay/stripe/webhook)
app.use("/",    require("./pay_paypal"));    // PayPal (mantiene /pay/paypal/* tal cual)

/* ===== Facturas / Servicios / Perfil / Créditos ===== */
app.use("/invoices", require("./invoices")); // facturas
app.use("/", require("./services"));
app.use("/profile", require("./profile"));
app.use("/", require("./user_credits"));

/* ===== Admin ===== */
app.use("/admin/mail", require("./admin_mail"));
app.use("/admin/products", require("./admin_products"));
app.use("/admin", require("./admin"));
app.use("/admin", require("./admin_brand"));
app.use("/admin/invoices", require("./admin_invoices"));
app.use("/admin/paypal", require("./admin_paypal"));
app.use("/admin", require("./admin_store"));
app.use("/admin", require("./admin_user_edit"));
app.use("/tickets", require("./tickets"));
app.use("/admin", require("./admin_tickets"));
app.use("/admin", require("./admin_stripe"));
// ...
app.use("/admin/terminos", require("./adminterminos"));
app.use("/terminos", require("./public-terminos"));
// ...
/* Panel de WhatsApp */
app.use("/", require("./admin_whatsapp"));

/* Logout */
app.get("/logout", (req, res) => req.session.destroy(() => res.redirect("/login")));

/* 404 */
app.use((req, res) => res.status(404).type("text/plain").send("404"));

/* ===== Start HTTP ===== */
const PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const server = app.listen(PORT, HOST, () => {
  console.log(`SkyShop listening on http://${HOST}:${PORT}`);
  try {
    const siteName = db.getSetting("site_name", "SkyShop");
    const baseUrl  = db.getSetting("public_base_url", "") || db.getSetting("site_url", "") || "(auto)";
    const ownerWa  = db.getSetting("owner_phone_wa", "") || db.getSetting("owner_whatsapp", "");
    console.log("[boot] site_name       =", siteName);
    console.log("[boot] public_base_url =", baseUrl);
    console.log("[boot] owner_phone_wa  =", ownerWa ? maskPhone(ownerWa) : "—");
  } catch (e) {
    console.warn("[boot] no se pudieron leer settings:", e?.message || e);
  }
});

/* ===== Facturación automática ===== */
const BILLING_ENABLED     = String(process.env.BILLING_ENABLED || "1") !== "0";
const BILLING_INTERVAL_MS = parseInt(process.env.BILLING_INTERVAL_MS || "30000", 10);

if (BILLING_ENABLED) {
  try {
    startBilling({ db, intervalMs: BILLING_INTERVAL_MS, log: (...a) => console.log("[billing]", ...a), verbose: false });
    console.log(`[billing] motor iniciado (intervalo ${BILLING_INTERVAL_MS} ms)`);
  } catch (e) {
    console.error("[billing] no se pudo iniciar:", e?.message || e);
  }
} else {
  console.log("[billing] desactivado por BILLING_ENABLED=0");
}

/* ===== Watcher de notificaciones ===== */
const NOTIFIER_ENABLED     = String(process.env.NOTIFIER_ENABLED || "1") !== "0";
const NOTIFIER_INTERVAL_MS = parseInt(process.env.NOTIFIER_INTERVAL_MS || "30000", 10);

if (NOTIFIER_ENABLED && notifierMod) {
  try {
    startNotifier(NOTIFIER_INTERVAL_MS); // start(intervalMs)
    console.log(`[notifier] iniciado (intervalo ${NOTIFIER_INTERVAL_MS} ms)`);
  } catch (e) {
    console.error("[notifier] no se pudo iniciar:", e?.message || e);
  }
} else if (!notifierMod) {
  console.log("[notifier] no cargado (archivo ./notifier.js no encontrado)");
} else {
  console.log("[notifier] desactivado por NOTIFIER_ENABLED=0");
}

/* ===== Manejo de errores globales ===== */
process.on("unhandledRejection", (reason, p) => {
  console.error("[proc] Unhandled Rejection at:", p, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[proc] Uncaught Exception:", err?.stack || err?.message || err);
});

/* ===== Paro limpio ===== */
function shutdown(sig) {
  console.log(`\n${sig} recibido. Cerrando...`);
  try { stopBilling(); } catch {}
  try { stopNotifier(); } catch {}
  server.close(() => {
    console.log("HTTP cerrado. Bye.");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
