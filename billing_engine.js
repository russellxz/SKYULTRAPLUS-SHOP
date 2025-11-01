// billing_engine.js
"use strict";

/**
 * Motor de facturación periódico.
 * - Cada tick:
 *    1) Marca como "overdue" facturas pending con due_at vencido.
 *    2) Para cada servicio ACTIVO con next_invoice_at <= ahora:
 *         - (catch-up) puede generar varias facturas atrasadas hasta maxCatchUp
 *         - Evita duplicados con una ventana ±dedupWindowMin alrededor de next_invoice_at
 *         - Avanza next_invoice_at por period_minutes en la misma transacción
 *
 * Requiere en db:
 *   - db.nextInvoiceNumber()
 *   - tablas: services(user_id,product_id,period_minutes,next_invoice_at,status)
 *             products(id,price,currency)
 *             invoices(...)
 */

let _timer = null;
let _running = false;
let _opts = null;

function addMinutes(iso, minutes) {
  const t = new Date(iso);
  return new Date(t.getTime() + minutes * 60_000).toISOString();
}
function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
function aroundISO(iso, minutes) {
  const t = new Date(iso).getTime();
  return [
    new Date(t - minutes * 60_000).toISOString(),
    new Date(t + minutes * 60_000).toISOString(),
  ];
}
function nowISO() { return new Date().toISOString(); }

function start(options = {}) {
  if (_timer) return; // ya iniciado

  const {
    db,
    intervalMs = 30_000,
    maxCatchUp = 3,           // máximo de ciclos atrasados a generar por servicio y tick
    dedupWindowMin = 10,      // ventana ±min para evitar duplicados
    dueDays = 3,              // días de vencimiento por defecto
    verbose = false,
    log = (...a) => console.log(...a),
  } = options;

  if (!db) throw new Error("billing_engine: falta db");

  _opts = { db, intervalMs, maxCatchUp, dedupWindowMin, dueDays, verbose, log };

  // Migración defensiva muy puntual por si falta canceled_at en services
  try {
    const cols = db.prepare(`PRAGMA table_info(services)`).all();
    if (!cols.some(c => c.name === "canceled_at")) {
      try { db.prepare(`ALTER TABLE services ADD COLUMN canceled_at TEXT`).run(); } catch {}
    }
  } catch {}

  // Statements preparados
  const qDueServices = db.prepare(`
    SELECT s.id, s.user_id, s.product_id, s.period_minutes, s.next_invoice_at,
           lower(s.status) AS status,
           p.price, p.currency
    FROM services s
    JOIN products p ON p.id = s.product_id
    WHERE lower(s.status)='active' AND datetime(s.next_invoice_at) <= datetime(?)
    ORDER BY datetime(s.next_invoice_at) ASC
    LIMIT 500
  `);

  const qDupInvoice = db.prepare(`
    SELECT id FROM invoices
    WHERE service_id=? AND datetime(created_at) BETWEEN datetime(?) AND datetime(?)
    LIMIT 1
  `);

  const insInvoice = db.prepare(`
    INSERT INTO invoices
      (number,user_id,product_id,service_id,amount,currency,status,created_at,due_at,cycle_end_at)
    VALUES
      (?,?,?,?,?,?,?,?,?,?)
  `);

  const bumpNext = db.prepare(`
    UPDATE services SET next_invoice_at=? WHERE id=?
  `);

  const markOverdue = db.prepare(`
    UPDATE invoices
       SET status='overdue'
     WHERE status='pending'
       AND due_at IS NOT NULL
       AND datetime(due_at) < datetime(?)
  `);

  const tickTx = db.transaction(() => {
    const now = nowISO();
    // 1) Vencidas -> overdue
    markOverdue.run(now);

    // 2) Servicios a facturar
    const due = qDueServices.all(now);
    for (const s of due) {
      let nextAt = s.next_invoice_at;
      let generated = 0;

      // Genera hasta maxCatchUp facturas atrasadas
      while (generated < maxCatchUp && new Date(nextAt) <= new Date(now)) {
        const [winStart, winEnd] = aroundISO(nextAt, _opts.dedupWindowMin);
        const dup = qDupInvoice.get(s.id, winStart, winEnd);

        const cycleEnd = addMinutes(nextAt, s.period_minutes);
        const newNext  = cycleEnd;

        if (!dup) {
          const number = _opts.db.nextInvoiceNumber
            ? _opts.db.nextInvoiceNumber()
            : `INV-${Date.now()}`;

          const createdAt = nowISO();               // registrado en el momento de creación
          const dueAt     = minutesFromNow(_opts.dueDays * 24 * 60);

          insInvoice.run(
            number,
            s.user_id,
            s.product_id,
            s.id,               // service_id
            s.price,
            s.currency,
            "pending",
            createdAt,
            dueAt,
            cycleEnd            // fin del período que se está cobrando
          );

          if (verbose) _opts.log(`creada ${number} svc=${s.id} prod=${s.product_id} monto=${s.price} ${s.currency}`);
        } else {
          if (verbose) _opts.log(`dup evitado svc=${s.id} ventana=${winStart}..${winEnd}`);
        }

        // Avanza el siguiente corte SIEMPRE (haya o no duplicado)
        bumpNext.run(newNext, s.id);

        // Para seguir catch-up si aún sigue vencido
        nextAt = newNext;
        generated++;
      }
    }
  });

  async function runOnce() {
    if (_running) return;
    _running = true;
    try {
      tickTx();
    } catch (e) {
      _opts.log("[billing] ERROR en tick:", e?.message || e);
    } finally {
      _running = false;
    }
  }

  _timer = setInterval(runOnce, intervalMs);
  _timer.unref?.(); // no impide que el proceso salga

  // Ejecuta un primer ciclo apenas arranca
  runOnce();

  // expone para pruebas/manual
  start.runOnce = runOnce;
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { start, stop };
