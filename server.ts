import express from "express";
import path from "path";
import fs from "fs";
import pino from "pino";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket, Browsers, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import { createServer as createViteServer } from "vite";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";

const app = express();
const PORT = 3000;

app.use(express.json());

interface WAState {
  status: "disconnected" | "connecting" | "pairing-code-ready" | "linking" | "connected" | "error";
  phone: string;
  pairingCode: string;
  profile: {
    name: string;
    phone: string;
  } | null;
  error: string | null;
}

// --- VPS LOG CAPTURE RING BUFFER ---
export interface VpsLogEntry {
  id: number;
  time: string;
  level: "info" | "warn" | "error" | "cmd" | "bot" | "wa";
  message: string;
}

const vpsLogs: VpsLogEntry[] = [];
let logIdCounter = 1;

export function addVpsLog(level: VpsLogEntry["level"], message: string) {
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  vpsLogs.push({
    id: logIdCounter++,
    time,
    level,
    message,
  });
  if (vpsLogs.length > 600) {
    vpsLogs.shift();
  }
}

// Hook into console.log, console.warn, console.error
const origConsoleLog = console.log;
const origConsoleWarn = console.warn;
const origConsoleError = console.error;

console.log = (...args: any[]) => {
  origConsoleLog(...args);
  try {
    const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    const level: VpsLogEntry["level"] = msg.includes("[Telegram") ? "bot" : msg.includes("[Baileys") || msg.includes("[Connection") ? "wa" : "info";
    addVpsLog(level, msg);
  } catch {}
};

console.warn = (...args: any[]) => {
  origConsoleWarn(...args);
  try {
    const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    addVpsLog("warn", msg);
  } catch {}
};

console.error = (...args: any[]) => {
  origConsoleError(...args);
  try {
    const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    addVpsLog("error", msg);
  } catch {}
};

addVpsLog("info", `🐧 [Linux VPS] Ubuntu 22.04 LTS (x86_64) - Node.js ${process.version} environment active`);
addVpsLog("info", `📁 [Workspace] Standalone bot file ready at /app/applet/bot.js`);


// Map key = phone (stripped digits), value = Active Baileys session
interface ConnectedSession {
  phoneNumber: string;
  sock: any;
  status: "disconnected" | "connecting" | "pairing-code-ready" | "linking" | "connected" | "error";
  pairingCode: string;
  profile: {
    name: string;
    phone: string;
  } | null;
  error: string | null;
}

const activeSessions = new Map<string, ConnectedSession>();
let currentActivePhone: string | null = null;

// Global session variables maintained for backwards compatibility with the existing simple React frontend
let sessionState: WAState = {
  status: "disconnected",
  phone: "",
  pairingCode: "",
  profile: null,
  error: null,
};

let activeSock: any = null;

// --- LOCAL DATABASE SCHEMA ---
interface SavedAccount {
  phone: string;
  name: string;
  linkedAt: string;
  addedByChatId?: number;
  addedByName?: string;
}

const DB_FILE = path.join(process.cwd(), "db_accounts.json");

// --- TELEGRAM MODULES AND DATA STORES ---
const TG_DB_FILE = path.join(process.cwd(), "db_telegram_accounts.json");
const TG_API_ID = Number(process.env.TELEGRAM_API_ID || "2040"); 
const TG_API_HASH = process.env.TELEGRAM_API_HASH || "b18441a1fff1153b5436ca404d41255e";

interface SavedTgAccount {
  phone: string;
  name: string;
  username: string;
  session: string;
  linkedAt: string;
  status: "connected" | "disconnected";
}

const activeTgSessions = new Map<string, { client: any; status: string }>();
const pendingTgLogins = new Map<string, {
  client: any;
  phoneNumber: string;
  phoneCodeHash: string;
  expiresAt: number;
}>();

function getSavedTgAccountsList(): SavedTgAccount[] {
  if (!fs.existsSync(TG_DB_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(TG_DB_FILE, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function saveTgAccountToDb(phone: string, name: string, username: string, session: string) {
  const accounts = getSavedTgAccountsList();
  const existingIdx = accounts.findIndex((acc) => acc.phone === phone);

  if (existingIdx > -1) {
    accounts[existingIdx].name = name;
    accounts[existingIdx].username = username;
    accounts[existingIdx].session = session;
    accounts[existingIdx].linkedAt = new Date().toISOString();
    accounts[existingIdx].status = "connected";
  } else {
    accounts.push({
      phone,
      name,
      username,
      session,
      linkedAt: new Date().toISOString(),
      status: "connected"
    });
  }

  try {
    fs.writeFileSync(TG_DB_FILE, JSON.stringify(accounts, null, 2), "utf-8");
    console.log(`[DB TG] Saved Telegram account +${phone} successfully.`);
  } catch (e) {
    console.error("[DB TG] Failed to save TG account:", e);
  }
}

function deleteTgAccountFromDb(phone: string): boolean {
  const session = activeTgSessions.get(phone);
  if (session && session.client) {
    try {
      session.client.disconnect();
    } catch {}
  }
  activeTgSessions.delete(phone);

  const accounts = getSavedTgAccountsList();
  const filtered = accounts.filter((acc) => acc.phone !== phone);
  const existed = accounts.length !== filtered.length;

  try {
    fs.writeFileSync(TG_DB_FILE, JSON.stringify(filtered, null, 2), "utf-8");
  } catch (e) {
    console.error("[DB TG] Failed to delete TG account:", e);
  }

  return existed;
}

function normalizePhone(raw: string): string {
  // 1. Remove all non-digit characters
  let clean = raw.replace(/\D/g, "");
  if (!clean) return "";

  // 2. Normalize Bangladeshi mobile numbers starting with local 0-prefix or 1-prefix
  if (clean.startsWith("0") && clean.length === 11) {
    clean = "88" + clean;
  } else if (clean.startsWith("1") && clean.length === 10) {
    clean = "880" + clean;
  }

  // 3. Strip extra leading zero from national part for known international country codes
  // e.g. +44 07911 123456 -> 4407911123456 -> 447911123456
  const commonCodes = ["880", "91", "92", "977", "94", "960", "93", "966", "971", "1", "44", "968", "974", "965", "964", "962", "961", "967", "60", "65", "81", "82", "62", "63", "66", "84", "95", "855", "52", "55", "54", "57", "51", "56", "39", "34", "33", "49", "90", "31", "32", "41", "46", "351", "30", "43", "48", "7", "61", "64", "27", "20", "234", "254", "212"];
  commonCodes.sort((a, b) => b.length - a.length);
  
  for (const cc of commonCodes) {
    if (clean.startsWith(cc)) {
      let national = clean.substring(cc.length);
      if (national.startsWith("0")) {
        while (national.startsWith("0")) {
          national = national.substring(1);
        }
        clean = `${cc}${national}`;
      }
      break;
    }
  }

  return clean;
}

function startTgUserbotListeners(client: TelegramClient, phone: string) {
  try {
    client.addEventHandler(async (event: any) => {
      const message = event.message;
      if (!message || !message.message) return;
      
      const senderId = message.senderId ? message.senderId.toString() : "unknown";
      const text = message.message;
      console.log(`[Telegram Userbot +${phone}] Received message from ${senderId}: "${text}"`);
      
      const cleanText = text.toLowerCase().trim();
      if (cleanText === "ping") {
        await client.sendMessage(message.chatId, { message: "Pong! 🤖 (Checked & Verified by Tele-Gateway Client)" });
      } else if (cleanText === ".help" || cleanText === "help") {
        await client.sendMessage(message.chatId, { message: "Hello! This account is managed by Tele-Gateway Bot Helper. Commands: ping, info" });
      } else if (cleanText === "info") {
        await client.sendMessage(message.chatId, { message: "Connected successfully. Telegram Multi-Account Controller is operational. 🌐" });
      }
    }, new NewMessage({}));
    console.log(`[Telegram Userbot +${phone}] Message handlers registered successfully.`);
  } catch (err) {
    console.error(`[Telegram Userbot +${phone}] Failed to register event handlers:`, err);
  }
}

async function getActiveTgClient(phone: string): Promise<TelegramClient> {
  const existing = activeTgSessions.get(phone);
  if (existing && existing.client && existing.client.connected) {
    return existing.client;
  }

  const accounts = getSavedTgAccountsList();
  const acc = accounts.find(a => a.phone === phone);
  if (!acc || !acc.session) {
    throw new Error(`Telegram session not found for phone +${phone}`);
  }

  console.log(`[Telegram Client] Connecting client for +${phone}...`);
  const client = new TelegramClient(
    new StringSession(acc.session),
    TG_API_ID,
    TG_API_HASH,
    { connectionRetries: 3 }
  );
  await client.connect();
  
  activeTgSessions.set(phone, { client, status: "connected" });
  return client;
}

async function initAllTgSessions() {
  const accounts = getSavedTgAccountsList();
  console.log(`[Telegram Service] Restoring ${accounts.length} saved Telegram sessions...`);
  
  for (const acc of accounts) {
    if (acc.session && acc.status === "connected") {
      try {
        console.log(`[Telegram Service] Restoring session for +${acc.phone}...`);
        const client = new TelegramClient(
          new StringSession(acc.session),
          TG_API_ID,
          TG_API_HASH,
          { connectionRetries: 1 }
        );
        await client.connect();
        activeTgSessions.set(acc.phone, { client, status: "connected" });
        startTgUserbotListeners(client, acc.phone);
        console.log(`[Telegram Service] Restored session +${acc.phone} successfully.`);
      } catch (err) {
        console.error(`[Telegram Service] Failed to restore session for +${acc.phone}:`, err);
      }
    }
  }
}

// Store temporary mapping of phone numbers being linked via Telegram to their owner Telegram Chat IDs
const linkingOwners = new Map<string, { chatId: number; name: string }>();

function getSavedAccountsList(): SavedAccount[] {
  if (!fs.existsSync(DB_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    console.error("[DB] Error reading db_accounts.json, using empty array:", e);
    return [];
  }
}

function saveAccountToDb(phone: string, name: string, addedByChatId?: number, addedByName?: string) {
  const accounts = getSavedAccountsList();
  const existingIdx = accounts.findIndex(acc => acc.phone === phone);
  const cleanName = name || "WhatsApp User";

  if (existingIdx > -1) {
    accounts[existingIdx].name = cleanName;
    accounts[existingIdx].linkedAt = new Date().toISOString();
    if (addedByChatId !== undefined) {
      accounts[existingIdx].addedByChatId = addedByChatId;
    }
    if (addedByName !== undefined) {
      accounts[existingIdx].addedByName = addedByName;
    }
  } else {
    accounts.push({
      phone,
      name: cleanName,
      linkedAt: new Date().toISOString(),
      addedByChatId,
      addedByName
    });
  }

  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(accounts, null, 2), "utf-8");
    console.log(`[DB] Account +${phone} saved successfully to local database (AddedBy: ${addedByName || "System"}).`);
  } catch (e) {
    console.error("[DB] Failed to save account to db_accounts.json:", e);
  }
}

function deleteAccountFromDb(phone: string): boolean {
  console.log(`[DB] Request to delete account +${phone}`);
  
  // Cleanly terminate active socket connection
  const session = activeSessions.get(phone);
  if (session) {
    if (session.sock) {
      try {
        session.sock.end(undefined);
      } catch (e) {}
    }
    activeSessions.delete(phone);
  }

  // Clear credentials folders safely
  clearSessionDirectoryForPhone(phone);

  const accounts = getSavedAccountsList();
  const filtered = accounts.filter(acc => acc.phone !== phone);
  const existed = accounts.length !== filtered.length;

  if (existed) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(filtered, null, 2), "utf-8");
      console.log(`[DB] Account +${phone} cleared from the database file.`);
    } catch (e) {
      console.error("[DB] Failed to write database file during deletion:", e);
    }
  }

  // Fallback active session pointer
  if (currentActivePhone === phone) {
    currentActivePhone = filtered.length > 0 ? filtered[0].phone : null;
  }
  updateGlobalSessionStateToSelectedActive();

  return existed;
}

// Sync global variables so Web UI's /api/status endpoint behaves correctly
function updateGlobalSessionStateToSelectedActive() {
  if (!currentActivePhone) {
    sessionState = {
      status: "disconnected",
      phone: "",
      pairingCode: "",
      profile: null,
      error: null,
    };
    activeSock = null;
    return;
  }

  const session = activeSessions.get(currentActivePhone);
  if (session) {
    sessionState = {
      status: session.status,
      phone: session.phoneNumber,
      pairingCode: session.pairingCode,
      profile: session.profile,
      error: session.error,
    };
    activeSock = session.sock;
  } else {
    sessionState = {
      status: "disconnected",
      phone: currentActivePhone,
      pairingCode: "",
      profile: null,
      error: null,
    };
    activeSock = null;
  }
}

// Helper to remove individual phone sessions directory
function clearSessionDirectoryForPhone(phone: string) {
  const dir = path.join(process.cwd(), `whatsapp_auth_session_${phone}`);
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`Cleared session folder: whatsapp_auth_session_${phone}`);
    } catch (e) {
      console.error(`Error deleting credentials directory for +${phone}:`, e);
    }
  }
}

// Function to initialize individual WhatsApp sockets per phone number
async function initWhatsApp(phoneNumber: string, isReconnect = false) {
  try {
    console.log(`[WhatsApp init] Phone: ${phoneNumber}, Reconnect: ${isReconnect}`);
    
    // Safety check: close any active connection running on this number
    const existing = activeSessions.get(phoneNumber);
    if (existing && existing.sock) {
      try {
        existing.sock.end(undefined);
      } catch (e) {}
    }

    if (!isReconnect) {
      clearSessionDirectoryForPhone(phoneNumber);
      activeSessions.set(phoneNumber, {
        phoneNumber,
        sock: null,
        status: "connecting",
        pairingCode: "",
        profile: null,
        error: null
      });
    } else {
      const oldData = activeSessions.get(phoneNumber);
      activeSessions.set(phoneNumber, {
        phoneNumber,
        sock: null,
        status: "connecting",
        pairingCode: oldData?.pairingCode || "",
        profile: oldData?.profile || null,
        error: null
      });
    }

    updateGlobalSessionStateToSelectedActive();

    // Store in unique auth folders per account
    const authDir = `whatsapp_auth_session_${phoneNumber}`;
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    // Fetch modern safe WhatsApp web browser version parameters
    let version: any = [2, 3000, 1035194821];
    try {
      const fetched = await fetchLatestBaileysVersion();
      if (fetched && fetched.version) {
        version = fetched.version;
      }
    } catch (vErr) {
      console.warn("Dynamic version fetch failed. Using default safest fallback", vErr);
    }

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }) as any,
      browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // Update session instance socket pointer
    const sessRef = activeSessions.get(phoneNumber);
    if (sessRef) {
      sessRef.sock = sock;
    }

    // Keep global activeSock pointer synced if it matches active selected
    if (currentActivePhone === phoneNumber) {
      activeSock = sock;
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;
      console.log(`[Connection Update] +${phoneNumber} =>`, connection);

      const sess = activeSessions.get(phoneNumber);
      if (!sess) return;

      if (connection === "connecting") {
        if (sess.status !== "pairing-code-ready" && sess.status !== "connected") {
          sess.status = "connecting";
        }
      } else if (connection === "open") {
        sess.status = "connected";
        const cleanJid = sock.user?.id.split("@")[0] || "";
        sess.profile = {
          name: sock.user?.name || "WhatsApp User",
          phone: cleanJid.split(":")[0],
        };
        console.log(`[WhatsApp Connected] +${phoneNumber} is now logged in as:`, sess.profile.name);

        // Persistent save in db_accounts.json local database with Telegram owner attribution if available
        const owner = linkingOwners.get(phoneNumber);
        saveAccountToDb(
          phoneNumber, 
          sock.user?.name || "", 
          owner?.chatId, 
          owner?.name
        );

        // Notify the Telegram user who linked this account
        if (owner?.chatId) {
          sendTelegramMessage(
            owner.chatId,
            `🎉 *হোয়াটসঅ্যাপ লিঙ্ক সম্পন্ন!* \n\nআপনার হোয়াটসঅ্যাপ অ্যাকাউন্ট (+${phoneNumber}) সফলভাবে যুক্ত করা হয়েছে এবং আপনার টেলিগ্রাম আইডি ও অ্যাকাউন্টের সাথে লিঙ্ক করা হয়েছে।`
          ).catch(e => console.error("[Telegram notify] error:", e));
        }

        // Keep global variables in sync
        updateGlobalSessionStateToSelectedActive();

        // Send a self validation text message
        try {
          const userJid = sock.user?.id;
          if (userJid) {
            await sock.sendMessage(userJid, {
              text: `🎉 *WhatsApp Verification Account Connected* \n\nআপনার ডিভাইসটি লিঙ্কফাইতে সফলভাবে যুক্ত হয়েছে এবং লোকাল ডাটাবেজে সেভ হয়েছে।`,
            });
          }
        } catch (msgErr) {
          console.error(`Failed to send self greeting message for +${phoneNumber}:`, msgErr);
        }
      } else if (connection === "close") {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        console.log(`[Connection Closed] +${phoneNumber} StatusCode: ${statusCode}, LoggedOut: ${loggedOut}`);

        if (loggedOut) {
          sess.status = "disconnected";
          sess.profile = null;
          sess.sock = null;
          deleteAccountFromDb(phoneNumber);
          updateGlobalSessionStateToSelectedActive();
        } else {
          sess.status = "connecting";
          updateGlobalSessionStateToSelectedActive();

          // Smooth exponential socket reconnect retry
          console.log(`Scheduling auto silent socket recovery for +${phoneNumber} in 3 seconds...`);
          setTimeout(() => {
            const currentVal = activeSessions.get(phoneNumber);
            if (currentVal && currentVal.status !== "disconnected") {
              initWhatsApp(phoneNumber, true);
            }
          }, 3000);
        }
      }
    });

    // Request the multi-factor validation pairing code after brief start delay
    setTimeout(async () => {
      try {
        const sess = activeSessions.get(phoneNumber);
        if (!sess) return;

        if (!sock.authState.creds.registered) {
          if (!isReconnect) {
            console.log(`[Baileys Status] Launching Pairing Code request for phone: ${phoneNumber}`);
            const rawCode = await sock.requestPairingCode(phoneNumber);
            
            let formattedCode = rawCode;
            if (rawCode && rawCode.length === 8) {
              formattedCode = `${rawCode.substring(0, 4)}-${rawCode.substring(4)}`;
            }
            
            sess.status = "pairing-code-ready";
            sess.pairingCode = formattedCode;
            updateGlobalSessionStateToSelectedActive();
            console.log(`[Baileys Code] Generated pairing code for +${phoneNumber} is: ${formattedCode}`);
          } else {
            console.log(`[Baileys Sync] Reconnecting active key sessions for +${phoneNumber}. Ready.`);
          }
        } else {
          if (sess.status !== "connected") {
            sess.status = "connecting";
            updateGlobalSessionStateToSelectedActive();
          }
        }
      } catch (err: any) {
        console.error(`Pairing code handshake failed for +${phoneNumber}:`, err);
        const sess = activeSessions.get(phoneNumber);
        if (sess) {
          sess.status = "error";
          sess.error = err.message || "Failed to handshake with standard WhatsApp system.";
          updateGlobalSessionStateToSelectedActive();
        }
      }
    }, 2000);

  } catch (err: any) {
    console.error(`Fatal root initialization exception for +${phoneNumber}:`, err);
    const sess = activeSessions.get(phoneNumber);
    if (sess) {
      sess.status = "error";
      sess.error = err.message || "Root activation initialization error.";
      updateGlobalSessionStateToSelectedActive();
    }
  }
}

// --- TELEGRAM BOT SERVICE ---
let TG_TOKEN = "8847916537:AAFC_L4RgUgO_molInYI0FKhgpmVElhwFHY";

export const tgBotInfo = {
  username: "checking...",
  id: "",
  name: "Linkify Bot",
  status: "initializing",
  token: TG_TOKEN,
  lastPing: new Date().toISOString()
};

// Dynamically sync and prioritize the custom bot token from ws.py or .env
try {
  const wsPyPath = path.join(process.cwd(), "ws.py");
  if (fs.existsSync(wsPyPath)) {
    const pyContent = fs.readFileSync(wsPyPath, "utf-8");
    const pyMatch = pyContent.match(/TG_TOKEN\s*=\s*["']([^"']+)["']/);
    if (pyMatch && pyMatch[1]) {
      TG_TOKEN = pyMatch[1].trim();
      tgBotInfo.token = TG_TOKEN;
      console.log(`[Telegram Bot] Successfully synced and applied TG_TOKEN from ws.py: ${TG_TOKEN.substring(0, 8)}...`);
    }
  }
  if (process.env.TG_TOKEN) {
    TG_TOKEN = process.env.TG_TOKEN.trim();
    tgBotInfo.token = TG_TOKEN;
    console.log(`[Telegram Bot] Applied TG_TOKEN from environment variables: ${TG_TOKEN.substring(0, 8)}...`);
  }
} catch (e: any) {
  console.error("[Telegram Bot] Tried syncing TG_TOKEN from ws.py but failed:", e.message || e);
}

let TG_API_URL = `https://api.telegram.org/bot${TG_TOKEN}`;

// ==========================================
// Premium Emoji Database & Utilities (All-in-One)
// ==========================================
export const PEM: Record<string, string> = {
  "ok": '<tg-emoji emoji-id="5352694861990501856">✅</tg-emoji>',
  "no": '<tg-emoji emoji-id="5420130255174145507">❌</tg-emoji>',
  "warn": '<tg-emoji emoji-id="5336944168944047463">⚠️</tg-emoji>',
  "admin": '<tg-emoji emoji-id="5353032893096567467">📊</tg-emoji>',
  "user": '<tg-emoji emoji-id="5429274992166609833">👤</tg-emoji>',
  "file": '<tg-emoji emoji-id="5352721946054268944">📁</tg-emoji>',
  "rocket": '<tg-emoji emoji-id="5352597830089347330">🚀</tg-emoji>',
  "graph": '<tg-emoji emoji-id="5352877703043258544">📈</tg-emoji>',
  "money": '<tg-emoji emoji-id="5440896830072179569">💸</tg-emoji>',
  "cash": '<tg-emoji emoji-id="5440896830072179569">💵</tg-emoji>',
  "lock": '<tg-emoji emoji-id="5296369303661067030">🔒</tg-emoji>',
  "bullet": '<tg-emoji emoji-id="4990307318513009602">▪️</tg-emoji>',
  "email": '<tg-emoji emoji-id="4970246557065544891">📧</tg-emoji>',
  "phone": '<tg-emoji emoji-id="5922665746910941123">📞</tg-emoji>',
  "party": '<tg-emoji emoji-id="5461151367559141950">🎉</tg-emoji>',
  "gift": '<tg-emoji emoji-id="5913600088856334619">🎁</tg-emoji>',
  "msg": '<tg-emoji emoji-id="5337302974806922068">💬</tg-emoji>',
  "gear": '<tg-emoji emoji-id="5420155432272438703">⚙️</tg-emoji>',
  "link": '<tg-emoji emoji-id="5420517437885943844">🔗</tg-emoji>',
  "trash": '<tg-emoji emoji-id="5796499549287615611">🗑</tg-emoji>',
  "upload": '<tg-emoji emoji-id="5445355530111437729">📤</tg-emoji>',
  "world": '<tg-emoji emoji-id="5336972142066047577">🌐</tg-emoji>',
  "num": '<tg-emoji emoji-id="5303214794336125778">🔢</tg-emoji>',
  "pin": '<tg-emoji emoji-id="5352922460897452503">📍</tg-emoji>',
  "star": '<tg-emoji emoji-id="5352552689983067014">✨</tg-emoji>',
  "hi": '<tg-emoji emoji-id="5353027129250453493">👋</tg-emoji>',
  "shopping_bags": '<tg-emoji emoji-id="4958714256343171878">🛍️</tg-emoji>',
  "lightning": '<tg-emoji emoji-id="5240122519326860770">⚡</tg-emoji>',
  "tag": '<tg-emoji emoji-id="5240228673738527951">🏷</tg-emoji>',
  "bookmark": '<tg-emoji emoji-id="5240228673738527951">🔖</tg-emoji>',
  "card": '<tg-emoji emoji-id="5429452906891880671">💳</tg-emoji>',
  "diamond": '<tg-emoji emoji-id="5352838545826420397">💎</tg-emoji>',
  "crown": '<tg-emoji emoji-id="5353032893096567467">👑</tg-emoji>',
  "fire": '<tg-emoji emoji-id="5429362935916962442">🔥</tg-emoji>',
  "robot": '<tg-emoji emoji-id="5857154735299104907">🤖</tg-emoji>',
  "coin": '<tg-emoji emoji-id="5348469219761626211">🪙</tg-emoji>',
  "info": '<tg-emoji emoji-id="5438411478526892601">ℹ️</tg-emoji>',
  "referral": '<tg-emoji emoji-id="5429410266456564369">👥</tg-emoji>',
  "balance": '<tg-emoji emoji-id="5429452906891880671">💳</tg-emoji>',
  "leaderboard": '<tg-emoji emoji-id="5848402833195406382">🏆</tg-emoji>',
  "arrow_right": '<tg-emoji emoji-id="6048465553759147899">➡️</tg-emoji>',
  "back": '<tg-emoji emoji-id="5438541186539232243">🔙</tg-emoji>',
  "clock": '<tg-emoji emoji-id="5429271062271535569">🕓</tg-emoji>',
  "point_up": '<tg-emoji emoji-id="5019617635629794161">☝</tg-emoji>'
};

export const GLOBAL_BODY_EMOJIS: Record<string, string> = {
  "💸": "5440896830072179569",
  "💵": "5440896830072179569",
  "🔒": "5296369303661067030",
  "🔐": "5296369303661067030",
  "▪️": "4990307318513009602",
  "▪": "4990307318513009602",
  "📧": "4970246557065544891",
  "✉️": "4970246557065544891",
  "✉": "4970246557065544891",
  "📞": "5922665746910941123",
  "🎉": "5461151367559141950",
  "👤": "5429274992166609833",
  "🛍️": "4958714256343171878",
  "🛍": "4958714256343171878",
  "🔖": "5240228673738527951",
  "🏷️": "5240228673738527951",
  "🏷": "5240228673738527951",
  "📈": "5352877703043258544",
  "💳": "5429452906891880671",
  "✅": "5352694861990501856",
  "🟡": "5438541186539232243",
  "🟣": "5239965456667812809",
  "🟠": "5237806896299157399",
  "⚡": "5240122519326860770",
  "🇧🇩": "5291824687096027834",
  "🇮🇳": "5291933173674957761",
  "🇬🇧": "5293993521026453119",
  "🛒": "5312361253610475399",
  "👇": "5231102735817918643",
  "🎧": "5258474669769497337",
  "👨💻": "5418063924933173277",
  "📦": "5388683870432410767",
  "💡": "5429492566619892958",
  "🖥️": "5318834134397770844",
  "🖥": "5318834134397770844",
  "👥": "5325926401008746697",
  "🤖": "5857154735299104907",
  "◀️": "5438541186539232243",
  "◀": "5438541186539232243",
  "🟢": "5192812028632274956",
  "🗑️": "5796499549287615611",
  "🗑": "5796499549287615611",
  "📋": "5435970940670320222",
  "▶️": "5208607440878197365",
  "▶": "5208607440878197365",
  "⏹️": "5413328053474443870",
  "⏹": "5413328053474443870",
  "🔄": "5438433185291611807",
  "🔴": "5364250321176505463",
  "🔎": "5258396243666681152",
  "🔍": "5463352748751753567",
  "📛": "5255835635704408236",
  "💾": "5373342633798167891",
  "🧠": "5336991770066559836",
  "⏱️": "5947290074319162163",
  "⏱": "5947290074319162163",
  "👑": "5353032893096567467",
  "➖": "5870818207383686839",
  "🚫": "5334807341109908955",
  "😒": "5334763399299506604",
  "🌐": "5336972142066047577",
  "🌟": "5337102391244263212",
  "🕓": "5336983442125001376",
  "⌛": "5337172996211648018",
  "💬": "5337302974806922068",
  "🍏": "5337132498965010628",
  "❔": "5336850036145823599",
  "⚠️": "5336944168944047463",
  "🔥": "5429362935916962442",
  "🥚": "5348390922507817684",
  "👨⚖": "5334763399299506604",
  "👨⚖️": "5334763399299506604",
  "🐁": "5348494358205207761",
  "🧻": "5348486915026884464",
  "⚗": "5346311574221000149",
  "🛴": "5348075478634766440",
  "📊": "5429571662737611814",
  "🔢": "5352862640592949843",
  "📁": "5352721946054268944",
  "🚀": "5352597830089347330",
  "💎": "5352838545826420397",
  "📍": "5352922460897452503",
  "👋": "5353027129250453493",
  "1️⃣": "6240078725031923871",
  "2️⃣": "5237806896299157399",
  "3️⃣": "5239965456667812809",
  "4️⃣": "5237911487342751418",
  "5️⃣": "5240278297790686165",
  "6️⃣": "5237964637563036583",
  "7️⃣": "5240349778931404422",
  "8️⃣": "5240346884123436723",
  "9️⃣": "5240268144487999429",
  "🔤": "5352727417842606016",
  "📣": "5352980533150259581",
  "📤": "5353001161878182134",
  "✨": "5352552689983067014",
  "🔹": "5352638632278660622",
  "🎙": "5355102594886833928",
  "💴": "5352985330628730418",
  "📅": "5352585194295564660",
  "📴": "5352974971167611327",
  "✏️": "5395444784611480792",
  "✏": "5395444784611480792",
  "📱": "5922665746910941123",
  "🔗": "5420517437885943844",
  "❌": "5420130255174145507",
  "⚙️": "5420155432272438703",
  "⚙": "5420155432272438703",
  "🛠": "5420155432272438703",
  "🫂": "5420145051336485498",
  "➕": "5420323438508155202",
  "🎁": "5913600088856334619",
  "🏢": "5420156334215565595",
  "📝": "5192739271886282680",
  "🛡": "5190447043545438788",
  "🤝": "5192805934073685937",
  "💰": "5190576863226933563",
  "👀": "5190645917711114179",
  "🕹": "5193100774988617665",
  "🧪": "5190781475468915802",
  "🎨": "5190751148704833975",
  "📂": "5257969839313526622",
  "🌍": "5780471598922337683",
  "📌": "5318986077455795572",
  "📢": "5789428375261023681",
  "🆔": "5352862640592949843",
  "🔔": "5352980533150259581",
  "🏦": "5348469219761626211",
  "🧾": "5192739271886282680",
  "🔑": "5197288647275071607",
  "ℹ️": "5438411478526892601",
  "ℹ": "5438411478526892601",
  "🪙": "5348469219761626211",
  "🏆": "5848402833195406382",
  "🥇": "5848402833195406382",
  "🥈": "5848402833195406382",
  "🥉": "5848402833195406382",
  "☝": "5019617635629794161",
  "☝️": "5019617635629794161",
  "➡️": "6048465553759147899",
  "🔙": "5438541186539232243",
  "🌸": "5352552689983067014",
  "📩": "4970246557065544891"
};

const sortedEmojiKeys = Object.keys(GLOBAL_BODY_EMOJIS).sort((a, b) => b.length - a.length);

export function pem(key: string): string {
  return PEM[key] || "";
}

export function applyPremiumEmojis(rawText: string): string {
  if (!rawText) return "";
  const existingTags: string[] = [];
  let protectedText = rawText.replace(/<tg-emoji[^>]*>.*?<\/tg-emoji>/gi, (match) => {
    existingTags.push(match);
    return `__TG_EMOJI_PLACEHOLDER_${existingTags.length - 1}__`;
  });

  for (const emoji of sortedEmojiKeys) {
    if (protectedText.includes(emoji)) {
      const emojiId = GLOBAL_BODY_EMOJIS[emoji];
      const replacement = `<tg-emoji emoji-id="${emojiId}">${emoji}</tg-emoji>`;
      protectedText = protectedText.split(emoji).join(replacement);
    }
  }

  protectedText = protectedText.replace(/__TG_EMOJI_PLACEHOLDER_(\d+)__/g, (_, idx) => {
    return existingTags[parseInt(idx, 10)] || "";
  });

  return protectedText;
}

export function formatTelegramHtml(text: string): string {
  if (!text) return "";
  const savedTags: string[] = [];
  let result = text.replace(/<(\/?[a-zA-Z0-9_-]+)(?:\s+[^>]*)?>/g, (tag) => {
    savedTags.push(tag);
    return `__HTML_TAG_${savedTags.length - 1}__`;
  });

  result = result
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  result = result.replace(/__HTML_TAG_(\d+)__/g, (_, idx) => {
    return savedTags[parseInt(idx, 10)] || "";
  });

  result = result.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);
  result = result.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
  result = result.replace(/\*([^*\n]+)\*/g, (_, bold) => `<b>${bold}</b>`);
  result = result.replace(/_([^_\n]+)_/g, (_, italic) => `<i>${italic}</i>`);
  result = result.replace(/~([^~\n]+)~/g, (_, strike) => `<s>${strike}</s>`);

  result = applyPremiumEmojis(result);
  return result;
}

export const ADMIN_CHAT_ID = "8343010638";

export function getMainMenuKeyboard(chatId?: number | string) {
  const rows: any[] = [
    [
      {
        text: "CONNECT WS CHECKER",
        icon_custom_emoji_id: "5429612632430654504",
        style: "primary"
      }
    ],
    [
      {
        text: "CHECK WS NUMBER",
        icon_custom_emoji_id: "5429612632430654504",
        style: "success"
      }
    ],
    [
      {
        text: "BUY WS AND TG API",
        icon_custom_emoji_id: "5170692113834181832",
        style: "primary"
      },
      {
        text: "MY PACKAGE",
        icon_custom_emoji_id: "5312361253610475399",
        style: "primary"
      }
    ],
    [
      {
        text: "MY PROFILE",
        icon_custom_emoji_id: "5208604387156448480",
        style: "success"
      },
      {
        text: "HELP",
        icon_custom_emoji_id: "5832352677849205948",
        style: "success"
      }
    ]
  ];

  if (String(chatId) === ADMIN_CHAT_ID) {
    rows.push([
      {
        text: "ADMIN PANEL",
        icon_custom_emoji_id: "5764869872521581153",
        style: "danger"
      }
    ]);
  }

  return {
    keyboard: rows,
    resize_keyboard: true
  };
}

export const MAIN_MENU_KB = getMainMenuKeyboard();

// --- ADMIN INLINE KEYBOARDS ---
export const ADMIN_PANEL_KEYBOARD = {
  inline_keyboard: [
    [
      {
        text: "⚙️ SETTINGS",
        icon_custom_emoji_id: "5420155432272438703",
        callback_data: "system_settings",
        style: "primary"
      }
    ]
  ]
};

export const SETTINGS_MENU_KEYBOARD = {
  inline_keyboard: [
    [
      {
        text: "𝗣𝗥𝗘𝗠𝗜𝗨𝗠 𝗠𝗔𝗡𝗔𝗚𝗘𝗠𝗘𝗡𝗧",
        icon_custom_emoji_id: "5764869872521581153",
        callback_data: "premium_management_menu",
        style: "primary"
      }
    ],
    [
      {
        text: "Back",
        icon_custom_emoji_id: "5267490665117275176",
        callback_data: "admin_panel_home",
        style: "danger"
      }
    ]
  ]
};

export const PREMIUM_MANAGEMENT_KEYBOARD = {
  inline_keyboard: [
    [
      {
        text: "𝗠𝗔𝗡𝗔𝗚𝗘 𝗣𝗔𝗖𝗞𝗔𝗚𝗘",
        icon_custom_emoji_id: "5123113788979021186",
        callback_data: "dummy_alert",
        style: "primary"
      }
    ],
    [
      {
        text: "𝗧𝗚 𝗖𝗛𝗘𝗖𝗞𝗘𝗥",
        icon_custom_emoji_id: "5429136513831057777",
        callback_data: "dummy_alert",
        style: "success"
      }
    ],
    [
      {
        text: "𝗪𝗛𝗔𝗧𝗦𝗔𝗣𝗣 𝗖𝗛𝗘𝗖𝗞𝗘𝗥",
        icon_custom_emoji_id: "5429612632430654504",
        callback_data: "dummy_alert",
        style: "success"
      }
    ],
    [
      {
        text: "Back",
        icon_custom_emoji_id: "5267490665117275176",
        callback_data: "system_settings",
        style: "danger"
      }
    ]
  ]
};

function getAdminPanelDashboardText(): string {
  const accounts = getSavedAccountsList();
  return (
    `⚙️ <b>ADMIN PANEL (অ্যাডমিন কন্ট্রোল সেন্টার)</b>\n\n` +
    `👑 <b>অ্যাডমিন আইডি:</b> <code>${ADMIN_CHAT_ID}</code> (অথরাইজড)\n\n` +
    `📊 <b>বর্তমান সিস্টেম অবস্থা:</b>\n` +
    `▫️ একটিভ গেটওয়ে: ${currentActivePhone ? `🟢 +${currentActivePhone}` : "🔴 কোনো সক্রিয় অ্যাকাউন্ট নেই"}\n` +
    `▫️ মোট সংরক্ষিত অ্যাকাউন্ট: ${accounts.length} টি\n` +
    `▫️ মেমরি সেশন: ${activeSessions.size} টি\n` +
    `▫️ টেলিগ্রাম বট: 🟢 অনলাইন (@${tgBotInfo.username || "WhatsappCheckerApi_Bot"})\n\n` +
    `🛠 <b>অ্যাডমিন কমান্ডসমূহ:</b>\n` +
    `▫️ <code>/status</code> - সকল ইউজারের লিঙ্ককৃত অ্যাকাউন্টের লাইভ স্ট্যাটাস দেখুন\n` +
    `▫️ <code>/login &lt;ফোন নম্বর&gt;</code> - নতুন হোয়াটসঅ্যাপ গেটওয়ে পেয়ারিং কোড নিন\n` +
    `▫️ <code>/logout &lt;ফোন নম্বর&gt;</code> - যেকোনো অ্যাকাউন্ট বা সেশন ডিলিট করুন\n` +
    `▫️ <code>/check &lt;ফোন নম্বর&gt;</code> - সরাসরি নম্বর ভ্যালিডেশন করুন\n` +
    `▫️ বাল্ক ফাইল আপলোড - আনলিমিটেড নম্বর প্রসেসিং\n\n` +
    `👇 সিস্টেম সেটিংস ম্যানেজ করতে নিচের <b>SETTINGS</b> বাটনে ক্লিক করুন:`
  );
}

async function handleTelegramCallbackQuery(call: any) {
  const callId = call.id;
  const data = call.data || "";
  const fromId = call.from?.id;
  const chatId = call.message?.chat?.id || fromId;
  const msgId = call.message?.message_id;

  // Security check: Only target admin ID 8343010638 can use admin callbacks
  if (String(fromId) !== ADMIN_CHAT_ID && String(chatId) !== ADMIN_CHAT_ID) {
    await answerTelegramCallbackQuery(callId, "⛔ অ্যাক্সেস ডিনাইড: আপনি এই সিস্টেমের অ্যাডমিন নন!", true);
    return;
  }

  if (data === "system_settings") {
    const text = `⚙️ <b>SYSTEM SETTINGS</b>\n\nএডমিন সিস্টেমের সকল সেটিংস কনফিগার করতে নিচের মেনু সিলেক্ট করুন:`;
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", SETTINGS_MENU_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", SETTINGS_MENU_KEYBOARD);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "premium_management_menu") {
    const text = `💎 <b>PREMIUM MANAGEMENT</b>\n\nConfigure premium features and checkers below:`;
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", PREMIUM_MANAGEMENT_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", PREMIUM_MANAGEMENT_KEYBOARD);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "admin_panel_home") {
    const text = getAdminPanelDashboardText();
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", ADMIN_PANEL_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", ADMIN_PANEL_KEYBOARD);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "dummy_alert") {
    await answerTelegramCallbackQuery(callId, "⚠️ এই ফিচারটির কনফিগারেশন শীঘ্রই যোগ করা হচ্ছে (Dummy Alert)।", true);
    return;
  }

  await answerTelegramCallbackQuery(callId);
}

async function sendTelegramMessage(chatId: number, text: string, parseMode = "HTML", replyMarkup: any = null): Promise<number | null> {
  try {
    const formattedText = formatTelegramHtml(text);
    const finalMarkup = (!replyMarkup || replyMarkup === MAIN_MENU_KB) 
      ? getMainMenuKeyboard(chatId) 
      : replyMarkup;

    const payload: any = {
      chat_id: chatId,
      text: formattedText,
      parse_mode: "HTML",
    };
    if (finalMarkup) {
      payload.reply_markup = finalMarkup;
    }
    const response = await fetch(`${TG_API_URL}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      const data = await response.json();
      return data.result?.message_id || null;
    } else {
      const errText = await response.text();
      console.warn("[Telegram bot] HTML sendMessage returned status:", response.status, errText, "Retrying with fallback...");
      const fallbackPayload: any = {
        chat_id: chatId,
        text: text,
      };
      if (finalMarkup) fallbackPayload.reply_markup = finalMarkup;
      const fbResponse = await fetch(`${TG_API_URL}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
      if (fbResponse.ok) {
        const fbData = await fbResponse.json();
        return fbData.result?.message_id || null;
      }
    }
  } catch (err) {
    console.error("[Telegram bot] Failed request sending message:", err);
  }
  return null;
}

async function editTelegramMessage(chatId: number, messageId: number, text: string, parseMode = "HTML", replyMarkup: any = null) {
  try {
    const formattedText = formatTelegramHtml(text);
    const payload: any = {
      chat_id: chatId,
      message_id: messageId,
      text: formattedText,
      parse_mode: "HTML",
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    const response = await fetch(`${TG_API_URL}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.warn("[Telegram bot] HTML editMessageText returned status:", response.status, errText, "Retrying with plain fallback...");
      const fallbackPayload: any = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
      };
      if (replyMarkup) fallbackPayload.reply_markup = replyMarkup;
      await fetch(`${TG_API_URL}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
    }
  } catch (err) {
    console.error("[Telegram bot] Failed request editing message:", err);
  }
}

async function answerTelegramCallbackQuery(callbackQueryId: string, text?: string, showAlert = false) {
  try {
    const payload: any = {
      callback_query_id: callbackQueryId,
    };
    if (text) {
      payload.text = text;
      payload.show_alert = showAlert;
    }
    await fetch(`${TG_API_URL}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[Telegram bot] Failed to answer callback query:", err);
  }
}

async function sendTelegramDocument(chatId: number, fileContent: string, fileName: string, caption: string) {
  try {
    const formData = new FormData();
    formData.append("chat_id", chatId.toString());
    formData.append("caption", formatTelegramHtml(caption));
    formData.append("parse_mode", "HTML");
    
    const blob = new Blob([fileContent], { type: "text/plain" });
    formData.append("document", blob, fileName);

    const response = await fetch(`${TG_API_URL}/sendDocument`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      console.error("[Telegram bot] sendDocument failed:", await response.text());
    }
  } catch (err) {
    console.error("[Telegram bot] Error sending document:", err);
  }
}

async function startTelegramBot() {
  console.log(`[Telegram Bot] Starting custom long-polling thread for token: ${TG_TOKEN.substring(0, 8)}...`);
  
  // Reset any existing Telegram webhook to make sure we can poll via getUpdates
  try {
    const delResp = await fetch(`${TG_API_URL}/deleteWebhook`, { method: "POST" });
    const delText = await delResp.text();
    console.log(`[Telegram Bot] deleteWebhook on startup: ${delResp.status} - ${delText}`);
    
    // Check bot profile details
    const meResp = await fetch(`${TG_API_URL}/getMe`);
    if (meResp.status === 200) {
      const meData = await meResp.json() as any;
      const botUser = meData?.result?.username || "Unknown";
      tgBotInfo.username = botUser;
      tgBotInfo.id = String(meData?.result?.id || "");
      tgBotInfo.name = meData?.result?.first_name || "Bot";
      tgBotInfo.status = "online";
      tgBotInfo.lastPing = new Date().toISOString();
      console.log(`[Telegram Bot] Connected successfully to bot: @${botUser} (ID: ${meData?.result?.id})`);
    } else {
      tgBotInfo.status = "error";
      console.warn(`[Telegram Bot] WARNING: getMe returned status ${meResp.status} - ${await meResp.text()}`);
    }
  } catch (e) {
    tgBotInfo.status = "error";
    console.error(`[Telegram Bot] Exception during webhook reset / getMe:`, e);
  }

  let offset = 0;

  while (true) {
    try {
      const response = await fetch(`${TG_API_URL}/getUpdates?offset=${offset}&timeout=30`, {
        signal: AbortSignal.timeout(45000)
      });

      if (!response.ok) {
        console.warn("[Telegram Bot] HTTP error polling updates, re-trying in 5s... Status:", response.status);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      const data = await response.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = Math.max(offset, update.update_id + 1);
          if (update.message) {
            try {
              await handleTelegramMessage(update.message);
            } catch (msgErr) {
              console.error("[Telegram Bot] Error handling individual updater:", msgErr);
            }
          }
          if (update.callback_query) {
            try {
              await handleTelegramCallbackQuery(update.callback_query);
            } catch (cbErr) {
              console.error("[Telegram Bot] Error handling callback query:", cbErr);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn("[Telegram Bot] Polling handshake issue, retrying in 5 seconds:", err.message || err);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function handleTelegramDocumentMessage(chatId: number, document: any) {
  const fileId = document.file_id;
  const fileName = document.file_name || "numbers.txt";
  
  await sendTelegramMessage(chatId, `⏳ *${fileName}* ফাইলটি প্রসেস করা হচ্ছে... নম্বরগুলো নিষ্কাশন করা হচ্ছে।`);
  
  try {
    // 1. Get file path from Telegram API
    const fileInfoRes = await fetch(`${TG_API_URL}/getFile?file_id=${fileId}`);
    if (!fileInfoRes.ok) {
      throw new Error(`Telegram getFile API failed with status ${fileInfoRes.status}`);
    }
    const fileInfoData = await fileInfoRes.json();
    if (!fileInfoData.ok || !fileInfoData.result?.file_path) {
      throw new Error("Failed to resolve file path from Telegram API response.");
    }
    
    const filePath = fileInfoData.result.file_path;
    
    // 2. Fetch the file content from Telegram's file server
    const fileDownloadUrl = `https://api.telegram.org/file/bot${TG_TOKEN}/${filePath}`;
    const fileDownloadRes = await fetch(fileDownloadUrl);
    if (!fileDownloadRes.ok) {
      throw new Error(`Failed to download file from Telegram storage: ${fileDownloadRes.statusText}`);
    }
    
    const fileText = await fileDownloadRes.text();
    
    // 3. Extract numbers using regex
    const numRegex = /(\+?[0-9]{8,15})/g;
    const matches = fileText.match(numRegex);
    
    if (matches && matches.length > 0) {
      const matchesArray = matches.map((m: string) => m.trim());
      await checkAndRespondBatch(chatId, matchesArray);
    } else {
      await sendTelegramMessage(chatId, "⚠️ ফাইলটিতে কোনো সঠিক ৮ থেকে ১৫ ডিজিটের মোবাইল নম্বর পাওয়া যায়নি। অনুগ্রহ করে সঠিক টেক্সট বা সিএসভি ফাইল আপলোড দিন।");
    }
  } catch (err: any) {
    console.error("[Telegram Bot] Error processing document:", err);
    await sendTelegramMessage(chatId, `❌ ফাইল প্রসেস করার সময় ভুল হয়েছে: ${err.message || err}`);
  }
}

async function handleTelegramMessage(message: any) {
  const chatId = message.chat.id;

  // Handle document file upload if any phone numbers file is sent
  if (message.document) {
    await handleTelegramDocumentMessage(chatId, message.document);
    return;
  }

  const text = message.text ? message.text.trim() : "";
  if (!text) return;

  // COMMAND: /start
  if (text.startsWith("/start")) {
    const isAdmin = String(chatId) === ADMIN_CHAT_ID;
    const adminLine = isAdmin ? `🔘 *ADMIN PANEL* - সিস্টেম অ্যাডমিন কন্ট্রোল প্যানেল\n\n` : `\n`;
    const startMsg = 
      `👋 *স্বাগতম! আমি আপনার লিঙ্কফাই হোয়াটসঅ্যাপ রোবট (Linkify Bot)।*\n\n` +
      `আপনার টেলিগ্রাম বট থেকে সরাসরি হোয়াটসঅ্যাপ লগইন এবং নম্বর চেক করতে পারবেন। নিচের মেনু বাটনগুলো ব্যবহার করুন:\n\n` +
      `🔘 *CONNECT WS CHECKER* - হোয়াটসঅ্যাপ লিঙ্ক করার পেয়ারিং কোড নিন\n` +
      `🔘 *CHECK WS NUMBER* - হোয়াটসঅ্যাপ নম্বর চেক নির্দেশিকা\n` +
      `🔘 *BUY WS AND TG API* - হোয়াটসঅ্যাপ ও টেলিগ্রাম এপিআই প্যাকেজ ও কি\n` +
      `🔘 *HELP* - সহায়তা এবং সকল কমান্ড\n` +
      `🔘 *MY PROFILE* - আপনার প্রোফাইল ও সংরক্ষিত অ্যাকাউন্টের বিবরণ\n` +
      `🔘 *MY PACKAGE* - বর্তমান প্যাকেজ ও লিমিট স্ট্যাটাস\n` +
      adminLine +
      `📌 *সরাসরি কমান্ডসমূহ (Commands):*\n` +
      `▫️ \`/login <ফোন নম্বর>\` - হোয়াটসঅ্যাপ লিঙ্ক করার পেয়ারিং কোড পান।\n` +
      `▫️ \`/check <ফোন নম্বর>\` - যেকোনো নম্বর দ্রুত চেক করুন।\n` +
      `▫️ \`/status\` - লিঙ্ককৃত অ্যাকাউন্টের লাইভ স্ট্যাটাস দেখুন।\n` +
      `▫️ \`/logout <ফোন নম্বর>\` - অ্যাকাউন্ট মুছে ফেলুন।\n\n` +
      `💡 *বাল্ক হোয়াটসঅ্যাপ চেক:* যেকোনো মেসেজে একাধিক মোবাইল নম্বর একসাথে পাঠান অথবা কোনো \`.txt\` / \`.csv\` ফাইল সেন্ড করুন!`;
    await sendTelegramMessage(chatId, startMsg, "Markdown", getMainMenuKeyboard(chatId));
    return;
  }

  // --- MENU BUILDER BUTTON ACTIONS ---
  if (text === "CONNECT WS CHECKER" || text.includes("CONNECT WS CHECKER")) {
    const connectMsg = 
      `🔗 *CONNECT WS CHECKER*\n\n` +
      `আপনার হোয়াটসঅ্যাপ অ্যাকাউন্ট বটের সাথে কানেক্ট করতে নিচের নিয়মে কমান্ড দিন:\n` +
      `👉 \`/login <ফোন নম্বর>\`\n\n` +
      `*উদাহরণ:*\n` +
      `\`/login 8801700000000\`\n\n` +
      `ℹ️ কমান্ড পাঠালে আপনি একটি ৮-ডিজিটের পেয়ারিং কোড পাবেন যা দিয়ে মোবাইলের WhatsApp অ্যাপ থেকে *Linked Devices* এ গিয়ে লিঙ্ক করতে পারবেন।`;
    await sendTelegramMessage(chatId, connectMsg, "Markdown", getMainMenuKeyboard(chatId));
    return;
  }

  if (text === "CHECK WS NUMBER" || text.includes("CHECK WS NUMBER")) {
    const checkGuideMsg = 
      `🔍 *CHECK WS NUMBER*\n\n` +
      `হোয়াটসঅ্যাপ নম্বর চেক করার বিভিন্ন সহজ উপায়:\n\n` +
      `১️⃣ *সিঙ্গেল নম্বর:* কমান্ড দিন \`/check <ফোন নম্বর>\` (যেমন: \`/check 8801712345678\`)\n` +
      `২️⃣ *দ্রুত চেক:* এক বা একাধিক নম্বর সরাসরি মেসেজে লিখে পাঠিয়ে দিন\n` +
      `৩️⃣ *বাল্ক ফাইল চেক:* নম্বরগুলোর একটি \`.txt\` বা \`.csv\` ফাইল এখানে আপলোড দিন\n\n` +
      `বট সাথে সাথে ফিল্টার করে সক্রিয় ও নিষ্ক্রিয় তালিকা জানিয়ে দেবে! ⚡`;
    await sendTelegramMessage(chatId, checkGuideMsg, "Markdown", getMainMenuKeyboard(chatId));
    return;
  }

  if (text === "BUY WS AND TG API" || text.includes("BUY WS AND TG API") || text === "BUY WS API" || text.includes("BUY WS API") || text === "BUY PACKAGE" || text.includes("BUY PACKAGE")) {
    const buyApiMsg = 
      `⚡ *BUY WS AND TG API (WhatsApp & Telegram Checker API)*\n\n` +
      `আপনার ওয়েবসাইট, সিআরএম বা সফটওয়্যারে হাই-স্পিড হোয়াটসঅ্যাপ ও টেলিগ্রাম চেকার ইন্টিগ্রেশনের জন্য অফিশিয়াল API অ্যাক্সেস নিন:\n\n` +
      `🔹 *REST API Endpoints:*\n` +
      `▫️ \`GET /api/check-phone?phone=+88017...\` - একক নম্বর ভ্যালিডেশন\n` +
      `▫️ \`POST /api/check-batch\` - রিয়েল-টাইম বাল্ক মাল্টি-থ্রেড চেকার\n` +
      `▫️ \`POST /api/send-message\` - স্বয়ংক্রিয় মেসেজিং সুবিধা\n\n` +
      `💎 *API ফিচারসমূহ:*\n` +
      `▫️ হোয়াটসঅ্যাপ ও টেলিগ্রাম উভয় প্ল্যাটফর্ম সাপোর্ট\n` +
      `▫️ আনলিমিটেড হাই-স্পিড রিকোয়েস্ট\n` +
      `▫️ 99.9% আপটাইম মাল্টি-গেটওয়ে রিডানড্যান্সি\n` +
      `▫️ ফুল টেলিগ্রাম ও ওয়েবহুক নোটিফিকেশন\n\n` +
      `📞 *API কী এবং লাইসেন্স ক্রয়ের জন্য:* অ্যাডমিনের সাথে সরাসরি যোগাযোগ করুন।`;
    await sendTelegramMessage(chatId, buyApiMsg, "Markdown", getMainMenuKeyboard(chatId));
    return;
  }

  if (text === "HELP" || text.includes("HELP")) {
    const helpMsg = 
      `📖 *HELP & GUIDELINES*\n\n` +
      `*কিভাবে ব্যবহার করবেন:*\n` +
      `▫️ \`CONNECT WS CHECKER\` - হোয়াটসঅ্যাপ অ্যাকাউন্ট যুক্ত করার নিয়মাবলী\n` +
      `▫️ \`CHECK WS NUMBER\` - নম্বর ফিল্টার ও ভেরিফিকেশন করার গাইড\n` +
      `▫️ \`BUY WS AND TG API\` - এপিআই অ্যাক্সেস ও ডকুমেন্টেশন\n` +
      `▫️ \`MY PROFILE\` - আপনার টেলিগ্রাম আইডি ও অ্যাকাউন্টের তথ্য\n` +
      `▫️ \`MY PACKAGE\` - বর্তমান প্যাকেজ ও লিমিট\n` +
      `▫️ \`/login <ফোন নম্বর>\` - পেয়ারিং কোড দিয়ে হোয়াটসঅ্যাপ লিঙ্ক করুন\n` +
      `▫️ \`/check <ফোন নম্বর>\` - নম্বর চেক করুন\n` +
      `▫️ \`/status\` - লিঙ্ককৃত অ্যাকাউন্টের বর্তমান অবস্থা দেখুন\n` +
      `▫️ \`/logout <ফোন নম্বর>\` - অ্যাকাউন্ট মুছে ফেলুন\n` +
      `▫️ ফাইল সেন্ড করুন - আনলিমিটেড বাল্ক নম্বর একসাথে চেক করার জন্য`;
    await sendTelegramMessage(chatId, helpMsg, "Markdown", getMainMenuKeyboard(chatId));
    return;
  }

  if (text === "MY PROFILE" || text.includes("MY PROFILE")) {
    const accounts = getSavedAccountsList();
    const userFirstName = message.from?.first_name || message.chat?.first_name || "Telegram User";
    const userLastName = message.from?.last_name || "";
    const fullName = `${userFirstName} ${userLastName}`.trim();
    const username = message.from?.username ? `@${message.from.username}` : "Not Set";
    const userAccounts = accounts.filter((a: any) => a.addedByChatId === chatId);

    const profileMsg = 
      `👤 *MY PROFILE (ব্যবহারকারী প্রোফাইল)*\n\n` +
      `▫️ *নাম:* ${fullName}\n` +
      `▫️ *ইউজারনেম:* ${username}\n` +
      `▫️ *টেলিগ্রাম আইডি:* \`${chatId}\`\n` +
      `▫️ *লিঙ্ককৃত হোয়াটসঅ্যাপ অ্যাকাউন্ট:* ${userAccounts.length > 0 ? userAccounts.length + " টি" : accounts.length + " টি (সিস্টেম শেয়ার্ড)"}\n` +
      `▫️ *সক্রিয় গেটওয়ে:* ${currentActivePhone ? `🟢 +${currentActivePhone}` : "🔴 কোনো গেটওয়ে সক্রিয় নেই"}\n` +
      `▫️ *অ্যাকাউন্ট স্ট্যাটাস:* 🟢 Active Verified User\n` +
      `▫️ *সার্ভার কানেকশন:* ⚡ Online Multi-Node`;
    await sendTelegramMessage(chatId, profileMsg, "Markdown", getMainMenuKeyboard(chatId));
    return;
  }

  if (text === "MY PACKAGE" || text.includes("MY PACKAGE")) {
    const pkgMsg = 
      `📦 *MY PACKAGE (বর্তমান প্যাকেজ বিবরণ)*\n\n` +
      `▫️ *প্যাকেজ নাম:* 🌟 Premium Starter Tier (সক্রিয়)\n` +
      `▫️ *দৈনিক চেক লিমিট:* 500 টি / দিন (আনলিমিটেড সিঙ্গেল চেক)\n` +
      `▫️ *বাল্ক ফাইল সাইজ:* 10,000 নম্বর প্রতি ব্যাচে\n` +
      `▫️ *চেকিং স্পিড:* ⚡ আল্ট্রা ফাস্ট (0.2s - 0.5s/number)\n` +
      `▫️ *API অ্যাক্সেস:* স্ট্যান্ডার্ড ইন্টিগ্রেশন এনাবল্ড\n` +
      `▫️ *মেয়াদ:* ♾️ Lifetime Active\n\n` +
      `💡 আনলিমিটেড এন্টারপ্রাইজ প্যাকেজে আপগ্রেড করতে মেনুর *BUY WS AND TG API* বাটন চাপুন।`;
    await sendTelegramMessage(chatId, pkgMsg, "Markdown", getMainMenuKeyboard(chatId));
    return;
  }

  if (text === "ADMIN PANEL" || text.includes("ADMIN PANEL") || text === "/admin" || text.startsWith("/admin")) {
    if (String(chatId) !== ADMIN_CHAT_ID) {
      await sendTelegramMessage(chatId, `⛔ *অ্যাক্সেস ডিনাইড:* অ্যাডমিন প্যানেল শুধুমাত্র নির্দিষ্ট অ্যাডমিনের (ID: \`${ADMIN_CHAT_ID}\`) জন্য উন্মুক্ত।`, "Markdown", getMainMenuKeyboard(chatId));
      return;
    }
    const adminMsg = getAdminPanelDashboardText();
    await sendTelegramMessage(chatId, adminMsg, "HTML", ADMIN_PANEL_KEYBOARD);
    return;
  }

  // COMMAND: /login <phone_number>
  if (text.startsWith("/login")) {
    const rawPhoneInput = text.substring(6).trim();
    if (!rawPhoneInput) {
      await sendTelegramMessage(chatId, "⚠️ অনুগ্রহ করে ফোন নম্বরটি লিখুন। যেমন: `/login 8801700000000` ");
      return;
    }
    const phoneCleaned = normalizePhone(rawPhoneInput);

    if (phoneCleaned.length < 8) {
      await sendTelegramMessage(chatId, "⚠️ অনুগ্রহ করে সঠিক ফোন নম্বরটি লিখুন। যেমন: `/login 8801700000000` ");
      return;
    }

    await sendTelegramMessage(chatId, `⌛ *+${phoneCleaned}* নম্বরের জন্য হোয়াটসঅ্যাপ সার্ভার থেকে কানেকশন কোড জেনারেট হচ্ছে... দয়া করে অপেক্ষা করুন।`);

    // Bootstrap connection setup
    const senderName = message.from?.first_name || message.chat?.first_name || "Telegram User";
    linkingOwners.set(phoneCleaned, { chatId, name: senderName });

    currentActivePhone = phoneCleaned;
    await initWhatsApp(phoneCleaned);

    // Dynamic wait for pairing code to generate
    let counter = 0;
    const maxRetries = 15;
    const timer = setInterval(async () => {
      counter++;
      const currentSession = activeSessions.get(phoneCleaned);
      if (currentSession && currentSession.status === "pairing-code-ready" && currentSession.pairingCode) {
        clearInterval(timer);
        const codeMsg = 
          `🔑 *আপনার হোয়াটসঅ্যাপ পেয়ারিং কোড:* \n\n` +
          `👉 \`${currentSession.pairingCode}\` 👈\n\n` +
          `*কিভাবে ব্যবহার করবেন:*\n` +
          `১. আপনার মোবাইলের WhatsApp অ্যাপ ওপেন করুন।\n` +
          `২. ডান কোণের থ্রি-ডট মেনু থেকে *Linked Devices* এ ক্লিক করুন।\n` +
          `৩. *Link a Device* বাটনে ট্যাপ করে নিচে *Link with phone number instead* অপশনটি সিলেক্ট করুন।\n` +
          `৪. স্ক্রিনে কোডটি ইনপুট দিন।\n\n` +
          `বটের সাথে একাউন্ট সফলভাবে সিঙ্ক হয়ে যাবে! 🚀`;
        await sendTelegramMessage(chatId, codeMsg);
      } else if (currentSession && currentSession.status === "error") {
        clearInterval(timer);
        await sendTelegramMessage(chatId, `❌ কোড জেনারেট করতে ব্যর্থ হয়েছে।\nকারণ: ${currentSession.error || 'WhatsApp Server Refusal'}`);
      } else if (counter >= maxRetries) {
        clearInterval(timer);
        await sendTelegramMessage(chatId, `⏳ কোড সিস্টেমে জেনারেট হতে একটু সময় নিচ্ছে। অনুগ্রহ করে ১ মিনিট পর \`/status\` কমান্ড দিয়ে চেক করুন।`);
      }
    }, 1000);
    return;
  }

  // COMMAND: /status
  if (text.startsWith("/status")) {
    const saved = getSavedAccountsList();
    if (saved.length === 0) {
      await sendTelegramMessage(chatId, "ℹ️ লোকাল ডাটাবেজে কোনো হোয়াটসঅ্যাপ অ্যাকাউন্ট লিঙ্ক করা নেই। লিঙ্ক করতে অনুগ্রহ করে `/login <ফোন নম্বর>` লিখুন।");
      return;
    }

    const myAccounts = saved.filter(acc => acc.addedByChatId === chatId);
    const otherAccounts = saved.filter(acc => acc.addedByChatId && acc.addedByChatId !== chatId);

    let statusMsg = `📊 *হোয়াটসঅ্যাপ কানেকশন স্ট্যাটাস:* \n\n`;

    if (myAccounts.length > 0) {
      statusMsg += `👤 *আপনার নিজস্ব লিঙ্ককৃত অ্যাকাউন্টসমূহ (${myAccounts.length} টি):*\n`;
      myAccounts.forEach((acc, idx) => {
        const activeS = activeSessions.get(acc.phone);
        const onlineStatus = activeS ? activeS.status : "disconnected";
        const statusEmoji = onlineStatus === "connected" ? "🟢 Connected" : onlineStatus === "connecting" ? "🟡 Connecting" : "🔴 Offline";
        statusMsg += `${idx + 1}. *+${acc.phone}* (${acc.name || "WhatsApp User"})\n   স্ট্যাটাস: ${statusEmoji}\n`;
      });
      statusMsg += `\n`;
    } else {
      statusMsg += `⚠️ *আপনার নিজস্ব কোনো লিঙ্ককৃত অ্যাকাউন্ট নেই!*\nনতুন অ্যাকাউন্ট লিঙ্ক করতে টাইপ করুন: \`/login <ফোন নম্বর>\`।\n\n`;
    }

    if (otherAccounts.length > 0) {
      statusMsg += `👥 *অন্যান্য ব্যবহারকারীদের অ্যাকাউন্টসমূহ (${otherAccounts.length} টি):*\n`;
      otherAccounts.forEach((acc, idx) => {
        const activeS = activeSessions.get(acc.phone);
        const onlineStatus = activeS ? activeS.status : "disconnected";
        const statusEmoji = onlineStatus === "connected" ? "🟢 Online" : "🔴 Offline";
        const maskedPhone = acc.phone.slice(0, 5) + "****" + acc.phone.slice(-3);
        statusMsg += `${idx + 1}. *+${maskedPhone}* (যোগ করেছেন: ${acc.addedByName || "ব্যবহারকারী"})\n   স্ট্যাটাস: ${statusEmoji}\n`;
      });
      statusMsg += `\n`;
    }

    if (currentActivePhone) {
      const isMyChoice = myAccounts.some(acc => acc.phone === currentActivePhone);
      statusMsg += `🎯 *ডিফল্ট রানটাইম গেটওয়ে:* \`+${currentActivePhone}\` ${isMyChoice ? "(আপনার অ্যাকাউন্ট)" : "(অন্য ব্যবহারকারী/সিস্টেম)"}`;
    }

    await sendTelegramMessage(chatId, statusMsg);
    return;
  }

  // COMMAND: /logout <phone>
  if (text.startsWith("/logout")) {
    const rawPhoneInput = text.substring(7).trim();
    if (!rawPhoneInput) {
      await sendTelegramMessage(chatId, "⚠️ অনুগ্রহ করে ফোন নম্বরটি লিখুন। যেমন: `/logout 8801700000000` ");
      return;
    }
    const phoneCleaned = normalizePhone(rawPhoneInput);

    const existed = deleteAccountFromDb(phoneCleaned);
    if (existed) {
      await sendTelegramMessage(chatId, `✅ *+${phoneCleaned}* অ্যাকাউন্টটি লোকাল ডাটাবেজ থেকে মুছে ফেলা এবং সেশন ডিসকানেক্ট করা হয়েছে।`);
    } else {
      await sendTelegramMessage(chatId, `⚠️ *+${phoneCleaned}* অ্যাকাউন্টটি লোকাল ডাটাবেজে পাওয়া যায়নি।`);
    }
    return;
  }

  // COMMAND: /check <number>
  if (text.startsWith("/check")) {
    const rawInput = text.substring(6).trim();
    if (!rawInput) {
      await sendTelegramMessage(chatId, "⚠️ অনুগ্রহ করে ফোন নম্বরটি লিখুন। যেমন: `/check 8801712345678` ");
      return;
    }
    await checkAndRespondBatch(chatId, [rawInput]);
    return;
  }

  // RAW MESSAGE BULK PARSING CHECKER ENGINER
  // Extract patterns looking like 8-15 digit mobile numbers
  const numRegex = /(\+?[0-9]{8,15})/g;
  const matches = text.match(numRegex);
  if (matches && matches.length > 0) {
    const matchesArray = matches.map((m: string) => m.trim());
    await checkAndRespondBatch(chatId, matchesArray);
  } else {
    // Standard prompt fallback
    await sendTelegramMessage(chatId, "ℹ️ অনুগ্রহ করে হোয়াটসঅ্যাপ চেক করার জন্য কোনো নম্বর প্রেরণ করুন অথবা বটের বিস্তারিত তালিকা নিয়ে স্টার্ট দিতে `/start` লিখুন।");
  }
}

async function checkAndRespondBatch(chatId: number, rawNumbers: string[]) {
  // Find any active linked connected WhatsApp model belonging to this specific user FIRST
  let resolvedSession: ConnectedSession | null = null;
  const saved = getSavedAccountsList();
  const myAccounts = saved.filter(acc => acc.addedByChatId === chatId);

  for (const acc of myAccounts) {
    const activeS = activeSessions.get(acc.phone);
    if (activeS && activeS.status === "connected" && activeS.sock) {
      resolvedSession = activeS;
      break;
    }
  }

  // Fallback to globally designated active phone if none of the requester's accounts are connected
  if (!resolvedSession && currentActivePhone) {
    const activeS = activeSessions.get(currentActivePhone);
    if (activeS && activeS.status === "connected" && activeS.sock) {
      resolvedSession = activeS;
    }
  }

  // Secondary fallback to absolutely any connected session
  if (!resolvedSession) {
    for (const session of activeSessions.values()) {
      if (session.status === "connected" && session.sock) {
        resolvedSession = session;
        break;
      }
    }
  }

  if (!resolvedSession) {
    await sendTelegramMessage(chatId, "⚠️ *দুঃখিত, কোনো সক্রিয় হোয়াটসঅ্যাপ অ্যাকাউন্ট সংযুক্ত নেই!* \n\nঅনুগ্রহ করে প্রথমে বটের সাথে নতুন অ্যাকাউন্ট লিঙ্ক করতে টাইপ করুন: \`/login <ফোন নম্বর>\`।");
    return;
  }

  const normalizedList: string[] = [];
  const seen = new Set<string>();

  for (const num of rawNumbers) {
    const clean = normalizePhone(num);
    if (!clean || clean.length < 6) continue;

    if (seen.has(clean)) continue;
    seen.add(clean);
    normalizedList.push(clean);
  }

  if (normalizedList.length === 0) {
    await sendTelegramMessage(chatId, "⚠️ কোনো সঠিক মোবাইল নম্বর খুঁজে পাওয়া যায়নি। দয়া করে সঠিক নম্বর ইনপুট দিন।");
    return;
  }

  const progressMsgId = await sendTelegramMessage(
    chatId, 
    `🔍 *হোয়াটসঅ্যাপ ডেটাবেজ চেক করা হচ্ছে...* \n\n` +
    `মোট ইউনিক নম্বর: *${normalizedList.length}* টি।\n` +
    `সক্রিয় গেটওয়ে: *+${resolvedSession.phoneNumber}*`
  );

  const activeWA: string[] = [];
  const inactiveWA: string[] = [];

  // Optimized query size of 50 numbers at a time for fast processing
  const chunkSize = 50;

  for (let i = 0; i < normalizedList.length; i += chunkSize) {
    const chunk = normalizedList.slice(i, i + chunkSize);
    const jidsToQuery = chunk.map(num => `${num}@s.whatsapp.net`);
    const jidToNumMap = new Map<string, string>();
    chunk.forEach(num => jidToNumMap.set(`${num}@s.whatsapp.net`, num));

    const chunkExists = new Set<string>();

    let retryCount = 0;
    let querySuccess = false;

    while (retryCount < 2 && !querySuccess) {
      try {
        if (resolvedSession && resolvedSession.sock) {
          const result = await resolvedSession.sock.onWhatsApp(...jidsToQuery);
          if (result && Array.isArray(result)) {
            for (const item of result) {
              if (item.exists) {
                chunkExists.add(item.jid);
              }
            }
          }
          querySuccess = true;
        } else {
          break; // No active session
        }
      } catch (e: any) {
        retryCount++;
        console.warn(`[Telegram Bulk Check] Chunk query failed (attempt ${retryCount}/2):`, e?.message || e);
        if (retryCount >= 2) {
          console.log("[Telegram Bulk Check] Falling back to one-by-one queries for this chunk to bypass batch failure.");
          for (const jid of jidsToQuery) {
            try {
              if (resolvedSession && resolvedSession.sock) {
                const result = await resolvedSession.sock.onWhatsApp(jid);
                if (result && Array.isArray(result) && result[0]?.exists) {
                  chunkExists.add(jid);
                }
              }
              await new Promise(r => setTimeout(r, 80));
            } catch (singleErr: any) {
              console.error(`[Telegram Bulk Check] Individual backup query failed for ${jid}:`, singleErr?.message || singleErr);
            }
          }
          querySuccess = true;
        } else {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }
    }

    for (const jid of jidsToQuery) {
      const num = jidToNumMap.get(jid);
      if (num) {
        if (chunkExists.has(jid)) {
          activeWA.push(num);
        } else {
          inactiveWA.push(num);
        }
      }
    }

    // Real-time progress edit for large batches
    if (normalizedList.length > 50 && progressMsgId) {
      const percentage = Math.round((Math.min(i + chunkSize, normalizedList.length) / normalizedList.length) * 100);
      await editTelegramMessage(
        chatId,
        progressMsgId,
        `🔍 *হোয়াটসঅ্যাপ ডেটাবেজ চেক করা হচ্ছে...* \n\n` +
        `⏳ অগ্রগতি: *${Math.min(i + chunkSize, normalizedList.length)}/${normalizedList.length}* টি নম্বর চেক সম্পন্ন হয়েছে (*${percentage}%*)।\n` +
        `🟢 সক্রিয়: *${activeWA.length}* | 🔴 নিষ্ক্রিয়: *${inactiveWA.length}*`
      );
    }

    if (i + chunkSize < normalizedList.length) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }

  // Delivery of the reports
  if (normalizedList.length <= 30) {
    const resultReport = 
      `🤖 *বাল্ক নম্বর চেকার রিপোর্ট (Bulk Report)*\n\n` +
      `📊 *মোট ইউনিক নম্বর:* ${normalizedList.length} টি\n` +
      `✅ *হোয়াটসঅ্যাপ রয়েছে (${activeWA.length} টি):*\n` +
      `${activeWA.length > 0 ? activeWA.map(item => `+${item}`).join("\n") : "_কোনোটিই নয়_"}\n\n` +
      `❌ *হোয়াটসঅ্যাপ খোলা নেই (${inactiveWA.length} টি):*\n` +
      `${inactiveWA.length > 0 ? inactiveWA.map(item => `+${item}`).join("\n") : "_কোনোটিই নয়_"}`;

    if (progressMsgId) {
      await editTelegramMessage(chatId, progressMsgId, resultReport);
    } else {
      await sendTelegramMessage(chatId, resultReport);
    }
  } else {
    // Generate text report body
    const activeText = activeWA.map(item => `+${item}`).join("\n");
    const inactiveText = inactiveWA.map(item => `+${item}`).join("\n");

    const summaryReport = 
      `🤖 *বাল্ক নম্বর চেকার রিপোর্ট (Bulk Report)*\n\n` +
      `📊 *মোট ইউনিক নম্বর:* ${normalizedList.length} টি\n` +
      `🟢 *সক্রিয় হোয়াটসঅ্যাপ অ্যাকাউন্ট:* ${activeWA.length} টি\n` +
      `🔴 *হোয়াটসঅ্যাপ খোলা নেই:* ${inactiveWA.length} টি\n\n` +
      `📂 বিস্তারিত তালিকা নিচের টেক্সট ফাইলে সরবরাহ করা হলো।`;

    if (progressMsgId) {
      await editTelegramMessage(chatId, progressMsgId, summaryReport);
    } else {
      await sendTelegramMessage(chatId, summaryReport);
    }

    // Deliver files
    if (activeWA.length > 0) {
      await sendTelegramDocument(
        chatId,
        activeText,
        "active_whatsapp_numbers.txt",
        `🟢 সকল সক্রিয় হোয়াটসঅ্যাপ নম্বরসমূহ (${activeWA.length} টি)`
      );
    }
    if (inactiveWA.length > 0) {
      await sendTelegramDocument(
        chatId,
        inactiveText,
        "inactive_whatsapp_numbers.txt",
        `🔴 সকল হোয়াটসঅ্যাপ খোলা নেই এমন নম্বরসমূহ (${inactiveWA.length} টি)`
      );
    }
  }
}

// --- REST API ENDPOINTS ---
app.get("/api/request-code", async (req, res) => {
  const phoneParam = req.query.phone as string;
  if (!phoneParam) {
    return res.status(400).json({ error: "Phone number is required." });
  }

  // Sanitize and normalize phone number
  const phoneCleaned = normalizePhone(phoneParam);

  if (phoneCleaned.length < 8) {
    return res.status(400).json({ error: "Invalid phone number format." });
  }

  console.log("Requested Pairing Code for cleaned phone number:", phoneCleaned);
  currentActivePhone = phoneCleaned;
  initWhatsApp(phoneCleaned);

  res.json({
    status: "processing",
    phone: phoneCleaned,
  });
});

app.get("/api/status", (req, res) => {
  updateGlobalSessionStateToSelectedActive();
  res.json(sessionState);
});

app.get("/api/reset-session", (req, res) => {
  if (currentActivePhone) {
    deleteAccountFromDb(currentActivePhone);
  }
  res.json({ status: "ok" });
});

app.post("/api/send-message", async (req, res) => {
  const { to, text } = req.body;
  if (!activeSock || sessionState.status !== "connected") {
    return res.status(400).json({ error: "WhatsApp is not connected." });
  }

  if (!to || !text) {
    return res.status(400).json({ error: "Recipient and text message are required." });
  }

  try {
    const cleanTo = to.replace(/\D/g, "");
    const jid = `${cleanTo}@s.whatsapp.net`;
    const result = await activeSock.sendMessage(jid, { text });
    res.json({ success: true, result });
  } catch (err: any) {
    console.error("Error sending custom message via Baileys:", err);
    res.status(500).json({ error: err.message || "Failed to send message." });
  }
});

// Endpoint to check if a phone number exists on WhatsApp with robust multi-step fallbacks
app.get("/api/check-phone", async (req, res) => {
  const phoneParam = req.query.phone as string;
  
  if (!activeSock || sessionState.status !== "connected") {
    return res.status(400).json({ error: "WhatsApp is not connected. Please connect first." });
  }

  if (!phoneParam) {
    return res.status(400).json({ error: "Phone number is required." });
  }

  try {
    // Clean and normalize the phone input using robust normalization helper
    const cleanPhone = normalizePhone(phoneParam);

    const jid = `${cleanPhone}@s.whatsapp.net`;
    console.log(`[Presence Checker] Querying presence for normalized JID: ${jid} (raw: ${phoneParam})`);

    let exists = false;
    let resolvedJid = jid;

    try {
      const result = await activeSock.onWhatsApp(jid);
      console.log("[Presence Checker] Baileys onWhatsApp result:", result);
      if (result && result.length > 0 && result[0].exists) {
        exists = true;
        resolvedJid = result[0].jid;
      }
    } catch (err: any) {
      console.error("[Presence Checker] onWhatsApp error:", err?.message || err);
    }

    console.log(`[Presence Checker] Final exists status determined for JID ${jid}: ${exists}`);

    if (exists) {
      return res.json({
        exists: true,
        jid: resolvedJid,
        phone: cleanPhone,
      });
    } else {
      return res.json({
        exists: false,
        phone: cleanPhone,
      });
    }
  } catch (err: any) {
    console.error("Error in check-phone endpoint execution:", err);
    res.status(500).json({ error: err.message || "Failed to execute presence check on WhatsApp network." });
  }
});

// Endpoint to check Telegram Username or Chat ID with live status & linked whatsapp count
app.get("/api/check-telegram", async (req, res) => {
  const query = req.query.query as string;
  if (!query) {
    return res.status(400).json({ error: "Username or Chat ID is required." });
  }

  let normalizedQuery = query.trim();
  // If it starts with alphabets and digit/underscore, we count it as username, append '@' if missing
  if (/^[a-zA-Z]/.test(normalizedQuery) && !normalizedQuery.startsWith("@")) {
    normalizedQuery = "@" + normalizedQuery;
  }

  try {
    console.log(`[Telegram Checker] Live query to Telegram API: getChat for ${normalizedQuery}`);
    
    // Call Telegram getChat API
    const botRes = await fetch(`${TG_API_URL}/getChat?chat_id=${encodeURIComponent(normalizedQuery)}`);
    const botData = await botRes.json();
    
    // Check local database for linked WhatsApp numbers
    const allAccounts = getSavedAccountsList();
    const linkedAccounts = allAccounts.filter(acc => {
      if (!acc.addedByChatId) return false;
      const cleanQ = query.trim().toLowerCase().replace("@", "");
      const matchesId = String(acc.addedByChatId) === query.trim();
      const matchesUsername = acc.addedByName && acc.addedByName.toLowerCase().includes(cleanQ);
      return matchesId || matchesUsername;
    });

    if (botData.ok) {
      const chat = botData.result;
      return res.json({
        exists: true,
        id: chat.id,
        type: chat.type,
        firstName: chat.first_name || "",
        lastName: chat.last_name || "",
        username: chat.username || "",
        title: chat.title || "",
        bio: chat.bio || "",
        linkedAccounts: linkedAccounts,
        raw: chat
      });
    } else {
      // Fallback: If not found in live bot, search local database records
      if (linkedAccounts.length > 0) {
        return res.json({
          exists: true,
          id: linkedAccounts[0].addedByChatId,
          firstName: linkedAccounts[0].addedByName || "Telegram User",
          username: query.startsWith("@") ? query.substring(1) : "",
          linkedAccounts: linkedAccounts,
          note: "Found in local database but not live-reachable from Bot API (user must start bot first)."
        });
      }
      
      return res.json({
        exists: false,
        error: botData.description || "Chat not found or bot does not have access to this user."
      });
    }
  } catch (err: any) {
    console.error("[Telegram Checker] Error:", err);
    res.status(500).json({ error: err.message || "Failed to check Telegram account." });
  }
});

// Endpoint to check multiple phone numbers in bulk with chunking and delay protection
app.post("/api/check-phone-bulk", async (req, res) => {
  const { phones } = req.body;
  
  if (!activeSock || sessionState.status !== "connected") {
    return res.status(400).json({ error: "WhatsApp is not connected. Please connect first." });
  }

  if (!phones || !Array.isArray(phones) || phones.length === 0) {
    return res.status(400).json({ error: "Phones array is required." });
  }

  try {
    const normalizedList: { original: string; cleanPhone: string; jid: string }[] = [];
    const seen = new Set<string>();

    for (const phone of phones) {
      if (typeof phone !== "string") continue;
      
      const cleanPhone = normalizePhone(phone);
      if (!cleanPhone || cleanPhone.length < 5) continue;

      if (seen.has(cleanPhone)) continue;
      seen.add(cleanPhone);

      const jid = `${cleanPhone}@s.whatsapp.net`;
      normalizedList.push({
        original: phone,
        cleanPhone,
        jid
      });
    }

    if (normalizedList.length === 0) {
      return res.json({ exists: [], notExists: [], total: 0 });
    }

    console.log(`[Presence Bulk Checker] Starting batch query of ${normalizedList.length} numbers.`);

    // Check in chunks of 50
    const chunkSize = 50;
    const existsJids = new Set<string>();

    for (let i = 0; i < normalizedList.length; i += chunkSize) {
      const chunk = normalizedList.slice(i, i + chunkSize);
      const jidsToQuery = chunk.map(item => item.jid);

      let retryCount = 0;
      let querySuccess = false;

      while (retryCount < 2 && !querySuccess) {
        try {
          console.log(`[Presence Bulk Checker] Querying chunk ${Math.floor(i / chunkSize) + 1} (attempt ${retryCount + 1})...`);
          const result = await activeSock.onWhatsApp(...jidsToQuery);
          if (result && Array.isArray(result)) {
            for (const item of result) {
              if (item.exists) {
                existsJids.add(item.jid);
              }
            }
          }
          querySuccess = true;
        } catch (err: any) {
          retryCount++;
          console.warn(`[Presence Bulk Checker] Chunk query at index ${i} failed (attempt ${retryCount}/2):`, err?.message || err);
          if (retryCount >= 2) {
            console.log("[Presence Bulk Checker] Falling back to one-by-one check to salvage numbers from this failed chunk.");
            for (const jid of jidsToQuery) {
              try {
                if (activeSock) {
                  const result = await activeSock.onWhatsApp(jid);
                  if (result && Array.isArray(result) && result[0]?.exists) {
                    existsJids.add(jid);
                  }
                }
                await new Promise(r => setTimeout(r, 80));
              } catch (singleErr: any) {
                console.error(`[Presence Bulk Checker] Individual backup query failed for ${jid}:`, singleErr?.message || singleErr);
              }
            }
            querySuccess = true;
          } else {
            await new Promise(resolve => setTimeout(resolve, 800));
          }
        }
      }

      // Small throttling delay to be friendly to standard WhatsApp socket flows
      if (i + chunkSize < normalizedList.length) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }

    const existsList: any[] = [];
    const notExistsList: any[] = [];

    for (const item of normalizedList) {
      if (existsJids.has(item.jid)) {
        existsList.push({
          phone: item.cleanPhone,
          jid: item.jid,
          original: item.original
        });
      } else {
        notExistsList.push({
          phone: item.cleanPhone,
          original: item.original
        });
      }
    }

    console.log(`[Presence Bulk Checker] Completed. Active: ${existsList.length}, Missing: ${notExistsList.length}`);

    return res.json({
      exists: existsList,
      notExists: notExistsList,
      total: normalizedList.length
    });

  } catch (err: any) {
    console.error("Error in check-phone-bulk handler:", err);
    res.status(500).json({ error: err.message || "Failed to execute bulk presence query on WhatsApp." });
  }
});

// --- TELEGRAM ACCOUNT MULTI-SESSION API ENDPOINTS ---
app.get("/api/telegram/accounts", (req, res) => {
  const dbAccounts = getSavedTgAccountsList();
  const results = dbAccounts.map(acc => {
    const session = activeTgSessions.get(acc.phone);
    return {
      phone: acc.phone,
      name: acc.name,
      username: acc.username,
      linkedAt: acc.linkedAt,
      status: session && session.client && session.client.connected ? "connected" : "disconnected",
    };
  });
  res.json({ accounts: results });
});

app.post("/api/telegram/request-otp", async (req, res) => {
  const { phone, apiId, apiHash } = req.body;
  if (!phone) {
    return res.status(400).json({ error: "Phone number is required." });
  }

  const cleanPhone = phone.replace(/\D/g, "");
  const selectedApiId = Number(apiId) || TG_API_ID;
  const selectedApiHash = apiHash || TG_API_HASH;

  try {
    console.log(`[Telegram Auth] Sending OTP to +${cleanPhone}...`);
    const session = new StringSession("");
    const client = new TelegramClient(session, selectedApiId, selectedApiHash, {
      connectionRetries: 3,
    });

    await client.connect();

    const { phoneCodeHash } = await client.sendCode(
      {
        apiId: selectedApiId,
        apiHash: selectedApiHash,
      },
      "+" + cleanPhone
    );

    const tempToken = "tg_" + Math.random().toString(36).substring(2, 15);
    pendingTgLogins.set(tempToken, {
      client,
      phoneNumber: "+" + cleanPhone,
      phoneCodeHash,
      expiresAt: Date.now() + 10 * 60 * 1000, 
    });

    res.json({
      success: true,
      tempToken,
      phone: cleanPhone
    });
  } catch (err: any) {
    console.error("[Telegram Auth] sendCode Error:", err);
    res.status(500).json({ error: err.message || "Failed to send Telegram authentication code." });
  }
});

app.post("/api/telegram/verify-otp", async (req, res) => {
  const { tempToken, code, password } = req.body;
  if (!tempToken || !code) {
    return res.status(400).json({ error: "Verification token and code are required." });
  }

  const pending = pendingTgLogins.get(tempToken);
  if (!pending) {
    return res.status(400).json({ error: "Session expired or invalid. Please request code again." });
  }

  const { client, phoneNumber, phoneCodeHash } = pending;

  try {
    let authUser;
    
    if (password) {
      authUser = await client.signIn({
        phoneNumber,
        password: async () => password,
        phoneCodeHash,
        phoneCode: code
      });
    } else {
      try {
        authUser = await client.signIn({
          phoneNumber,
          phoneCodeHash,
          phoneCode: code,
        });
      } catch (signInErr: any) {
        if (signInErr.message?.includes("SESSION_PASSWORD_NEEDED")) {
          return res.json({
            success: false,
            passwordRequired: true,
            message: "Two-Factor Authentication (2FA) is enabled. Please provide your cloud password."
          });
        }
        throw signInErr;
      }
    }

    const me = await client.getMe();
    const sessionStr = String(client.session.save());

    const cleanPhone = phoneNumber.replace(/\D/g, "");
    saveTgAccountToDb(cleanPhone, me.firstName || "Telegram User", me.username || "", sessionStr);

    activeTgSessions.set(cleanPhone, { client, status: "connected" });
    pendingTgLogins.delete(tempToken);

    startTgUserbotListeners(client, cleanPhone);

    res.json({
      success: true,
      me: {
        id: me.id ? me.id.toString() : "",
        firstName: me.firstName || "",
        lastName: me.lastName || "",
        username: me.username || "",
        phone: cleanPhone
      }
    });
  } catch (err: any) {
    console.error("[Telegram Auth] signin Error:", err);
    res.status(500).json({ error: err.message || "Failed to authenticate with Telegram. Double check the OTP or password." });
  }
});

app.post("/api/telegram/delete-account", (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: "Phone number is required." });
  }
  const success = deleteTgAccountFromDb(phone.replace(/\D/g, ""));
  res.json({ success });
});

// TELEGRAM PHONE CHECKER (Checks if a single phone number is registered on Telegram)
app.get("/api/telegram/check-phone", async (req, res) => {
  const { phone, clientPhone } = req.query;
  if (!phone) {
    return res.status(400).json({ error: "Target phone number to check is required." });
  }

  // Find a client to query from
  let senderPhone = clientPhone as string;
  if (!senderPhone || senderPhone === "undefined") {
    const clients = Array.from(activeTgSessions.keys());
    if (clients.length > 0) {
      senderPhone = clients[0];
    } else {
      const dbAccounts = getSavedTgAccountsList();
      if (dbAccounts.length > 0) {
        senderPhone = dbAccounts[0].phone;
      }
    }
  }

  if (!senderPhone) {
    return res.status(400).json({
      error: "No active Telegram logins are connected! Please log in to a Telegram account (e.g., in the Telegram sessions tab) before checking numbers."
    });
  }

  try {
    const targetPhone = String(phone).replace(/\D/g, "");
    const client = await getActiveTgClient(senderPhone);

    console.log(`[Telegram Check-Phone API] Checking +${targetPhone} using +${senderPhone}...`);

    const result = await client.invoke(
      new Api.contacts.ImportContacts({
        contacts: [
          new Api.InputPhoneContact({
            clientId: Math.floor(Math.random() * 10000000) as any,
            phone: targetPhone.startsWith("+") ? targetPhone : "+" + targetPhone,
            firstName: "TempCheck",
            lastName: ""
          })
        ]
      })
    );

    if (result && result.users && result.users.length > 0) {
      const user: any = result.users[0];
      
      // Clean up of temporary contact import list
      if (user.id) {
        try {
          await client.invoke(
            new Api.contacts.DeleteContacts({ id: [user.id] })
          );
        } catch (delErr) {
          console.error("[Telegram Check-Phone API] Deleted contacts failed cleaner:", delErr);
        }
      }

      const isRealUser = user.className === "User" || user.id;
      if (isRealUser) {
        return res.json({
          exists: true,
          phone: user.phone || targetPhone,
          id: user.id ? user.id.toString() : "",
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          username: user.username || "",
          isBot: user.bot || false
        });
      }
    }

    return res.json({
      exists: false,
      phone: targetPhone
    });
  } catch (err: any) {
    console.error(`[Telegram Check-Phone API] Error for +${phone}:`, err);
    res.status(500).json({ error: err.message || "Could not check registered state via Telegram Client." });
  }
});

// NEW MULTI-ACCOUNT API ENDPOINTS FOR CLIENT UI EXTENSION
app.get("/api/accounts", (req, res) => {
  const dbAccounts = getSavedAccountsList();
  const results = dbAccounts.map(acc => {
    const session = activeSessions.get(acc.phone);
    return {
      ...acc,
      status: session ? session.status : "disconnected",
      error: session ? session.error : null,
    };
  });
  res.json({
    accounts: results,
    currentActivePhone: currentActivePhone
  });
});

app.post("/api/switch-account", (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: "Phone number is required." });
  }
  const dbAccounts = getSavedAccountsList();
  const exists = dbAccounts.some(acc => acc.phone === phone);
  if (!exists) {
    return res.status(404).json({ error: "Account not found in local database." });
  }
  currentActivePhone = phone;
  updateGlobalSessionStateToSelectedActive();
  res.json({ success: true, currentActivePhone });
});

app.post("/api/delete-account", (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: "Phone number is required." });
  }
  const success = deleteAccountFromDb(phone);
  res.json({ success });
});

// ============================================================================
// LIVE VPS TERMINAL & BOT TESTER API ENDPOINTS
// ============================================================================

app.get("/api/vps/status", (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    uptime: Math.floor(process.uptime()),
    memoryMb: Math.round(mem.rss / 1024 / 1024),
    heapMb: Math.round(mem.heapUsed / 1024 / 1024),
    nodeVersion: process.version,
    platform: `${process.platform} ${process.arch}`,
    tgBotInfo,
    activeSessionsCount: activeSessions.size,
    savedAccountsCount: getSavedAccountsList().length,
    activePhones: Array.from(activeSessions.keys()),
  });
});

app.get("/api/vps/logs", (req, res) => {
  const since = Number(req.query.since || 0);
  const filtered = since > 0 ? vpsLogs.filter(l => l.id > since) : vpsLogs.slice(-150);
  res.json({
    logs: filtered,
    lastId: vpsLogs.length > 0 ? vpsLogs[vpsLogs.length - 1].id : 0
  });
});

app.get("/api/vps/bot-code", (req, res) => {
  const botPath = path.join(process.cwd(), "bot.js");
  if (fs.existsSync(botPath)) {
    const code = fs.readFileSync(botPath, "utf-8");
    res.json({ code, filename: "bot.js" });
  } else {
    res.status(404).json({ error: "bot.js not found" });
  }
});

app.post("/api/vps/command", async (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "Command string is required." });
  }

  const trimmed = command.trim();
  addVpsLog("cmd", `$ ${trimmed}`);

  if (trimmed === "clear") {
    vpsLogs.length = 0;
    addVpsLog("info", "Console output buffer cleared.");
    return res.json({ success: true, output: "Console buffer cleared." });
  }

  if (trimmed === "help") {
    const helpOutput = [
      "🖥️ Available VPS & Bot Commands:",
      "  • menu                : View active Telegram ReplyKeyboardMarkup buttons",
      "  • /login <phone>      : Request WhatsApp pairing code via Baileys and Telegram",
      "  • /check <phone>      : Verify if a phone number has an active WhatsApp account",
      "  • /status             : View active WhatsApp accounts and Telegram Bot state",
      "  • node bot.js         : Run bot diagnostics & test Telegram API connectivity",
      "  • test-tg / ping      : Ping Telegram Bot API (getMe) and refresh connection",
      "  • ls                  : List project files in VPS directory",
      "  • clear               : Clear terminal log buffer",
      "  • cat package.json    : View applet dependencies and scripts"
    ].join("\n");
    addVpsLog("info", helpOutput);
    return res.json({ success: true, output: helpOutput });
  }

  if (trimmed === "menu" || trimmed === "/menu") {
    const menuOut = [
      "📱 [Telegram Bot Menu Builder Buttons]:",
      "  Row 1: [CONNECT WS CHECKER] (icon: 5429612632430654504, style: primary)",
      "  Row 2: [CHECK WS NUMBER] (icon: 5429612632430654504, style: success)",
      "  Row 3: [BUY WS AND TG API] (icon: 5170692113834181832, style: primary) | [MY PACKAGE] (icon: 5312361253610475399, style: primary)",
      "  Row 4: [MY PROFILE] (icon: 5208604387156448480, style: success) | [HELP] (icon: 5832352677849205948, style: success)",
      "  Row 5: [ADMIN PANEL] (icon: 5764869872521581153, style: danger)",
      "  -> resize_keyboard: true"
    ].join("\n");
    addVpsLog("bot", menuOut);
    return res.json({ success: true, output: menuOut });
  }

  if (trimmed === "CONNECT WS CHECKER") {
    const out = "🔗 [Bot Menu Response] CONNECT WS CHECKER -> Prompted /login <phone> to pair WhatsApp account.";
    addVpsLog("bot", out);
    return res.json({ success: true, output: out });
  }

  if (trimmed === "CHECK WS NUMBER") {
    const out = "🔍 [Bot Menu Response] CHECK WS NUMBER -> Prompted /check <phone>, raw numbers, or .txt file upload.";
    addVpsLog("bot", out);
    return res.json({ success: true, output: out });
  }

  if (trimmed === "BUY WS AND TG API" || trimmed === "BUY WS API" || trimmed === "BUY PACKAGE") {
    const out = "⚡ [Bot Menu Response] BUY WS AND TG API -> WhatsApp & Telegram REST API documentation & key purchase guide presented.";
    addVpsLog("bot", out);
    return res.json({ success: true, output: out });
  }

  if (trimmed === "HELP") {
    const out = "📖 [Bot Menu Response] HELP -> Command documentation and usage guidelines sent.";
    addVpsLog("bot", out);
    return res.json({ success: true, output: out });
  }

  if (trimmed === "MY PROFILE") {
    const accounts = getSavedAccountsList();
    const out = `👤 [Bot Menu Response] MY PROFILE -> User verified, Linked WhatsApp: ${accounts.length} accounts, Status: Active`;
    addVpsLog("bot", out);
    return res.json({ success: true, output: out });
  }

  if (trimmed === "MY PACKAGE") {
    const out = "📦 [Bot Menu Response] MY PACKAGE -> Starter Tier (500 daily quota, unlimited single checks, ultra-fast)";
    addVpsLog("bot", out);
    return res.json({ success: true, output: out });
  }

  if (trimmed === "ADMIN PANEL") {
    const out = `⚙️ [Bot Menu Response] ADMIN PANEL -> Active gateway: ${currentActivePhone || "None"}, Saved accounts: ${getSavedAccountsList().length}`;
    addVpsLog("bot", out);
    return res.json({ success: true, output: out });
  }

  if (trimmed === "ls" || trimmed === "dir") {
    try {
      const files = fs.readdirSync(process.cwd()).filter(f => !f.startsWith(".") && f !== "node_modules");
      const out = files.join("   ");
      addVpsLog("info", out);
      return res.json({ success: true, output: out });
    } catch (e: any) {
      addVpsLog("error", `ls error: ${e.message}`);
      return res.json({ success: false, output: e.message });
    }
  }

  if (trimmed === "status" || trimmed === "/status") {
    const accounts = getSavedAccountsList();
    const out = [
      `📊 [VPS Status Report]`,
      `  • Node.js: ${process.version} | Platform: ${process.platform} ${process.arch}`,
      `  • Uptime: ${Math.floor(process.uptime())}s | Memory RSS: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      `  • Telegram Bot: @${tgBotInfo.username} (ID: ${tgBotInfo.id || "N/A"}) - ${tgBotInfo.status.toUpperCase()}`,
      `  • Active WA Sessions: ${activeSessions.size} | Saved in DB: ${accounts.length}`,
      `  • Accounts: ${accounts.map(a => `+${a.phone} (${a.name})`).join(", ") || "None"}`
    ].join("\n");
    addVpsLog("info", out);
    return res.json({ success: true, output: out });
  }

  if (trimmed === "test-tg" || trimmed === "ping" || trimmed === "node bot.js" || trimmed === "npm run bot") {
    addVpsLog("bot", `[VPS Runner] Executing test cycle on Telegram Bot (@${tgBotInfo.username})...`);
    try {
      const resp = await fetch(`${TG_API_URL}/getMe`);
      if (resp.ok) {
        const d = await resp.json() as any;
        tgBotInfo.username = d.result?.username || "Unknown";
        tgBotInfo.id = String(d.result?.id || "");
        tgBotInfo.name = d.result?.first_name || "Bot";
        tgBotInfo.status = "online";
        tgBotInfo.lastPing = new Date().toISOString();
        const successMsg = `✅ [Telegram Bot OK] Connected to @${tgBotInfo.username} (Name: ${tgBotInfo.name}, ID: ${tgBotInfo.id}). Polling is active and working!`;
        addVpsLog("bot", successMsg);
        return res.json({ success: true, output: successMsg });
      } else {
        const errMsg = `❌ [Telegram Bot Error] Status ${resp.status}: ${await resp.text()}`;
        addVpsLog("error", errMsg);
        return res.json({ success: false, output: errMsg });
      }
    } catch (e: any) {
      const errMsg = `❌ [Telegram Connection Error] ${e.message}`;
      addVpsLog("error", errMsg);
      return res.json({ success: false, output: errMsg });
    }
  }

  if (trimmed.startsWith("/login ") || trimmed.startsWith("login ")) {
    const rawNum = trimmed.replace(/^\/?login\s+/, "").trim();
    const cleanNum = normalizePhone(rawNum);
    if (!cleanNum || cleanNum.length < 8) {
      const err = `❌ Invalid phone number. Please provide standard phone like: /login 8801700000000`;
      addVpsLog("error", err);
      return res.json({ success: false, output: err });
    }
    addVpsLog("wa", `📱 Requesting WhatsApp pairing code for +${cleanNum}...`);
    try {
      initWhatsApp(cleanNum, false);
      const out = `⏳ Initiated WhatsApp pairing handshake for +${cleanNum}. Check logs in ~2 seconds for pairing code!`;
      addVpsLog("info", out);
      return res.json({ success: true, output: out });
    } catch (e: any) {
      const err = `❌ Pairing request failed: ${e.message}`;
      addVpsLog("error", err);
      return res.json({ success: false, output: err });
    }
  }

  if (trimmed.startsWith("/check ") || trimmed.startsWith("check ")) {
    const rawNum = trimmed.replace(/^\/?check\s+/, "").trim();
    const cleanNum = normalizePhone(rawNum);
    if (!cleanNum || cleanNum.length < 8) {
      const err = `❌ Invalid phone number. Usage: /check 8801700000000`;
      addVpsLog("error", err);
      return res.json({ success: false, output: err });
    }

    addVpsLog("wa", `🔍 Checking WhatsApp registration for +${cleanNum}...`);

    let sockToUse: any = null;
    if (activeSock && sessionState.status === "connected") {
      sockToUse = activeSock;
    } else {
      for (const [_, sess] of activeSessions.entries()) {
        if (sess.status === "connected" && sess.sock) {
          sockToUse = sess.sock;
          break;
        }
      }
    }

    if (!sockToUse) {
      const err = `⚠️ No active WhatsApp connection found. Connect a WhatsApp account first via Web UI or /login <phone> before checking numbers.`;
      addVpsLog("warn", err);
      return res.json({ success: false, output: err });
    }

    try {
      const result = await sockToUse.onWhatsApp(cleanNum);
      const target = result && result.length > 0 ? result[0] : null;
      if (target && target.exists) {
        const out = `✅ [WhatsApp Check: Active] +${cleanNum} is registered on WhatsApp!\n   JID: ${target.jid}`;
        addVpsLog("wa", out);
        return res.json({ success: true, output: out, exists: true, jid: target.jid });
      } else {
        const out = `❌ [WhatsApp Check: Inactive] +${cleanNum} is NOT registered on WhatsApp.`;
        addVpsLog("warn", out);
        return res.json({ success: true, output: out, exists: false });
      }
    } catch (e: any) {
      const err = `❌ Check failed: ${e.message}`;
      addVpsLog("error", err);
      return res.json({ success: false, output: err });
    }
  }

  const feedback = `Command received: "${trimmed}". Type "help" to see available VPS commands.`;
  addVpsLog("info", feedback);
  res.json({ success: true, output: feedback });
});


// Setup Vite and Static Servers
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server starting securely on http://0.0.0.0:${PORT}`);

    // LOCAL DATABASE RECONNECTION HANDLER ON SERVER STARTUP
    const savedAccounts = getSavedAccountsList();
    if (savedAccounts.length > 0) {
      console.log(`[Startup DB] Found ${savedAccounts.length} saved accounts in local database. Restoring...`);
      currentActivePhone = savedAccounts[0].phone;
      
      for (const acc of savedAccounts) {
        const authDir = path.join(process.cwd(), `whatsapp_auth_session_${acc.phone}`);
        const credsFile = path.join(authDir, "creds.json");
        if (fs.existsSync(credsFile)) {
          console.log(`[Startup DB] Initializing saved WhatsApp key credentials for +${acc.phone}`);
          initWhatsApp(acc.phone, true);
        } else {
          console.log(`[Startup DB] Credentials not found folder for saved account +${acc.phone}. Marking status offline.`);
          activeSessions.set(acc.phone, {
            phoneNumber: acc.phone,
            sock: null,
            status: "disconnected",
            pairingCode: "",
            profile: null,
            error: null
          });
        }
      }
      updateGlobalSessionStateToSelectedActive();
    } else {
      // BACKWARDS COMPATIBILITY MIGRATION: Auto import legacy raw "whatsapp_auth_session" folder
      const oldAuthDir = path.join(process.cwd(), "whatsapp_auth_session");
      const credsFile = path.join(oldAuthDir, "creds.json");
      if (fs.existsSync(credsFile)) {
        try {
          const creds = JSON.parse(fs.readFileSync(credsFile, "utf-8"));
          const phoneJid = creds.me?.id;
          if (phoneJid) {
            const savedPhone = phoneJid.split(":")[0].split("@")[0];
            console.log(`[Startup Migration] Migrating legacy single session folder for +${savedPhone} to multi-session folder`);
            const newAuthDir = path.join(process.cwd(), `whatsapp_auth_session_${savedPhone}`);
            if (!fs.existsSync(newAuthDir)) {
              fs.renameSync(oldAuthDir, newAuthDir);
            }
            saveAccountToDb(savedPhone, creds.me.name || "WhatsApp User");
            currentActivePhone = savedPhone;
            initWhatsApp(savedPhone, true);
            updateGlobalSessionStateToSelectedActive();
          }
        } catch (e) {
          console.error("[Startup Migration] Failed legacy configuration transfer:", e);
        }
      }
    }

    // FIRE TELEGRAM BOT LISTENERS
    startTelegramBot();
    // RESTORE SAVED TELEGRAM CLIENT SESSIONS
    initAllTgSessions().catch(err => console.error("[Startup DB TG] Restoring sessions failed:", err));
  });
}

startServer();
