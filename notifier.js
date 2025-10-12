// notifier.js — watcher de WhatsApp (30s)
"use strict";

const db = require("./db");
let WA = null; try { WA = require("./whatsapp"); } catch {}

/* === WA helpers (tolerantes) === */
const getSock = () => (WA?.getSocket?.() || WA?.socket || WA?.default?.getSocket?.() || WA?.default?.socket || global.WA_CONN || global.sock || null);
const onlyDigits = s => String(s||"").replace(/\D/g,"");
const normForWA = (raw, cc="") => {
  let d = onlyDigits(raw); if(!d) return "";
  d = d.replace(/^00+/,"").replace(/^0+/,""); if(cc && !d.startsWith(cc)) d = cc + d;
  if ((cc==="52"||d.startsWith("52")) && !d.startsWith("521") && d.length>=12) d = "521"+d.slice(2);
  return d;
};
const toJid = d => (d ? d+"@s.whatsapp.net" : null);
async function sendWA(toDigits, text){
  if(!toDigits){ console.warn("[WA] destino vacío"); return false; }
  if (WA?.sendText) { try { await WA.sendText(toDigits, text); return true; } catch(e){ console.error("[WA] sendText:",e?.message); } }
  const sock = getSock(); if(!sock){ console.warn("[WA] sin socket. skip =>",toDigits); return false; }
  const jid = toJid(toDigits);
  try{
    if (sock.sendMessage2) await sock.sendMessage2(jid,{text},null,{});
    else if (sock.sendMessage) await sock.sendMessage(jid,{text},{});
    else return false;
    return true;
  }catch(e){ console.error("[WA] sock:",e?.message); return false; }
}

/* === Settings + URL del sitio (home) === */
const set = (k,d="") => db.getSetting(k,d);
function siteUrl(){
  const s = set("public_base_url","") || set("site_url",""); if(s) return String(s).replace(/\/+$/,"");
  const env = [
    process.env.BASE_URL, process.env.APP_URL, process.env.PUBLIC_BASE_URL,
    process.env.VERCEL_URL && ("https://"+process.env.VERCEL_URL),
    process.env.RENDER_EXTERNAL_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN && ("https://"+process.env.RAILWAY_PUBLIC_DOMAIN)
  ].filter(Boolean)[0];
  return (env?String(env).replace(/\/+$/,""): `http://localhost:${process.env.PORT||3000}`);
}
const ownerDigits = () => normForWA(set("owner_whatsapp","") || set("owner_phone_wa",""), onlyDigits(set("wa_default_cc","")));

/* === noti_log === */
db.prepare(`CREATE TABLE IF NOT EXISTS noti_log(type TEXT,ref_id INTEGER,target TEXT,created_at TEXT,PRIMARY KEY(type,ref_id,target))`).run();
const mark = (t,id,to)=>{ try{ db.prepare(`INSERT OR IGNORE INTO noti_log VALUES(?,?,?,?)`).run(t,id,to,new Date().toISOString()); }catch(e){ console.error("[notifier] mark:",e?.message); } };

/* === utils === */
const money = (a,c)=> (c==="USD"?"$ ": (c||" ") ) + Number(a||0).toFixed(2);
const fullName = u => `${u?.name||""} ${u?.surname||""}`.trim();

/* === mensajes (con tienda + URL del sitio) === */
async function clientPaid(inv,u,p,home){
  const site=set("site_name","SkyShop"), cc=onlyDigits(set("wa_default_cc","")), d=normForWA(u.phone,cc); if(!d) return false;
  const msg = `✅ *Pago exitoso* — ${site}\n\n• Tienda: ${site}\n• Producto: ${p?.name||"—"}\n• Importe: ${money(inv.amount,inv.currency)}\n• Método: ${inv.payment_method||"—"}\n• Fecha: ${(inv.paid_at||inv.created_at||"").replace("T"," ").slice(0,19)}\n• Sitio: ${home}\n\n${(p?.reveal_info||"").trim() ? `*Información revelada:*\n${(p.reveal_info||"").trim()}\n\n`:""}Gracias por tu compra en *${site}*.`;
  return sendWA(d,msg);
}
async function ownerPaid(inv,u,p,home){
  const site=set("site_name","SkyShop"), d=ownerDigits(); if(!d) return false;
  const msg = `🛎️ *Pago recibido* — ${site}\n\n• Tienda: ${site}\n• Producto: ${p?.name||"—"}\n• Importe: ${money(inv.amount,inv.currency)}\n• Método: ${inv.payment_method||"—"}\n• Fecha: ${(inv.paid_at||inv.created_at||"").replace("T"," ").slice(0,19)}\n• Sitio: ${home}\n\n• ClienteID: ${u.id}\n• Usuario: @${u.username} · ${fullName(u)}\n• Email: ${u.email}\n• Teléfono: ${u.phone||"—"}`;
  return sendWA(d,msg);
}
async function clientPend(inv,u,p,home){
  const site=set("site_name","SkyShop"), cc=onlyDigits(set("wa_default_cc","")), d=normForWA(u.phone,cc); if(!d) return false;
  const msg = `🧾 *Tienes una factura pendiente* — ${site}\n\n• Tienda: ${site}\n• Factura: ${inv.number||inv.id}\n• Producto: ${p?.name||"—"}\n• Importe: ${money(inv.amount,inv.currency)}\n• Fecha: ${(inv.created_at||"").replace("T"," ").slice(0,19)}\n\nVisítanos: ${home}\nSi ya pagaste, ignora este mensaje.`;
  return sendWA(d,msg);
}
async function ownerPend(inv,u,p,home){
  const site=set("site_name","SkyShop"), d=ownerDigits(); if(!d) return false;
  const msg = `⏳ *Factura pendiente* — ${site}\n\n• Tienda: ${site}\n• Factura: ${inv.number||inv.id}\n• Producto: ${p?.name||"—"}\n• Importe: ${money(inv.amount,inv.currency)}\n• Fecha: ${(inv.created_at||"").replace("T"," ").slice(0,19)}\n• Sitio: ${home}\n\n• ClienteID: ${u.id}\n• Usuario: @${u.username} · ${fullName(u)}\n• Email: ${u.email}\n• Teléfono: ${u.phone||"—"}`;
  return sendWA(d,msg);
}
async function clientCancel(s,u,p,home){
  const site=set("site_name","SkyShop"), cc=onlyDigits(set("wa_default_cc","")), d=normForWA(u.phone,cc); if(!d) return false;
  const msg = `⚠️ *Tu servicio ha sido cancelado* — ${site}\n\n• Tienda: ${site}\n• Producto: ${p?.name||"—"}\n• Cancelado el: ${(s.canceled_at||"").replace("T"," ").slice(0,19)}\n• Sitio: ${home}\n\nSi fue un error, contáctanos.`;
  return sendWA(d,msg);
}
async function ownerCancel(s,u,p,home){
  const site=set("site_name","SkyShop"), d=ownerDigits(); if(!d) return false;
  const msg = `🛑 *Servicio cancelado* — ${site}\n\n• Tienda: ${site}\n• Producto: ${p?.name||"—"}\n• Cancelado el: ${(s.canceled_at||"").replace("T"," ").slice(0,19)}\n• Sitio: ${home}\n\n• ClienteID: ${u.id}\n• Usuario: @${u.username} · ${fullName(u)}\n• Email: ${u.email}\n• Teléfono: ${u.phone||"—"}`;
  return sendWA(d,msg);
}

/* === selects === */
const qPaid = () => db.prepare(`
  SELECT i.*,u.username,u.name,u.surname,u.email,u.phone,p.name AS product_name,p.reveal_info
  FROM invoices i JOIN users u ON u.id=i.user_id LEFT JOIN products p ON p.id=i.product_id
  WHERE i.status='paid' AND NOT EXISTS(SELECT 1 FROM noti_log n WHERE n.type='invoice_paid' AND n.ref_id=i.id AND n.target='client')
`).all();
const qPend = () => db.prepare(`
  SELECT i.*,u.username,u.name,u.surname,u.email,u.phone,p.name AS product_name
  FROM invoices i JOIN users u ON u.id=i.user_id LEFT JOIN products p ON p.id=i.product_id
  WHERE i.status IN ('pending','unpaid','overdue') AND NOT EXISTS(SELECT 1 FROM noti_log n WHERE n.type='invoice_pending' AND n.ref_id=i.id AND n.target='client')
`).all();
const qCanc = () => db.prepare(`
  SELECT s.*,u.username,u.name,u.surname,u.email,u.phone,p.name AS product_name
  FROM services s JOIN users u ON u.id=s.user_id JOIN products p ON p.id=s.product_id
  WHERE s.status='canceled' AND NOT EXISTS(SELECT 1 FROM noti_log n WHERE n.type='service_canceled' AND n.ref_id=s.id AND n.target='client')
`).all();

/* === runner === */
let timer=null, running=false;
async function runOnce(){
  if(running) return; running=true;
  const home = siteUrl();
  try{
    for(const inv of qPaid()){
      const p={id:inv.product_id,name:inv.product_name,reveal_info:inv.reveal_info};
      if(await clientPaid(inv,inv,p,home)) mark("invoice_paid",inv.id,"client");
      if(await ownerPaid(inv,inv,p,home))  mark("invoice_paid",inv.id,"owner");
    }
    for(const inv of qPend()){
      const p={id:inv.product_id,name:inv.product_name};
      if(await clientPend(inv,inv,p,home)) mark("invoice_pending",inv.id,"client");
      if(await ownerPend(inv,inv,p,home))  mark("invoice_pending",inv.id,"owner");
    }
    for(const s of qCanc()){
      const p={id:s.product_id,name:s.product_name};
      if(await clientCancel(s,s,p,home)) mark("service_canceled",s.id,"client");
      if(await ownerCancel(s,s,p,home))  mark("service_canceled",s.id,"owner");
    }
  }catch(e){ console.error("[notifier] run:",e?.message); }
  finally{ running=false; }
}
function start(ms=30_000){
  if(timer) return;
  console.log(`[notifier] iniciado · ${ms}ms · site=${siteUrl()} · owner=${ownerDigits()||"(no)"}`);
  timer=setInterval(runOnce,ms); setTimeout(runOnce,1500);
}
function stop(){ if(timer){ clearInterval(timer); timer=null; } }

module.exports = { start, stop, runOnce };