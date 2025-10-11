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
//  - Si billing_engine exporta { start, stop }, usamos eso.
//  - Si exporta una función, la usamos como start().
const billingMod   = require("./billing_engine");
const startBilling = billingMod.start || billingMod;
const stopBilling  = billingMod.stop  || (() => {});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

/* ===== Estáticos ===== */
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ===== Parsers ===== */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookie());

/* ===== Seguridad ===== */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* ===== Sesiones (SQLite) ===== */
app.use(
  session({
    secret: process.env.SESSION_SECRET || "skysecret",
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: "lax" },
    store: new BetterSQLiteStore({
      client: db,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
  })
);

/* ===== Rutas públicas ===== */
app.use("/", require("./login"));            // /login (GET/POST)
app.use("/", require("./register"));         // /register
app.use("/", require("./forgot"));           // /forgot
app.use("/", require("./reset"));            // /reset
app.use("/", require("./dashboard"));        // "/" y "/dashboard"
app.use("/", require("./product"));          // /product y /product/buy
app.use("/pay", require("./pay"));           // /pay/paypal y /pay/stripe (placeholders)
app.use("/invoices", require("./invoices")); // Mis facturas (listado/descarga)
app.use("/", require("./services"));
app.use('/profile', require('./profile'));
app.use('/', require('./user_credits'));

/* ===== Admin =====
   (específicas primero, luego genéricas)
*/
app.use("/admin/mail", require("./admin_mail"));
app.use("/admin/products", require("./admin_products"));
app.use("/admin", require("./admin"));
app.use("/admin", require("./admin_brand"));
app.use("/admin/invoices", require("./admin_invoices"));
app.use("/admin/paypal", require("./admin_paypal"));
app.use("/pay", require("./pay_paypal"));
app.use(require("./pay_paypal"));
app.use("/admin", require("./admin_store"));
app.use("/admin", require("./admin_user_edit")); 
app.use("/tickets", require("./tickets"));
app.use('/admin', require('./admin_tickets'));

/* Logout */
app.get("/logout", (req, res) => req.session.destroy(() => res.redirect("/login")));

/* 404 */
app.use((req, res) => res.status(404).type("text/plain").send("404"));

/* ===== Start HTTP ===== */
const PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const server = app.listen(PORT, HOST, () =>
  console.log(`SkyShop listening on http://${HOST}:${PORT}`)
);

/* ===== Facturación automática (cada 30s) =====
   Variables de entorno:
   - BILLING_ENABLED=0 para desactivarlo
   - BILLING_INTERVAL_MS=30000 para cambiar el intervalo
*/
const BILLING_ENABLED    = String(process.env.BILLING_ENABLED || "1") !== "0";
const BILLING_INTERVAL_MS = parseInt(process.env.BILLING_INTERVAL_MS || "30000", 10);

if (BILLING_ENABLED) {
  try {
    startBilling({
      db, // conexión better-sqlite3
      intervalMs: BILLING_INTERVAL_MS,
      log: (...a) => console.log("[billing]", ...a),
      verbose: false,
    });
    console.log(`[billing] motor iniciado (intervalo ${BILLING_INTERVAL_MS} ms)`);
  } catch (e) {
    console.error("[billing] no se pudo iniciar:", e?.message || e);
  }
} else {
  console.log("[billing] desactivado por BILLING_ENABLED=0");
}

/* ===== Paro limpio (Pterodactyl/containers) ===== */
function shutdown(sig) {
  console.log(`\n${sig} recibido. Cerrando...`);
  try { stopBilling(); } catch {}
  server.close(() => {
    console.log("HTTP cerrado. Bye.");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref(); // fuerza salida si algo se queda colgado
}
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));