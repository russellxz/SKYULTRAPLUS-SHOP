"use strict";

const nodemailer = require("nodemailer");
const db = require("./db");

function getTransporter() {
  const host = db.getSetting("smtp_host", "");
  const port = parseInt(db.getSetting("smtp_port", "587"), 10) || 587;
  const user = db.getSetting("smtp_user", "");
  const pass = db.getSetting("smtp_pass", "");
  if (!host || !user || !pass) throw new Error("SMTP no configurado");

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 TLS implícito
    auth: { user, pass },
  });
}

async function verify() {
  const t = getTransporter();
  await t.verify();
  return true;
}

async function sendMail({ to, subject, html }) {
  const from = db.getSetting("smtp_from", "") || db.getSetting("smtp_user", "");
  const name = db.getSetting("smtp_from_name", "SkyShop");
  const t = getTransporter();
  const info = await t.sendMail({
    from: name ? `"${name}" <${from}>` : from,
    to,
    subject: subject || "(sin asunto)",
    html: html || "<p>(sin contenido)</p>",
  });
  return info;
}

module.exports = { verify, sendMail };