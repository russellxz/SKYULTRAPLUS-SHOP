// db.js
"use strict";

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'storage');
const DB_FILE  = path.join(DATA_DIR, 'app.db');
const INVOICES_DIR = path.join(DATA_DIR, 'invoices');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(INVOICES_DIR)) fs.mkdirSync(INVOICES_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ───────────────── Helpers de migración ────────────────── */
function columnExists(table, column){
  try{
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some(r => r.name === column);
  }catch{ return false; }
}
function addColumnIfMissing(table, column, ddl){
  if (!columnExists(table, column)) {
    try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run(); } catch {}
  }
}

/* ───────────────── Tablas base ────────────────── */
db.prepare(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
)`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  surname TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
)`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD','MXN')),
  balance REAL NOT NULL DEFAULT 0,
  UNIQUE(user_id, currency),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
)`).run();

/* ───────────────── Productos ────────────────── */
/* Nota: añadimos columnas nuevas para alinear con admin_products/product.js */
db.prepare(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK (currency IN ('USD','MXN')),
  /* ciclo textual legado (se mantiene para compatibilidad) */
  cycle TEXT NOT NULL DEFAULT '30d',
  image_path TEXT,
  /* legacy */
  secret_info TEXT,
  /* NUEVO: info que se revela tras el pago */
  reveal_info TEXT,
  /* NUEVO: ciclo en minutos (7d=10080, 15d=21600, 30d=43200, test=3) */
  period_minutes INTEGER NOT NULL DEFAULT 43200,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
)`).run();

/* Migraciones suaves de products */
addColumnIfMissing('products', 'reveal_info', 'reveal_info TEXT');
addColumnIfMissing('products', 'period_minutes', 'period_minutes INTEGER NOT NULL DEFAULT 43200');

/* Si reveal_info está vacío pero existe secret_info, lo copiamos una sola vez */
try{
  const needs = db.prepare(`SELECT COUNT(*) AS c FROM products WHERE (reveal_info IS NULL OR trim(reveal_info)='') AND secret_info IS NOT NULL AND trim(secret_info)<>''`).get();
  if (needs && needs.c > 0){
    db.prepare(`UPDATE products SET reveal_info = secret_info WHERE (reveal_info IS NULL OR trim(reveal_info)='') AND secret_info IS NOT NULL AND trim(secret_info)<>''`).run();
  }
}catch{}

/* ───────────────── Servicios (suscripciones) ────────────────── */
db.prepare(`
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  period_minutes INTEGER NOT NULL,
  next_invoice_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', /* active | paused | canceled */
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
)`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_services_user ON services(user_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_services_next ON services(next_invoice_at)`).run();

/* ───────────────── Facturas ────────────────── */
/* Compatibilizamos: número y producto_id existen; añadimos service_id y pdf_path si faltan */
db.prepare(`
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,                 /* puede ser NULL al crear y asignarse luego */
  user_id INTEGER NOT NULL,
  product_id INTEGER,                 /* opcional si viene de un service */
  service_id INTEGER,                 /* NUEVO: relación con services */
  amount REAL NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD','MXN')),
  status TEXT NOT NULL DEFAULT 'pending', /* pending | paid | canceled | overdue */
  payment_method TEXT,                /* credits | paypal | stripe */
  external_id TEXT,                   /* id de pasarela si aplica */
  created_at TEXT NOT NULL,
  due_at TEXT,
  paid_at TEXT,
  cycle_end_at TEXT,                  /* opcional: fin del período */
  pdf_path TEXT,                      /* NUEVO: ruta del PDF generado */
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL,
  FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE SET NULL
)`).run();

/* Migraciones de columnas invoices si ya existía la tabla vieja */
addColumnIfMissing('invoices', 'service_id', 'service_id INTEGER');
addColumnIfMissing('invoices', 'pdf_path', 'pdf_path TEXT');
addColumnIfMissing('invoices', 'due_at', 'due_at TEXT');
addColumnIfMissing('invoices', 'paid_at', 'paid_at TEXT');
addColumnIfMissing('invoices', 'cycle_end_at', 'cycle_end_at TEXT');

db.prepare(`CREATE INDEX IF NOT EXISTS idx_invoices_user_created ON invoices(user_id, created_at DESC)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_invoices_service ON invoices(service_id)`).run();

/* ───────────────── Password resets ────────────────── */
db.prepare(`
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_pwreset_user ON password_resets(user_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_pwreset_token ON password_resets(token)`).run();

/* ───────────────── Email verification ────────────────── */
db.prepare(`
CREATE TABLE IF NOT EXISTS email_verify_tokens(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_ev_user ON email_verify_tokens(user_id)`).run();

/* ───────────────── Settings por defecto ────────────────── */
const defaults = [
  ['site_name','SkyShop'],
  ['logo_url',''],
  ['require_email_verification','0'],  // 0 = no exigir verificación
  /* datos básicos para facturas PDF */
  ['invoice_prefix','INV'],
  ['invoice_from_name','SkyShop'],
  ['invoice_from_address','—'],        // pon dirección fiscal si la tienes
];
const insSetting = db.prepare(`INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)`);
defaults.forEach(([k,v]) => insSetting.run(k,v));

/* ───────────────── Admin por defecto ────────────────── */
const adminEmail = 'ventasweb@gmail.com';
const exists = db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail);
if (!exists) {
  const hash = bcrypt.hashSync('123456', 10);
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO users (name, surname, username, email, phone, password_hash, is_admin, email_verified, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)
  `).run('sky','venta','sky507', adminEmail, '+1 516-709-6032', hash, now);

  const uid = info.lastInsertRowid;
  db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`).run(uid, 'USD');
  db.prepare(`INSERT OR IGNORE INTO credits(user_id,currency,balance) VALUES(?,?,0)`).run(uid, 'MXN');
}

/* ───────────────── Helpers públicos ────────────────── */
db.getSetting = (key, fallback=null) => {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : fallback;
};
db.setSetting = (key, value) => {
  db.prepare(`INSERT INTO settings(key,value) VALUES(?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
};

/* Genera números de factura tipo: INV-yyyymmdd-00001 */
db.nextInvoiceNumber = () => {
  const prefix = db.getSetting('invoice_prefix', 'INV');
  const today = new Date().toISOString().slice(0,10).replace(/-/g,''); // yyyymmdd
  const key = `invoice_seq_${today}`;
  let n = parseInt(db.getSetting(key, '0'), 10) || 0;
  n += 1;
  db.setSetting(key, String(n));
  return `${prefix}-${today}-${String(n).padStart(5,'0')}`;
};

/* Directorio donde se guardan PDFs de facturas */
db.INVOICES_DIR = INVOICES_DIR;

module.exports = db;
