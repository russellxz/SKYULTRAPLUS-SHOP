// whatsapp.js — MISMA lógica que bot-cli.js pero como módulo para el panel Admin
// ⚡ Adaptado para Baileys ESM (itsliaaa/baileys) usando dynamic import()
"use strict";

const fs = require("fs");
const path = require("path");
const pino = require("pino");

/* =========================================
   Carga perezosa de Baileys (ESM → CommonJS)
   El fork itsliaaa/baileys es ESM-only, así que
   tenemos que importarlo con import() dinámico.
========================================= */
let _baileys = null;
async function loadBaileys() {
  if (_baileys) return _baileys;
  const mod = await import("@whiskeysockets/baileys");
  _baileys = {
    makeWASocket: mod.default || mod.makeWASocket,
    useMultiFileAuthState: mod.useMultiFileAuthState,
    fetchLatestBaileysVersion: mod.fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore: mod.makeCacheableSignalKeyStore,
  };
  return _baileys;
}

/* =========================================
   Helpers (copiados de bot-cli.js)
========================================= */
const DIGITS = (s = "") => String(s).replace(/\D/g, "");

function normalizePhoneForPairing(input) {
  let s = DIGITS(input);
  if (!s) return "";
  // 🇲🇽 Si empieza con 52 y NO con 521, añade el '1'
  if (s.startsWith("52") && !s.startsWith("521") && s.length >= 12) {
    s = "521" + s.slice(2);
  }
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =========================================
   Estado único del socket
========================================= */
const SESSIONS_DIR = path.resolve(__dirname, "sessions");

let sock = null;
let starting = null;
let stateCtl = null;

let connectedNumber = ""; // número del bot cuando está conectado

/* ===== Newsletter (igual que en el CLI) ===== */
const canalId = "120363266665814365@newsletter";
const canalNombre = "👑 LA SUKI BOT 👑";

function setupConnection(conn) {
  // sendMessage2 con contexto de newsletter (igual)
  conn.sendMessage2 = async (chat, content, m, options = {}) => {
    if (content.sticker) {
      return conn.sendMessage(chat, { sticker: content.sticker }, { quoted: m, ...options });
    }
    const messageOptions = {
      ...content,
      mentions: content.mentions || options.mentions || [],
      contextInfo: {
        ...(content.contextInfo || {}),
        forwardedNewsletterMessageInfo: {
          newsletterJid: canalId,
          serverMessageId: "",
          newsletterName: canalNombre,
        },
        forwardingScore: 9_999_999,
        isForwarded: true,
        mentionedJid: content.mentions || options.mentions || [],
      },
    };
    return conn.sendMessage(
      chat,
      messageOptions,
      {
        quoted: m,
        ephemeralExpiration: 86_400_000,
        disappearingMessagesInChat: 86_400_000,
        ...options,
      }
    );
  };
}

/* =========================================
   Arranque/reutilización del socket
========================================= */
async function startSocketIfNeeded() {
  if (sock) return sock;
  if (starting) return starting;

  starting = (async () => {
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

    // Cargar Baileys de forma asíncrona (ESM)
    const {
      makeWASocket,
      useMultiFileAuthState,
      fetchLatestBaileysVersion,
      makeCacheableSignalKeyStore,
    } = await loadBaileys();

    const { state, saveCreds } = await useMultiFileAuthState(SESSIONS_DIR);
    stateCtl = { state, saveCreds };

    const { version } = await fetchLatestBaileysVersion();

    const s = makeWASocket({
      version,
      logger: pino({ level: "silent" }),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
      },
      // === MISMO browser que el CLI cuando hace pairing por código ===
      browser: ["Windows", "Chrome", "120.0"],
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    setupConnection(s);

    s.ev.on("creds.update", saveCreds);

    s.ev.on("connection.update", ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        try {
          const jid = s.user?.id || "";
          const num = String(jid).split("@")[0].split(":")[0];
          connectedNumber = DIGITS(num);
          console.log("[WA] ✅ Conectado como:", connectedNumber || jid);
        } catch {}
      } else if (connection === "close") {
        const reason = lastDisconnect?.error?.message || "desconocido";
        console.log("[WA] ❌ Conexión cerrada:", reason);
        sock = null;
      }
    });

    sock = s;
    starting = null;
    return sock;
  })();

  return starting;
}

/* =========================================
   API usada por el panel
========================================= */
async function getStatus() {
  try {
    await startSocketIfNeeded();
    const connected = Boolean(sock?.user);
    const number = connected
      ? (connectedNumber || DIGITS((sock.user.id || "").split("@")[0]))
      : "";
    return { connected, number };
  } catch {
    return { connected: false, number: "" };
  }
}

async function requestPairingCode(rawPhone) {
  // → MISMA SECUENCIA DEL CLI
  const phoneDigits = normalizePhoneForPairing(rawPhone);
  if (!phoneDigits) throw new Error("Número inválido. Usa solo dígitos con código de país.");

  const s = await startSocketIfNeeded();

  // si ya hay sesión, no generamos código
  if (s.user) {
    const jid = s.user.id || "";
    const num = DIGITS(jid.split("@")[0]);
    connectedNumber = num;
    console.log("[WA] Ya conectado como", num);
    return null;
  }

  // igual que el CLI: pequeña espera antes de pedir el código
  await sleep(1500);

  const code = await s.requestPairingCode(phoneDigits);
  const pretty = String(code).match(/.{1,4}/g)?.join("-") || String(code);

  console.log("[WA] 🔑 Código de vinculación:", pretty, "(para", phoneDigits, ")");
  return pretty;
}

async function startPairing(rawPhone) {
  const st = await getStatus();
  if (st.connected) return { ok: true, connected: true, number: st.number };
  const code = await requestPairingCode(rawPhone);
  return { ok: Boolean(code), code: code || null, connected: false };
}

async function sendText(toDigits, text) {
  const s = await startSocketIfNeeded();
  if (!s.user) throw new Error("El bot no está conectado todavía.");
  const jid = `${DIGITS(toDigits)}@s.whatsapp.net`;
  return s.sendMessage(jid, { text: String(text || "") });
}

async function logout() {
  try {
    await startSocketIfNeeded();
    if (sock?.logout) await sock.logout();
  } catch {}
  try {
    if (fs.existsSync(SESSIONS_DIR)) fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
  } catch {}
  sock = null;
  connectedNumber = "";
  return true;
}

module.exports = {
  getStatus,
  requestPairingCode,
  startPairing,
  sendText,
  logout,
};
