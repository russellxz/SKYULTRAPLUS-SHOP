// dashboard.js — Home del usuario (drawer + light/dark + animaciones + "Productos digitales")
// Con verificación de pagos únicos y stock
"use strict";

const express = require("express");
const db = require("./db");

const router = express.Router();

function ensureAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}

// Formatea precio según moneda
function formatAmount(value, currency) {
  const n = Number(value || 0);
  return (currency === "USD") ? `$ ${n.toFixed(2)}` : `MXN ${n.toFixed(2)}`;
}

router.get(["/", "/dashboard"], ensureAuth, (req, res) => {
  const site = db.getSetting("site_name", "SkyShop");
  const logo = db.getSetting("logo_url", "");

  // Botones configurables
  const community = db.getSetting("community_url", db.getSetting("whatsapp_group_url", "")).trim();
  const ownerWa   = (db.getSetting("owner_whatsapp", "") || "").replace(/\D+/g, "");
  const waMsg     = encodeURIComponent(`Hola, vengo de ${site}. Necesito ayuda.`);
  const waHref    = ownerWa ? `https://wa.me/${ownerWa}?text=${waMsg}` : "";

  const u = req.session.user;
  const isAdmin = !!u.is_admin;

  // Avatar (foto o inicial)
  const avatarUrl = (u.avatar_url || "").trim();
  const avatarLetter = String(u.name || "?").charAt(0).toUpperCase();
  const avatarHtml = avatarUrl ? `<img src="${avatarUrl}" alt="avatar">` : `${avatarLetter}`;

  // Saldos
  const usd = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='USD'`).get(u.id) || { balance: 0 };
  const mxn = db.prepare(`SELECT balance FROM credits WHERE user_id=? AND currency='MXN'`).get(u.id) || { balance: 0 };

  // Productos activos (incluimos billing_type y stock)
  const products = db.prepare(`
    SELECT id, name, description, price, currency, image_path, period_minutes, billing_type, stock
    FROM products
    WHERE active=1
    ORDER BY id DESC
    LIMIT 24
  `).all();

  // Productos que el usuario YA TIENE ACTIVOS (para bloquear recompra)
  const userActiveProducts = db.prepare(`
    SELECT DISTINCT product_id
    FROM services
    WHERE user_id=? AND status='active'
  `).all(u.id).map(r => r.product_id);

  const cycleLabel = (p) => {
    const pm = Number(p.period_minutes || 43200);
    const isOneTime = (String(p.billing_type) === "one_time") || pm === 0;
    if (isOneTime) return "Pago único";
    return pm === 3
      ? "TEST · 3 min"
      : pm === 10080
      ? "Semanal"
      : pm === 21600
      ? "Cada 15 días"
      : "Mensual";
  };

  const stockBadge = (s) => {
    if (typeof s === "undefined" || s === null) return "";
    return `<span class="badge" title="Stock">Stock: ${Number(s) < 0 ? "∞" : Number(s)}</span>`;
  };

  const renderImg = (p) => {
    if (p.image_path && String(p.image_path).trim()) {
      return `<img src="${p.image_path}" alt="${p.name}" class="pimg" loading="lazy">`;
    }
    const svg = encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'>
         <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
           <stop stop-color='#1f2937' offset='0'/><stop stop-color='#111827' offset='1'/>
         </linearGradient></defs>
         <rect fill='url(#g)' x='0' y='0' width='640' height='360'/>
         <g fill='#9ca3af' font-family='system-ui,Segoe UI' font-size='28'>
           <text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle'>Sin imagen</text>
         </g>
       </svg>`
    );
    return `<img src="data:image/svg+xml;utf8,${svg}" alt="${p.name}" class="pimg" loading="lazy">`;
  };

  const cards = products.map(p => {
    const pm = Number(p.period_minutes || 43200);
    const isOneTime = (String(p.billing_type) === "one_time") || pm === 0;
    const alreadyActive = userActiveProducts.includes(p.id);
    const s = (typeof p.stock === "number") ? p.stock : null;

    const outOfStock = (s === 0);
    // Deshabilitamos compra si:
    // - no hay stock
    // - o el usuario ya lo tiene ACTIVO (para único: “Ya comprado”, para recurrente: “Activo”)
    const disabled = outOfStock || alreadyActive;

    let btnText = "Comprar";
    if (outOfStock) btnText = "Sin stock";
    else if (alreadyActive) btnText = isOneTime ? "Ya comprado" : "Activo";

    return `
      <article class="card">
        <a class="card-link" href="/product?id=${p.id}" aria-label="Ver ${p.name}">
          <div class="thumb">${renderImg(p)}</div>
          <div class="card-body">
            <h3 class="pname" title="${p.name}">${p.name}</h3>
            <div class="row tiny">
              <span class="badge" title="Tipo">${cycleLabel(p)}</span>
              ${stockBadge(s)}
            </div>
            <div class="price">${p.currency} ${Number(p.price).toFixed(2)}</div>
          </div>
        </a>
        <div class="card-actions">
          ${disabled
            ? `<span class="btn disabled" aria-disabled="true">${btnText}</span>`
            : `<a class="btn" href="/product?id=${p.id}" aria-label="Comprar ${p.name}">${btnText}</a>`
          }
        </div>
      </article>
    `;
  }).join("");

  const empty = `
    <div class="empty">
      <div class="empty-title">No hay productos disponibles todavía</div>
      <div class="empty-sub">Cuando el administrador cree productos, aparecerán aquí.</div>
    </div>`;

  res.send(`<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${site} · Dashboard</title>
<style>
  :root{
    --bg:#0b1220; --txt:#e5e7eb; --muted:#9ca3af; --card:#111827; --line:#ffffff15;
    --accent:#f43f5e; --accent2:#fb7185; --radius:16px; --ok:#16a34a; --danger:#ef4444;
  }
  *{box-sizing:border-box}
  body{ margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;
        background:var(--bg); color:var(--txt); min-height:100vh; overflow-x:hidden; }

  /* Cielo oscuro */
  .sky{ position:fixed; inset:0; pointer-events:none; z-index:0; overflow:hidden; }
  .star{ position:absolute; width:2px; height:2px; background:#fff; border-radius:50%; opacity:.9; animation: twinkle 3s linear infinite; }
  .shoot{ position:absolute; width:140px; height:2px; background:linear-gradient(90deg,#fff,transparent);
          transform:rotate(18deg); filter:drop-shadow(0 0 6px #ffffff55); animation: shoot 5.5s linear infinite; }
  @keyframes twinkle{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
  @keyframes shoot{0%{transform:translate(-10vw,-10vh) rotate(18deg)}100%{transform:translate(110vw,110vh) rotate(18deg)}}

  /* Modo claro: emojis */
  body.light{ background:#ffffff; color:#0b1220; }
  .icons{ position:fixed; inset:0; z-index:0; pointer-events:none; display:none; }
  body.light .icons{ display:block; }
  .icons span{ position:absolute; font-size:34px; opacity:.24; animation: floatUp linear infinite; filter:saturate(120%) drop-shadow(0 0 1px #00000010);}
  @media(min-width:900px){ .icons span{ font-size:40px; } }
  @keyframes floatUp{ 0%{ transform:translateY(20vh); opacity:.0 } 10%{opacity:.24} 90%{opacity:.24} 100%{ transform:translateY(-30vh); opacity:.0 } }

  /* Top bar */
  .top{ position:sticky; top:0; z-index:6; backdrop-filter:blur(8px);
        background:linear-gradient(#0b1220cc,#0b1220aa); border-bottom:1px solid var(--line); }
  body.light .top{ background:linear-gradient(#fff8,#fff6); }
  .nav{ max-width:1100px; margin:0 auto; padding:10px 16px; display:flex; align-items:center; gap:12px; }
  .brand{ display:flex; align-items:center; gap:10px; }
  .brand img{ width:36px; height:36px; border-radius:8px; object-fit:cover; display:${logo ? 'block':'none'}; }
  .brand-name{ font-weight:900; letter-spacing:.2px; font-size:18px;
    background:linear-gradient(90deg,#ffffff,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent;}
  body.light .brand-name{ background:linear-gradient(90deg,#111111,#ef4444); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent;}

  /* Accesos rápidos */
  .quick{display:flex;gap:8px;margin-left:6px}
  .qbtn{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;text-decoration:none;font-weight:700;
        background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff;border:1px solid #ffffff22}
  .qbtn svg{width:16px;height:16px}

  .grow{ flex:1 }
  .pill{ padding:8px 12px; border-radius:999px; background:#ffffff18; border:1px solid #ffffff28; color:inherit; text-decoration:none; cursor:pointer; }
  body.light .pill{ background:#00000010; border-color:#00000018; }

  .avatar{ width:32px; height:32px; border-radius:50%; background:#64748b; color:#fff; display:grid; place-items:center; font-weight:700; overflow:hidden }
  .avatar img{width:100%;height:100%;object-fit:cover;display:block}

  /* Drawer */
  .burger{width:40px;height:40px;display:grid;place-items:center;border-radius:10px;border:1px solid #334155;background:transparent;cursor:pointer}
  .burger span{width:20px;height:2px;background:currentColor;position:relative;display:block}
  .burger span:before,.burger span:after{content:"";position:absolute;left:0;right:0;height:2px;background:currentColor}
  .burger span:before{top:-6px} .burger span:after{top:6px}
  .drawer{position:fixed;inset:0 auto 0 0;width:300px;transform:translateX(-100%);transition:transform .22s ease;z-index:7}
  .drawer.open{transform:none}
  .drawer .panel{height:100%;background:rgba(17,25,40,.85);backdrop-filter:blur(10px);border-right:1px solid var(--line);padding:14px}
  body.light .drawer .panel{background:#fff}
  .scrim{position:fixed;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(1px);opacity:0;visibility:hidden;transition:.18s ease;z-index:6}
  .scrim.show{opacity:1;visibility:visible}
  .navlist a{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #334155;border-radius:10px;margin-bottom:8px;color:inherit;text-decoration:none}
  .navlist a:hover{border-color:#64748b}
  .navlist svg{width:18px;height:18px;opacity:.95}

  /* Dropdown usuario */
  .udrop{ position:absolute; right:16px; top:60px; background:var(--card); border:1px solid var(--line); border-radius:12px;
          padding:10px; width:230px; box-shadow:0 10px 30px #0007; display:none; z-index:8 }
  body.light .udrop{ background:#fff; }
  .udrop a{ display:block; padding:8px 10px; border-radius:8px; color:inherit; text-decoration:none; }
  .udrop a:hover{ background:#ffffff12 } body.light .udrop a:hover{ background:#0000000a }

  /* Contenido */
  .wrap{ position:relative; z-index:1; max-width:1100px; margin:0 auto; padding:18px 16px 60px; }
  .hello{ margin:14px 0 6px; font-size:28px; font-weight:800; line-height:1.15; }
  .muted{ color:var(--muted) }

  .contacts{ display:flex; gap:8px; flex-wrap:wrap; margin:10px 0 }
  .mini{ display:inline-flex; align-items:center; gap:6px; padding:8px 10px; border-radius:10px;
         background:linear-gradient(90deg,var(--accent),var(--accent2)); color:#fff; text-decoration:none; font-weight:700; font-size:14px; border:none; white-space:nowrap }
  .mini svg{width:16px;height:16px}

  .stats{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin:14px 0 8px; }
  @media(max-width:600px){ .stats{ grid-template-columns:1fr; } }
  .st{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:14px; }
  body.light .st{ background:#fff; }
  .sthead{ display:flex; align-items:center; justify-content:space-between; gap:8px; }

  .section{ display:flex; align-items:center; justify-content:space-between; margin:18px 2px 8px; gap:10px }
  .section h2{ margin:0; font-size:22px; display:flex; align-items:center; gap:8px }
  .spark{width:22px;height:22px}

  /* Tarjeta de mensajes (transparente rojo/azul) */
  .ticker-wrap{ display:flex; align-items:center; justify-content:flex-start; margin:10px 0 2px; }
  .ticker{
    display:inline-flex; align-items:center; gap:10px; padding:10px 14px; border-radius:14px;
    border:1px solid var(--line);
    background:linear-gradient(135deg, rgba(244,63,94,.16), rgba(37,99,235,.16));
    box-shadow:0 8px 24px rgba(0,0,0,.15);
    backdrop-filter: blur(6px);
  }
  body.light .ticker{ background:linear-gradient(135deg, rgba(244,63,94,.10), rgba(37,99,235,.10)); border-color:#00000018; }
  .dot{ width:8px; height:8px; border-radius:50%; background:linear-gradient(90deg,#f43f5e,#2563eb); animation:pulse 1.8s ease-in-out infinite; }
  @keyframes pulse{ 0%{transform:scale(.9)} 50%{transform:scale(1.15)} 100%{transform:scale(.9)} }
  .ticker-text{ font-weight:800; letter-spacing:.2px; min-height:20px; opacity:0; transform:translateY(6px); transition:opacity .32s ease, transform .32s ease; }
  .ticker-text.show{ opacity:1; transform:translateY(0); }

  /* Grid productos */
  .grid{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
  @media(max-width:1020px){ .grid{ grid-template-columns:repeat(2,minmax(0,1fr)); } }
  @media(max-width:620px){ .grid{ grid-template-columns:1fr; } }

  .card{ background:var(--card); border:1px solid var(--line); border-radius:16px; overflow:hidden; display:flex; flex-direction:column; }
  body.light .card{ background:#fff; }
  .card-link{ text-decoration:none; color:inherit; display:flex; flex-direction:column; flex:1; }
  .card:hover{ transform:translateY(-2px); transition:transform .18s ease; }
  .thumb{ aspect-ratio:16/9; background:#0f172a; overflow:hidden; }
  .pimg{ width:100%; height:100%; object-fit:cover; display:block; }
  .card-body{ padding:12px; display:flex; flex-direction:column; gap:6px; }
  .pname{ margin:2px 0 0; font-size:18px; line-height:1.2; }
  .row.tiny{ display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  .badge{ display:inline-block; font-size:12px; padding:4px 8px; border-radius:999px; border:1px solid #ffffff24; background:#0b1325; color:#cbd5e1; }
  body.light .badge{ background:#f8fafc; color:#0b1220; border-color:#00000018; }
  .price{ margin:2px 0 10px; color:#9ca3af; font-weight:800; letter-spacing:.2px; }
  .card-actions{ display:flex; gap:10px; padding:0 12px 12px; }
  .btn{ display:inline-flex; justify-content:center; align-items:center; gap:8px; flex:1;
        padding:10px 12px; border-radius:10px; color:#fff; text-decoration:none;
        background:linear-gradient(90deg,var(--accent),var(--accent2)); font-weight:700; }
  .btn.disabled{ opacity:.6; cursor:not-allowed; pointer-events:none; }

  .empty{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:24px; text-align:center; }
  .empty-title{ font-weight:800; font-size:18px; margin-bottom:6px; }
  .empty-sub{ color:#9ca3af }

  .footer-space{ height:40px }
</style>

<body>
  <div class="sky" id="sky"></div>
  <div class="icons" id="icons"></div>

  <!-- Drawer -->
  <div class="drawer" id="drawer">
    <div class="panel">
      <h3 style="margin:0 0 10px">Menú</h3>
      <nav class="navlist">
        <a href="/">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3 1 8h2v5h4V9h2v4h4V8h2L8 3z"/></svg>
          Inicio
        </a>
        <a href="/invoices">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>
          Mis facturas
        </a>
        <a href="/services">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>
          Mis servicios
        </a>
        <a href="/tickets">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0-1 1 1 1 0 0 0 1 1v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a1 1 0 0 0 1-1 1 1 0 0 0-1-1V5Z"/></svg>
          Soporte
        </a>
        <a href="/profile">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7v-1a5 5 0 0 1 10 0v1H3z"/></svg>
          Mi perfil
        </a>
        ${isAdmin ? `
        <a href="/admin">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M7 1h2l1 3h3l-2 2 1 3-3-1-2 2-2-2-3 1 1-3L1 4h3l1-3z"/></svg>
          Admin
        </a>` : ``}
        <a href="/logout">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h3v2H6v8h3v2H4V2h2zm7 6-3-3v2H7v2h3v2l3-3z"/></svg>
          Salir
        </a>
      </nav>
    </div>
  </div>
  <div id="scrim" class="scrim"></div>

  <header class="top">
    <nav class="nav">
      <button id="menuBtn" class="burger" aria-label="Abrir menú"><span></span></button>
      <div class="brand">
        ${logo ? `<img src="${logo}" alt="logo">` : ``}
        <div class="brand-name">${site}</div>

        <!-- Accesos rápidos -->
        <div class="quick">
          <a class="qbtn" href="/">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3 1 8h2v5h4V9h2v4h4V8h2L8 3z"/></svg>
            Inicio
          </a>
          <a class="qbtn" href="/invoices">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h9l1 2v11l-2-1-2 1-2-1-2 1-2-1V1h0Zm2 4h6v2H5V5Zm0 3h6v2H5V8Z"/></svg>
            Facturas
          </a>
          <a class="qbtn" href="/services">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12l1 4H1l1-4Zm-1 5h14v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7Zm3 1v5h8V8H4Z"/></svg>
            Servicios
          </a>
        </div>
      </div>

      <div class="grow"></div>
      <button id="mode" class="pill" type="button" aria-label="Cambiar tema">🌙</button>

      <div id="ua" class="pill" style="display:flex;gap:8px;align-items:center;position:relative">
        <div class="avatar">${avatarHtml}</div>
        <span>${u.username}</span>
        <div id="udrop" class="udrop">
          <div style="padding:6px 8px; font-weight:700">${u.name} ${u.surname}</div>
          <a href="/profile">Mi perfil</a>
          <a href="/invoices">Mis facturas</a>
          <a href="/services">Mis servicios</a>
          <a href="/tickets">Tickets</a>
          ${isAdmin ? `<a href="/admin">Administración</a>` : ``}
          <a href="/logout">Salir</a>
        </div>
      </div>
    </nav>
  </header>

  <main class="wrap">
    <div class="hello">¡Hola, ${u.name}!</div>
    <div class="muted">Bienvenido a tu panel. Aquí verás tu saldo, productos y accesos rápidos.</div>

    <!-- Botones de comunidad / WhatsApp si están configurados -->
    <div class="contacts">
      ${community ? `<a class="mini" href="${community}" target="_blank" rel="noopener" title="Comunidad">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 .001 14.001A7 7 0 0 0 8 1Zm0 2a5 5 0 0 1 4.9 4H8V3Zm0 10a5 5 0 0 1-4.9-4H8v4Z"/></svg>
        Comunidad
      </a>` : ``}
      ${waHref ? `<a class="mini" href="${waHref}" target="_blank" rel="noopener" title="WhatsApp">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.6 2.4A7.9 7.9 0 0 0 8 0 8 8 0 0 0 1.6 12L0 16l4-1.6A8 8 0 0 0 16 8a7.9 7.9 0 0 0-2.4-5.6ZM8 14.2c-1.2 0-2.3-.3-3.3-.9l-.2-.1-2.4 1 .9-2.5-.2-.2A6.2 6.2 0 1 1 8 14.2Zm3-3.6c-.2-.1-1.1-.5-1.2-.5s-.3-.1-.5.1-.6.5-.7.6-.3.2-.5.1a5 5 0 0 1-1.5-.9 6 6 0 0 1-1.1-1.3c-.1-.2 0-.3.1-.4l.3-.4.1-.2c0-.1 0-.2-.1-.3l-.5-1.2c-.1-.3-.3-.3-.5-.3h-.4c-.2 0-.3.1-.5.3s-.6.5-.6 1.3.6 1.5.7 1.6c.1.2 1.2 1.9 3 2.7.4.2.7.3.9.4.4.1.7.1 1 .1.3 0 .8-.3.9-.6.1-.3.1-.6.1-.6 0-.1-.1-.1-.2-.2Z"/></svg>
        WhatsApp
      </a>` : ``}
    </div>

    <section class="stats" aria-label="Saldos">
      <div class="st">
        <div class="sthead">
          <div class="muted">Crédito en USD</div>
          <a class="mini" href="/comprar-creditos?currency=USD" title="Comprar créditos en USD">+ Comprar créditos</a>
        </div>
        <div style="font-size:22px; font-weight:900; margin-top:6px">${formatAmount(usd.balance, "USD")}</div>
      </div>
      <div class="st">
        <div class="sthead">
          <div class="muted">Crédito en MXN</div>
          <a class="mini" href="/comprar-creditos?currency=MXN" title="Comprar créditos en MXN">+ Comprar créditos</a>
        </div>
        <div style="font-size:22px; font-weight:900; margin-top:6px">${formatAmount(mxn.balance, "MXN")}</div>
      </div>
    </section>

    <div class="section">
      <h2>
        <svg class="spark" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 4.6L18 8.4l-4.2 2.2L12 15l-1.8-4.4L6 8.4l4.2-1.8L12 2zm6 7 1.2 3 3 1.2-3 1.2L18 17l-1.2-3-3-1.2 3-1.2L18 9zM6 14l.9 2.2L9 17l-2.1.8L6 20l-.9-2.2L3 17l2.1-.8L6 14z"/></svg>
        🛍️ Productos digitales
      </h2>
    </div>

    <!-- Tarjeta con textos que cambian -->
    <div class="ticker-wrap">
      <div class="ticker">
        <span class="dot" aria-hidden="true"></span>
        <span id="tickerText" class="ticker-text">Cargando…</span>
      </div>
    </div>

    ${products.length ? `<section class="grid" aria-label="Productos disponibles">${cards}</section>` : empty}

    <div class="footer-space"></div>
  </main>

  <script>
    // Drawer
    (function(){
      const drawer = document.getElementById('drawer');
      const scrim  = document.getElementById('scrim');
      const btn    = document.getElementById('menuBtn');
      function open(){ drawer.classList.add('open'); scrim.classList.add('show'); }
      function close(){ drawer.classList.remove('open'); scrim.classList.remove('show'); }
      btn.addEventListener('click', open);
      scrim.addEventListener('click', close);
      window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });
    })();

    // Estrellas (oscuro)
    (function(){
      const sky = document.getElementById('sky');
      for(let i=0;i<100;i++){
        const s = document.createElement('div');
        s.className = 'star';
        s.style.top  = (Math.random()*100).toFixed(2)+'%';
        s.style.left = (Math.random()*100).toFixed(2)+'%';
        s.style.opacity = (0.35 + Math.random()*0.65).toFixed(2);
        s.style.transform = 'scale(' + (0.6 + Math.random()*1.6).toFixed(2) + ')';
        s.style.animationDelay = (Math.random()*3).toFixed(2)+'s';
        sky.appendChild(s);
      }
      for(let i=0;i<3;i++){
        const sh = document.createElement('div');
        sh.className = 'shoot';
        sh.style.top  = (Math.random()*25).toFixed(2)+'%';
        sh.style.left = (Math.random()*60).toFixed(2)+'%';
        sh.style.animationDelay = (1 + Math.random()*5).toFixed(2)+'s';
        sky.appendChild(sh);
      }
    })();

    // Emojis flotantes (claro)
    (function(){
      const icons = document.getElementById('icons');
      const set = ['🎵','🎬','🎮','📷','🎧','📱','💾','🛒','📺','📀','💡','🚀'];
      for(let i=0;i<28;i++){
        const sp = document.createElement('span');
        sp.textContent = set[i % set.length];
        sp.style.left = (Math.random()*100).toFixed(2)+'%';
        sp.style.top  = (Math.random()*100).toFixed(2)+'%';
        sp.style.animationDuration = (20 + Math.random()*18).toFixed(1)+'s';
        sp.style.animationDelay    = (Math.random()*8).toFixed(1)+'s';
        icons.appendChild(sp);
      }
    })();

    // Tema 🌙/☀️
    (function(){
      const btn   = document.getElementById('mode');
      const sky   = document.getElementById('sky');
      const icons = document.getElementById('icons');
      function apply(mode){
        const light = (mode==='light');
        document.body.classList.toggle('light', light);
        sky.style.display   = light ? 'none'  : 'block';
        icons.style.display = light ? 'block' : 'none';
        btn.textContent = light ? '☀️' : '🌙';
        localStorage.setItem('mode', light ? 'light' : 'dark');
      }
      apply(localStorage.getItem('mode') || 'dark');
      btn.addEventListener('click', ()=> apply(document.body.classList.contains('light')?'dark':'light'));
    })();

    // Dropdown usuario
    (function(){
      const a = document.getElementById('ua');
      const d = document.getElementById('udrop');
      let open = false;
      a.addEventListener('click', (e)=>{ e.stopPropagation(); open=!open; d.style.display = open? 'block':'none'; });
      document.addEventListener('click', ()=>{ if(open){ open=false; d.style.display='none'; }});
    })();

    // Tarjeta de mensajes
    (function(){
      const el = document.getElementById('tickerText');
      const msgs = [
        "⚡ Entrega inmediata",
        "🎁 Ofertas por tiempo limitado",
        "🔒 Pago 100% seguro",
        "⭐ Productos más vendidos",
        "🚀 Activa en segundos",
        "💬 Soporte rápido",
        "💳 Paga con créditos",
        "🎮 Contenido digital al instante",
        "📄 Factura automática",
        "🛒 Compra en 1 click"
      ];
      let i = 0;
      function show(k){
        el.classList.remove('show');
        setTimeout(()=>{ el.textContent = msgs[k % msgs.length]; el.classList.add('show'); }, 80);
      }
      show(0);
      setInterval(()=>{ i = (i+1) % msgs.length; show(i); }, 2600);
    })();
  </script>
</body>
</html>`);
});

module.exports = router;
