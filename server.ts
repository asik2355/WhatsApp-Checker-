import express from "express";
import path from "path";
import fs from "fs";
import pino from "pino";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket, Browsers, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import { createServer as createViteServer } from "vite";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { initializeApp, cert, getApps, getApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

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
  externalUserId?: string;
  apiKey?: string;
}

export interface ApiUserRecord {
  userId: string;
  name: string;
  apiKey?: string;
  senderPhones: string[];
  activeSenderPhone: string | null;
  checksCount: number;
  createdAt: string;
  updatedAt: string;
}

const DB_FILE = path.join(process.cwd(), "db_accounts.json");
const API_USERS_DB_FILE = path.join(process.cwd(), "db_api_users.json");

// --- TELEGRAM MODULES AND DATA STORES ---
const TG_DB_FILE = path.join(process.cwd(), "db_telegram_accounts.json");
const TG_API_ID = Number(process.env.TELEGRAM_API_ID || "2040"); 
const TG_API_HASH = process.env.TELEGRAM_API_HASH || "b18441a1fff1153b5436ca404d41255e";

interface SavedTgAccount {
  phone: string;
  name: string;
  username: string;
  session: string;
  apiId?: number;
  apiHash?: string;
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

interface AdminTgWizardState {
  step: "await_api_id" | "await_api_hash" | "await_phone" | "await_otp" | "await_2fa" | "edit_api_id" | "edit_api_hash";
  apiId?: number;
  apiHash?: string;
  phone?: string;
  phoneCodeHash?: string;
  client?: any;
  targetPhone?: string;
}

const adminTgWizard = new Map<string, AdminTgWizardState>();

function getSavedTgAccountsList(): SavedTgAccount[] {
  if (inMemoryTgAccounts) return inMemoryTgAccounts;
  if (!fs.existsSync(TG_DB_FILE)) {
    inMemoryTgAccounts = [];
    return [];
  }
  try {
    const data = fs.readFileSync(TG_DB_FILE, "utf-8");
    inMemoryTgAccounts = JSON.parse(data);
    return inMemoryTgAccounts || [];
  } catch (e) {
    inMemoryTgAccounts = [];
    return [];
  }
}

function saveTgAccountToDb(
  phone: string,
  name: string,
  username: string,
  session: string,
  apiId: number = TG_API_ID,
  apiHash: string = TG_API_HASH
) {
  const accounts = getSavedTgAccountsList();
  const existingIdx = accounts.findIndex((acc) => acc.phone === phone);
  const targetAcc: SavedTgAccount = {
    phone,
    name,
    username,
    session,
    apiId,
    apiHash,
    linkedAt: new Date().toISOString(),
    status: "connected"
  };

  if (existingIdx > -1) {
    accounts[existingIdx] = targetAcc;
  } else {
    accounts.push(targetAcc);
  }

  inMemoryTgAccounts = accounts;
  saveLocalTgDB();
  syncFirebaseTgAccount(targetAcc);
  console.log(`[DB TG] Saved Telegram account +${phone} successfully.`);
}

function updateTgAccountCredentialsInDb(phone: string, newApiId?: number, newApiHash?: string): SavedTgAccount | null {
  const accounts = getSavedTgAccountsList();
  const idx = accounts.findIndex((acc) => acc.phone === phone);
  if (idx === -1) return null;

  if (newApiId !== undefined) {
    accounts[idx].apiId = newApiId;
  }
  if (newApiHash !== undefined) {
    accounts[idx].apiHash = newApiHash;
  }

  inMemoryTgAccounts = accounts;
  saveLocalTgDB();
  syncFirebaseTgAccount(accounts[idx]);

  // Reconnect session with updated credentials
  const existing = activeTgSessions.get(phone);
  if (existing && existing.client) {
    try {
      existing.client.disconnect();
    } catch {}
    activeTgSessions.delete(phone);
  }
  getActiveTgClient(phone).catch((err) => console.warn(`[DB TG] Reconnect after edit warning for +${phone}:`, err?.message || err));

  return accounts[idx];
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

  inMemoryTgAccounts = filtered;
  saveLocalTgDB();
  deleteFirebaseTgAccount(phone);

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

function extractPhoneNumbers(rawText: string): string[] {
  if (!rawText) return [];
  const results: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (raw: string) => {
    const digitsOnly = raw.replace(/\D/g, "");
    if (digitsOnly.length < 8 || digitsOnly.length > 15) return;
    const clean = normalizePhone(digitsOnly);
    if (clean && clean.length >= 8 && clean.length <= 15 && !seen.has(clean)) {
      seen.add(clean);
      results.push(clean);
    }
  };

  // Match formatted international/local phone numbers (with optional +, spaces, dashes, parens)
  const formattedMatches = rawText.match(/(?:\+?\d[\d\s\-().]{6,18}\d)/g);
  if (formattedMatches) {
    for (const m of formattedMatches) {
      addCandidate(m);
    }
  }

  // Fallback contiguous digit scan
  const contiguousMatches = rawText.match(/(\+?[0-9]{8,15})/g);
  if (contiguousMatches) {
    for (const m of contiguousMatches) {
      addCandidate(m);
    }
  }

  return results;
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

  const useApiId = Number(acc.apiId) || TG_API_ID;
  const useApiHash = acc.apiHash || TG_API_HASH;

  console.log(`[Telegram Client] Connecting client for +${phone} (API ID: ${useApiId})...`);
  const client = new TelegramClient(
    new StringSession(acc.session),
    useApiId,
    useApiHash,
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
        const useApiId = Number(acc.apiId) || TG_API_ID;
        const useApiHash = acc.apiHash || TG_API_HASH;
        console.log(`[Telegram Service] Restoring session for +${acc.phone} (API ID: ${useApiId})...`);
        const client = new TelegramClient(
          new StringSession(acc.session),
          useApiId,
          useApiHash,
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

// Store temporary mapping of phone numbers being linked via Telegram or API to their owner
const linkingOwners = new Map<string, { chatId?: number; name: string; externalUserId?: string; apiKey?: string }>();

export function getApiUsersList(): ApiUserRecord[] {
  if (!fs.existsSync(API_USERS_DB_FILE)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(API_USERS_DB_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("[API DB] Error reading db_api_users.json:", e);
    return [];
  }
}

export function saveApiUsersList(users: ApiUserRecord[]) {
  try {
    fs.writeFileSync(API_USERS_DB_FILE, JSON.stringify(users, null, 2), "utf-8");
  } catch (e) {
    console.error("[API DB] Failed saving db_api_users.json:", e);
  }
}

export function upsertApiUserPhone(
  userId: string,
  phone: string,
  name = "API User",
  apiKey?: string
): ApiUserRecord {
  const cleanUserId = String(userId).trim();
  const cleanPhone = normalizePhone(phone);
  const users = getApiUsersList();
  const now = new Date().toISOString();
  let rec = users.find((u) => String(u.userId) === cleanUserId);

  if (rec) {
    if (name && name !== "API User") rec.name = name;
    if (apiKey) rec.apiKey = apiKey;
    if (cleanPhone && !rec.senderPhones.includes(cleanPhone)) {
      rec.senderPhones.push(cleanPhone);
    }
    if (cleanPhone) {
      rec.activeSenderPhone = cleanPhone;
    }
    rec.updatedAt = now;
  } else {
    rec = {
      userId: cleanUserId,
      name: name || `User ${cleanUserId}`,
      apiKey,
      senderPhones: cleanPhone ? [cleanPhone] : [],
      activeSenderPhone: cleanPhone || null,
      checksCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    users.push(rec);
  }

  saveApiUsersList(users);
  return rec;
}

export function removeApiUserPhone(phone: string, userId?: string) {
  const cleanPhone = normalizePhone(phone);
  const users = getApiUsersList();
  let changed = false;

  for (const u of users) {
    if (userId && String(u.userId) !== String(userId).trim()) continue;
    if (u.senderPhones.includes(cleanPhone)) {
      u.senderPhones = u.senderPhones.filter((p) => p !== cleanPhone);
      if (u.activeSenderPhone === cleanPhone) {
        u.activeSenderPhone = u.senderPhones.length > 0 ? u.senderPhones[0] : null;
      }
      u.updatedAt = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) {
    saveApiUsersList(users);
  }
}

export function incrementApiUserChecks(userId: string | undefined, count: number) {
  if (!userId) return;
  const cleanUserId = String(userId).trim();
  const users = getApiUsersList();
  const rec = users.find((u) => String(u.userId) === cleanUserId);
  if (rec) {
    rec.checksCount = (rec.checksCount || 0) + count;
    rec.updatedAt = new Date().toISOString();
    saveApiUsersList(users);
  }
}

function getSavedAccountsList(): SavedAccount[] {
  let accounts: SavedAccount[] = [];
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        accounts = parsed;
      }
    } catch (e) {
      console.error("[DB] Error reading db_accounts.json, using empty array:", e);
    }
  }

  // Auto-discover any authenticated whatsapp_auth_session_<phone> folders on disk
  try {
    const dirs = fs.readdirSync(process.cwd());
    let updated = false;
    for (const d of dirs) {
      const match = d.match(/^whatsapp_auth_session_(\d+)$/);
      if (match && match[1]) {
        const phone = match[1];
        const credsPath = path.join(process.cwd(), d, "creds.json");
        if (fs.existsSync(credsPath)) {
          try {
            const creds = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
            const isRegistered = Boolean(creds?.registered || creds?.account || creds?.me?.id);
            if (isRegistered && !accounts.some(a => a.phone === phone)) {
              const discoveredName = creds?.me?.name || "WhatsApp User";
              const pendingOwner = linkingOwners.get(phone);
              accounts.push({
                phone,
                name: discoveredName,
                linkedAt: new Date().toISOString(),
                addedByChatId: pendingOwner?.chatId ?? Number(ADMIN_CHAT_ID),
                addedByName: pendingOwner?.name || discoveredName,
                externalUserId: pendingOwner?.externalUserId,
                apiKey: pendingOwner?.apiKey
              });
              updated = true;
              console.log(`[DB Auto-Discovery] Restored authenticated WhatsApp session +${phone} (${discoveredName}) from disk.`);
            }
          } catch {}
        }
      }
    }
    if (updated) {
      fs.writeFileSync(DB_FILE, JSON.stringify(accounts, null, 2), "utf-8");
    }
  } catch (e) {
    console.error("[DB Auto-Discovery] Failed scanning session directories:", e);
  }

  return accounts;
}

function saveAccountToDb(
  phone: string,
  name: string,
  addedByChatId?: number,
  addedByName?: string,
  externalUserId?: string,
  apiKey?: string
) {
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
    if (externalUserId !== undefined) {
      accounts[existingIdx].externalUserId = externalUserId;
    }
    if (apiKey !== undefined) {
      accounts[existingIdx].apiKey = apiKey;
    }
  } else {
    accounts.push({
      phone,
      name: cleanName,
      linkedAt: new Date().toISOString(),
      addedByChatId,
      addedByName,
      externalUserId,
      apiKey
    });
  }

  if (externalUserId) {
    upsertApiUserPhone(externalUserId, phone, addedByName || cleanName, apiKey);
  }

  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(accounts, null, 2), "utf-8");
    console.log(`[DB] Account +${phone} saved successfully to local database (AddedBy: ${addedByName || externalUserId || "System"}).`);
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

  removeApiUserPhone(phone);

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

// Resolve isolated WhatsApp session for API calls (supports specific senderPhone and/or per-user userId)
function resolveApiWhatsAppSession(
  rawSenderPhone?: string,
  rawUserId?: string
): { session: ConnectedSession | null; senderPhone: string; userId?: string; error?: string } {
  const cleanSender = rawSenderPhone ? normalizePhone(String(rawSenderPhone)) : "";
  const cleanUserId = rawUserId ? String(rawUserId).trim() : "";
  const savedAccounts = getSavedAccountsList();

  // 1. If a specific senderPhone was requested, strictly check with that phone
  if (cleanSender) {
    if (cleanUserId) {
      const acc = savedAccounts.find((a) => a.phone === cleanSender);
      const owner = linkingOwners.get(cleanSender);
      const belongsToUser =
        (acc && (String(acc.externalUserId) === cleanUserId || String(acc.addedByChatId) === cleanUserId)) ||
        (owner && (String(owner.externalUserId) === cleanUserId || String(owner.chatId) === cleanUserId));
      if (acc && (acc.externalUserId || acc.addedByChatId) && !belongsToUser) {
        return {
          session: null,
          senderPhone: cleanSender,
          userId: cleanUserId,
          error: `WhatsApp number +${cleanSender} does not belong to userId '${cleanUserId}'.`
        };
      }
    }

    const sess = activeSessions.get(cleanSender);
    if (sess && sess.status === "connected" && sess.sock) {
      return { session: sess, senderPhone: cleanSender, userId: cleanUserId || undefined };
    }
    return {
      session: null,
      senderPhone: cleanSender,
      userId: cleanUserId || undefined,
      error: `WhatsApp number +${cleanSender} is not connected. Please link this number first via /api/connect-whatsapp.`
    };
  }

  // 2. If userId was provided (without senderPhone), strictly use that user's isolated WhatsApp account(s)
  if (cleanUserId) {
    const apiUsers = getApiUsersList();
    const userRec = apiUsers.find((u) => String(u.userId) === cleanUserId);
    const candidatePhones = new Set<string>();

    if (userRec) {
      if (userRec.activeSenderPhone) candidatePhones.add(userRec.activeSenderPhone);
      for (const p of userRec.senderPhones) candidatePhones.add(p);
    }

    for (const acc of savedAccounts) {
      if (String(acc.externalUserId) === cleanUserId || String(acc.addedByChatId) === cleanUserId) {
        candidatePhones.add(acc.phone);
      }
    }

    for (const [phone, owner] of linkingOwners.entries()) {
      if (String(owner.externalUserId) === cleanUserId || String(owner.chatId) === cleanUserId) {
        candidatePhones.add(phone);
      }
    }

    for (const ph of candidatePhones) {
      const sess = activeSessions.get(ph);
      if (sess && sess.status === "connected" && sess.sock) {
        return { session: sess, senderPhone: ph, userId: cleanUserId };
      }
    }

    return {
      session: null,
      senderPhone: "",
      userId: cleanUserId,
      error: `No active WhatsApp account connected for userId '${cleanUserId}'. Please link a WhatsApp number first via /api/connect-whatsapp.`
    };
  }

  // 3. Fallback: global active session or any connected session
  if (activeSock && sessionState.status === "connected" && currentActivePhone) {
    const sess = activeSessions.get(currentActivePhone);
    if (sess && sess.status === "connected" && sess.sock) {
      return { session: sess, senderPhone: currentActivePhone };
    }
  }

  for (const [ph, sess] of activeSessions.entries()) {
    if (sess && sess.status === "connected" && sess.sock) {
      return { session: sess, senderPhone: ph };
    }
  }

  return {
    session: null,
    senderPhone: "",
    error: "No WhatsApp account is currently connected. Please link a WhatsApp number first via /api/connect-whatsapp."
  };
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

    sock.ev.on("creds.update", async () => {
      await saveCreds();
      try {
        const creds: any = sock.authState?.creds;
        if (creds && (creds.registered || creds.account || creds.me?.id)) {
          const owner = linkingOwners.get(phoneNumber);
          const profileName = sock.user?.name || creds.me?.name || "WhatsApp User";
          saveAccountToDb(phoneNumber, profileName, owner?.chatId, owner?.name, owner?.externalUserId, owner?.apiKey);
        }
      } catch {}
    });

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

        // Persistent save in db_accounts.json local database with Telegram/API owner attribution if available
        const owner = linkingOwners.get(phoneNumber);
        saveAccountToDb(
          phoneNumber, 
          sock.user?.name || "", 
          owner?.chatId, 
          owner?.name,
          owner?.externalUserId,
          owner?.apiKey
        );

        // Notify the Telegram user who linked this account
        if (owner?.chatId) {
          sendTelegramMessage(
            owner.chatId,
            `🎉 *WhatsApp Linked Successfully!* \n\nYour WhatsApp account (+${phoneNumber}) has been connected and linked to your Telegram account.`
          ).catch(e => console.error("[Telegram notify] error:", e));
        }

        // Keep global variables in sync
        updateGlobalSessionStateToSelectedActive();

        // Send a self validation text message
        try {
          const userJid = sock.user?.id;
          if (userJid) {
            await sock.sendMessage(userJid, {
              text: `🎉 *WhatsApp Gateway Connected* \n\nYour device is now linked to the Linkify engine and saved in the local database.`,
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
  if (rawText.includes("LIVE WS NUMBER CHECKER") || rawText.includes("LIVE TG NUMBER CHECKER")) {
    return rawText;
  }
  const existingTags: string[] = [];
  let protectedText = rawText.replace(/<tg-emoji[^>]*>.*?<\/tg-emoji>/gi, (match) => {
    existingTags.push(match);
    return `__TG_EMOJI_PLACEHOLDER_${existingTags.length - 1}__`;
  });

  protectedText = protectedText.replace(/(?:🟢|🔵)\s*(?:<b>)?GOOD(?:<\/b>)?\s*—\s*(?:🚫|⚫)\s*(?:<b>)?BAD(?:<\/b>)?/gi, (match) => {
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
  let result = text.replace(/<(\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|a|tg-emoji|tg-spoiler|blockquote))(?:\s+[^>]*)?>/gi, (tag) => {
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

// --- BOT USER & LICENSE DATABASE SCHEMA ---
export interface BotUser {
  chatId: number;
  username: string;
  name: string;
  firstSeen: string;
  lastActive: string;
  isPremium: boolean;
  package: "Free" | "Premium API" | "Enterprise API";
  grantedAt?: string;
  checksCount: number;
  menuMode?: "connect_ws" | "check_ws" | "check_tg" | null;
  balanceBdt?: number;
  balanceUsd?: number;
  apiKey?: string;
}

const USERS_DB_FILE = path.join(process.cwd(), "db_bot_users.json");

// --- IN-MEMORY CACHE (RAM-FIRST ARCHITECTURE FOR ZERO LATENCY) ---
export let inMemoryUsers: BotUser[] | null = null;
export let inMemoryTgAccounts: SavedTgAccount[] | null = null;
export let inMemorySettings: Record<string, any> = {
  dollarRate: 125,
  currency: "BDT",
  paymentMethods: [
    { id: "bkash", name: "bKash Personal", number: "01700000000", status: "active" },
    { id: "nagad", name: "Nagad Personal", number: "01700000000", status: "active" },
    { id: "binance", name: "Binance Pay USDT", payId: "12345678", status: "active" }
  ]
};

// --- FIREBASE FIRESTORE INTEGRATION ---
export const FIREBASE_KEY_FILE = path.join(process.cwd(), "firebase-service-account.json");
export let firestoreDb: Firestore | null = null;

export function getFirestoreDb(): Firestore | null {
  return firestoreDb;
}

// 1. ATOMIC LOCAL WRITE (Write to .tmp then rename atomically - zero chance of corrupted JSON)
function atomicWriteJson(filePath: string, data: any) {
  const tempFile = `${filePath}.tmp.${Date.now()}`;
  fs.writeFile(tempFile, JSON.stringify(data, null, 2), "utf8", (err) => {
    if (err) {
      console.warn(`[Atomic Write Error] ${tempFile}:`, err.message);
      return;
    }
    fs.rename(tempFile, filePath, (renameErr) => {
      if (renameErr) {
        try {
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch {}
      }
    });
  });
}

export function saveLocalUsersDB() {
  if (inMemoryUsers) atomicWriteJson(USERS_DB_FILE, inMemoryUsers);
}

export function saveLocalTgDB() {
  if (inMemoryTgAccounts) atomicWriteJson(TG_DB_FILE, inMemoryTgAccounts);
}

// 2. BACKGROUND NON-BLOCKING FIREBASE SYNC (Zero latency for Telegram bot)
export function syncFirebaseUsers(usersToSync?: BotUser[]) {
  if (!firestoreDb) return;
  const list = usersToSync || inMemoryUsers || [];
  (async () => {
    try {
      const batch = firestoreDb!.batch();
      for (const u of list) {
        const ref = firestoreDb!.collection("users").doc(String(u.chatId));
        batch.set(ref, {
          chatId: u.chatId,
          username: u.username || "",
          name: u.name || "",
          firstSeen: u.firstSeen,
          lastActive: u.lastActive,
          isPremium: !!u.isPremium,
          package: u.package || "Free",
          checksCount: u.checksCount || 0,
          balanceBdt: typeof u.balanceBdt === "number" ? u.balanceBdt : 125,
          balanceUsd: typeof u.balanceUsd === "number" ? u.balanceUsd : 1,
          apiKey: u.apiKey || `dz_live_${u.chatId}`,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
      await batch.commit();
    } catch (err: any) {
      console.warn("[Firebase Save Error - Users]:", err?.message || err);
    }
  })();
}

export function syncFirebaseTgAccount(acc: SavedTgAccount) {
  if (!firestoreDb) return;
  firestoreDb.collection("tg_accounts").doc(String(acc.phone)).set({
    phone: acc.phone,
    name: acc.name || "",
    username: acc.username || "",
    session: acc.session || "",
    apiId: acc.apiId || TG_API_ID,
    apiHash: acc.apiHash || TG_API_HASH,
    status: acc.status || "connected",
    linkedAt: acc.linkedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, { merge: true }).catch(err => console.warn("[Firebase Save Error - TG]:", err?.message || err));
}

export function deleteFirebaseTgAccount(phone: string) {
  if (!firestoreDb) return;
  firestoreDb.collection("tg_accounts").doc(String(phone)).delete().catch(err => console.warn("[Firebase Delete Error - TG]:", err?.message || err));
}

export function syncFirebaseSettings() {
  if (!firestoreDb) return;
  firestoreDb.collection("settings").doc("bot_config").set(inMemorySettings, { merge: true })
    .catch(err => console.warn("[Firebase Save Error - Config]:", err?.message || err));
}

// 🌟 3. MAIN SAVE FUNCTION (Atomic local write + background Firebase sync)
export function saveDB() {
  saveLocalUsersDB();
  saveLocalTgDB();
  syncFirebaseUsers();
  syncFirebaseSettings();
}

// 4. DATABASE LOAD FUNCTION (Runs once on boot: Loads local DB first, then syncs missing from Firestore)
export async function loadDB() {
  let loadedUsersFromLocal = false;
  if (fs.existsSync(USERS_DB_FILE)) {
    try {
      const raw = fs.readFileSync(USERS_DB_FILE, "utf8");
      inMemoryUsers = JSON.parse(raw);
      if (Array.isArray(inMemoryUsers) && inMemoryUsers.length > 0) {
        loadedUsersFromLocal = true;
      }
      console.log(`✅ Local Users DB Loaded Successfully! (${inMemoryUsers?.length || 0} users)`);
    } catch (err: any) {
      console.warn("❌ Local Users DB Load Error:", err.message);
    }
  }

  let loadedTgFromLocal = false;
  if (fs.existsSync(TG_DB_FILE)) {
    try {
      const raw = fs.readFileSync(TG_DB_FILE, "utf8");
      inMemoryTgAccounts = JSON.parse(raw);
      if (Array.isArray(inMemoryTgAccounts) && inMemoryTgAccounts.length > 0) {
        loadedTgFromLocal = true;
      }
      console.log(`✅ Local TG DB Loaded Successfully! (${inMemoryTgAccounts?.length || 0} accounts)`);
    } catch (err: any) {
      console.warn("❌ Local TG DB Load Error:", err.message);
    }
  }

  if (!inMemoryUsers) inMemoryUsers = [];
  if (!inMemoryTgAccounts) inMemoryTgAccounts = [];

  // Guarantee Admin user is in RAM
  if (!inMemoryUsers.some(u => String(u.chatId) === ADMIN_CHAT_ID)) {
    inMemoryUsers.push({
      chatId: Number(ADMIN_CHAT_ID),
      username: "@Admin",
      name: "System Administrator",
      firstSeen: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      isPremium: true,
      package: "Enterprise API",
      grantedAt: new Date().toISOString(),
      checksCount: 0,
      balanceBdt: 999999,
      balanceUsd: 9999,
      apiKey: `dz_admin_${ADMIN_CHAT_ID}`
    });
    saveLocalUsersDB();
  }

  // Auto-connect to Firebase Firestore if key file exists
  if (!firestoreDb && fs.existsSync(FIREBASE_KEY_FILE)) {
    try {
      const rawKey = fs.readFileSync(FIREBASE_KEY_FILE, "utf-8");
      const parsedKey = JSON.parse(rawKey);
      if (parsedKey.project_id && (parsedKey.private_key || parsedKey.client_email)) {
        if (getApps().length === 0) {
          initializeApp({ credential: cert(parsedKey) });
        }
        firestoreDb = getFirestore();
        console.log(`[Firebase Firestore] Connected to project: ${parsedKey.project_id}`);
      }
    } catch (e: any) {
      console.warn("[Firebase Firestore] Auto-connection warning:", e?.message || e);
    }
  }

  // If Firebase Firestore is connected, check for missing data (0 ongoing cost, run once on boot)
  if (firestoreDb) {
    try {
      const docRef = firestoreDb.collection("settings").doc("bot_config");
      const doc = await docRef.get();
      if (doc.exists) {
        inMemorySettings = { ...inMemorySettings, ...doc.data() };
        console.log("✅ Config Synced with Firestore!");
      } else {
        await docRef.set(inMemorySettings, { merge: true });
        console.log("✅ Firestore Config Initialized!");
      }

      // If local users was empty on fresh VPS, pull from Firestore
      if (!loadedUsersFromLocal) {
        const usersSnap = await firestoreDb.collection("users").get();
        if (!usersSnap.empty) {
          const restored: BotUser[] = [];
          usersSnap.forEach(d => restored.push(d.data() as BotUser));
          if (restored.length > 0) {
            inMemoryUsers = restored;
            saveLocalUsersDB();
            console.log(`✅ Restored ${restored.length} users from Firestore to Local DB!`);
          }
        }
      }

      // If local TG accounts was empty, pull from Firestore
      if (!loadedTgFromLocal) {
        const tgSnap = await firestoreDb.collection("tg_accounts").get();
        if (!tgSnap.empty) {
          const restoredTg: SavedTgAccount[] = [];
          tgSnap.forEach(d => restoredTg.push(d.data() as SavedTgAccount));
          if (restoredTg.length > 0) {
            inMemoryTgAccounts = restoredTg;
            saveLocalTgDB();
            console.log(`✅ Restored ${restoredTg.length} TG accounts from Firestore to Local DB!`);
          }
        }
      }
    } catch (err: any) {
      console.warn("❌ Firebase Startup Sync Warning:", err.message);
    }
  }
}

// Auto-run loadDB on initialization
loadDB().catch(e => console.warn("[loadDB] Error on startup:", e));

export async function syncAllDataToFirestore(): Promise<{ usersCount: number; tgCount: number }> {
  if (!firestoreDb) return { usersCount: 0, tgCount: 0 };
  syncFirebaseUsers();
  const tgAccounts = getSavedTgAccountsList();
  for (const acc of tgAccounts) {
    syncFirebaseTgAccount(acc);
  }
  syncFirebaseSettings();
  const users = getBotUsersList();
  return { usersCount: users.length, tgCount: tgAccounts.length };
}

export async function initFirebaseWithServiceAccount(serviceAccountObj: any): Promise<{ success: boolean; projectId?: string; clientEmail?: string; error?: string }> {
  try {
    if (!serviceAccountObj || !serviceAccountObj.project_id) {
      return { success: false, error: "The provided JSON does not contain project_id." };
    }

    fs.writeFileSync(FIREBASE_KEY_FILE, JSON.stringify(serviceAccountObj, null, 2), "utf-8");

    if (getApps().length > 0) {
      try {
        await deleteApp(getApp());
      } catch {}
    }

    initializeApp({
      credential: cert(serviceAccountObj)
    });
    firestoreDb = getFirestore();

    await syncAllDataToFirestore();

    return {
      success: true,
      projectId: serviceAccountObj.project_id,
      clientEmail: serviceAccountObj.client_email || "service-account"
    };
  } catch (err: any) {
    console.error("[Firebase Firestore] Init error:", err);
    return { success: false, error: err.message || String(err) };
  }
}

export function getBotUsersList(): BotUser[] {
  if (inMemoryUsers) return inMemoryUsers;
  if (!fs.existsSync(USERS_DB_FILE)) {
    inMemoryUsers = [];
    return [];
  }
  try {
    const data = fs.readFileSync(USERS_DB_FILE, "utf-8");
    inMemoryUsers = JSON.parse(data);
    return inMemoryUsers || [];
  } catch (e) {
    inMemoryUsers = [];
    return [];
  }
}

export function saveBotUsersList(users: BotUser[]) {
  inMemoryUsers = users;
  saveLocalUsersDB();
  syncFirebaseUsers(users);
}

export function trackBotUser(chatId: number, fromObj?: any): BotUser {
  const users = getBotUsersList();
  const existingIdx = users.findIndex(u => u.chatId === chatId);
  const now = new Date().toISOString();
  const rawUsername = fromObj?.username ? `@${fromObj.username}` : "";
  const firstName = fromObj?.first_name || "";
  const lastName = fromObj?.last_name || "";
  const composedName = `${firstName} ${lastName}`.trim();
  const isAdmin = String(chatId) === ADMIN_CHAT_ID;

  if (existingIdx > -1) {
    users[existingIdx].lastActive = now;
    if (rawUsername) users[existingIdx].username = rawUsername;
    if (composedName) users[existingIdx].name = composedName;
    if (isAdmin) {
      users[existingIdx].isPremium = true;
      users[existingIdx].package = "Enterprise API";
    }
    saveBotUsersList(users);
    return users[existingIdx];
  } else {
    const newUser: BotUser = {
      chatId,
      username: rawUsername || "Not Set",
      name: composedName || (isAdmin ? "System Administrator" : `Telegram User ${chatId}`),
      firstSeen: now,
      lastActive: now,
      isPremium: isAdmin,
      package: isAdmin ? "Enterprise API" : "Free",
      grantedAt: isAdmin ? now : undefined,
      checksCount: 0
    };
    users.push(newUser);
    saveBotUsersList(users);
    return newUser;
  }
}

export function setBotUserPackage(
  targetChatId: number, 
  isPremium: boolean, 
  packageName: "Free" | "Premium API" | "Enterprise API" = "Premium API"
): BotUser {
  const users = getBotUsersList();
  let user = users.find(u => u.chatId === targetChatId);
  const now = new Date().toISOString();

  if (user) {
    user.isPremium = isPremium;
    user.package = packageName;
    user.grantedAt = isPremium ? now : undefined;
    user.lastActive = now;
  } else {
    user = {
      chatId: targetChatId,
      username: "Not Set",
      name: `User ${targetChatId}`,
      firstSeen: now,
      lastActive: now,
      isPremium,
      package: packageName,
      grantedAt: isPremium ? now : undefined,
      checksCount: 0
    };
    users.push(user);
  }
  saveBotUsersList(users);
  return user;
}

export function getUserStats() {
  const users = getBotUsersList();
  const totalUsers = users.length;
  const premiumUsers = users.filter(u => u.isPremium).length;
  const freeUsers = Math.max(0, totalUsers - premiumUsers);
  return { totalUsers, premiumUsers, freeUsers };
}

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
      },
      {
        text: "CHECK TG NUMBER",
        icon_custom_emoji_id: "5429136513831057777",
        style: "success"
      }
    ],
    [
      {
        text: "BUY WS AND TG API",
        icon_custom_emoji_id: "5170692113834181832",
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

export const BACK_MENU_KB = {
  keyboard: [
    [
      {
        text: "BACK",
        icon_custom_emoji_id: "5267490665117275176",
        style: "danger"
      }
    ]
  ],
  resize_keyboard: true
};

// Track active menu mode per user chatId ("connect_ws" | "check_ws" | "check_tg")
const userMenuMode = new Map<string, "connect_ws" | "check_ws" | "check_tg">();
// Track active admin broadcast mode
const adminBroadcastActive = new Set<string>();
// Track active admin firebase upload mode
const adminFirebaseUploadActive = new Set<string>();

function getUserMenuMode(chatId: number | string): "connect_ws" | "check_ws" | "check_tg" | undefined {
  const key = String(chatId);
  if (userMenuMode.has(key)) {
    return userMenuMode.get(key);
  }
  const users = getBotUsersList();
  const u = users.find(item => String(item.chatId) === key);
  if (u?.menuMode) {
    userMenuMode.set(key, u.menuMode);
    return u.menuMode;
  }
  return undefined;
}

function setUserMenuMode(chatId: number | string, mode: "connect_ws" | "check_ws" | "check_tg" | null) {
  const key = String(chatId);
  if (mode) {
    userMenuMode.set(key, mode);
  } else {
    userMenuMode.delete(key);
  }
  const users = getBotUsersList();
  const idx = users.findIndex(item => String(item.chatId) === key);
  if (idx > -1) {
    users[idx].menuMode = mode;
    saveBotUsersList(users);
  }
}

// --- ADMIN INLINE KEYBOARDS ---
export const ADMIN_PANEL_KEYBOARD = {
  inline_keyboard: [
    [
      {
        text: "𝗣𝗔𝗬𝗠𝗘𝗡𝗧 𝗠𝗔𝗡𝗔𝗚𝗘𝗠𝗘𝗡𝗧",
        icon_custom_emoji_id: "5429452906891880671",
        callback_data: "payment_management_menu",
        style: "primary"
      }
    ],
    [
      {
        text: "𝗔𝗣𝗜 𝗠𝗔𝗡𝗔𝗚𝗘𝗠𝗘𝗡𝗧",
        icon_custom_emoji_id: "5170692113834181832",
        callback_data: "api_management_menu",
        style: "success"
      },
      {
        text: "𝗙𝗢𝗥𝗖𝗘 𝗝𝗢𝗜𝗡",
        icon_custom_emoji_id: "5429136513831057777",
        callback_data: "force_join_menu",
        style: "success"
      }
    ],
    [
      {
        text: "𝗕𝗥𝗢𝗔𝗗𝗖𝗔𝗦𝗧",
        icon_custom_emoji_id: "5789428375261023681",
        callback_data: "broadcast_menu",
        style: "primary"
      }
    ],
    [
      {
        text: "𝗕𝗢𝗧 𝗖𝗢𝗡𝗧𝗥𝗢𝗟",
        icon_custom_emoji_id: "5857154735299104907",
        callback_data: "bot_control_menu",
        style: "primary"
      }
    ],
    [
      {
        text: "𝗦𝗘𝗧𝗧𝗜𝗡𝗚𝗦",
        icon_custom_emoji_id: "5420155432272438703",
        callback_data: "system_settings",
        style: "primary"
      }
    ],
    [
      {
        text: "𝗨𝗣𝗟𝗢𝗔𝗗 𝗙𝗜𝗥𝗘𝗕𝗔𝗦𝗘 𝗝𝗦𝗢𝗡",
        icon_custom_emoji_id: "5257969839313526622",
        callback_data: "upload_firebase_json_menu",
        style: "primary"
      }
    ]
  ]
};

export const FIREBASE_UPLOAD_KEYBOARD = {
  inline_keyboard: [
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

export const BROADCAST_CANCEL_KEYBOARD = {
  inline_keyboard: [
    [
      {
        text: "Back",
        icon_custom_emoji_id: "5267490665117275176",
        callback_data: "broadcast_cancel",
        style: "danger"
      }
    ]
  ]
};

export const BOT_CONTROL_KEYBOARD = {
  inline_keyboard: [
    [
      {
        text: "𝗠𝗔𝗡𝗔𝗚𝗘 𝗥𝗘𝗙𝗘𝗥",
        icon_custom_emoji_id: "5325926401008746697",
        callback_data: "manage_refer_menu",
        style: "primary"
      }
    ],
    [
      {
        text: "𝗠𝗔𝗡𝗔𝗚𝗘 𝗦𝗨𝗣𝗣𝗢𝗥𝗧",
        icon_custom_emoji_id: "5440896830072179569",
        callback_data: "manage_support_menu",
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

export const PAYMENT_MANAGEMENT_KEYBOARD = {
  inline_keyboard: [
    [
      {
        text: "𝗗𝗘𝗣𝗢𝗦𝗜𝗧 𝗠𝗘𝗧𝗛𝗢𝗗",
        icon_custom_emoji_id: "5440896830072179569",
        callback_data: "deposit_method_menu",
        style: "primary"
      }
    ],
    [
      {
        text: "𝗗𝗢𝗟𝗟𝗔𝗥 𝗥𝗔𝗧𝗘",
        icon_custom_emoji_id: "5348469219761626211",
        callback_data: "dollar_rate_menu",
        style: "success"
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
        callback_data: "manage_package_menu",
        style: "primary"
      }
    ],
    [
      {
        text: "𝗧𝗚 𝗖𝗛𝗘𝗖𝗞𝗘𝗥",
        icon_custom_emoji_id: "5429136513831057777",
        callback_data: "tg_checker_menu",
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

export function getTgCheckerMenuKeyboard() {
  const accounts = getSavedTgAccountsList();
  const rows: any[] = [
    [
      {
        text: "𝗔𝗗𝗗 𝗧𝗘𝗟𝗘𝗚𝗥𝗔𝗠 𝗔𝗖𝗖𝗢𝗨𝗡𝗧",
        icon_custom_emoji_id: "5420323438508155202",
        callback_data: "add_tg_account_start",
        style: "primary"
      }
    ]
  ];

  for (const acc of accounts) {
    rows.push([
      {
        text: `+${acc.phone}`,
        icon_custom_emoji_id: "5429136513831057777",
        callback_data: `tg_acc_view_${acc.phone}`,
        style: "success"
      }
    ]);
  }

  rows.push([
    {
      text: "Back",
      icon_custom_emoji_id: "5267490665117275176",
      callback_data: "premium_management_menu",
      style: "danger"
    }
  ]);

  return { inline_keyboard: rows };
}

export function getTgAccountDetailKeyboard(phone: string) {
  return {
    inline_keyboard: [
      [
        {
          text: "Edit Api Id",
          icon_custom_emoji_id: "5395444784611480792",
          callback_data: `tg_acc_edit_id_${phone}`,
          style: "primary"
        },
        {
          text: "Edit Api Hash",
          icon_custom_emoji_id: "5197288647275071607",
          callback_data: `tg_acc_edit_hash_${phone}`,
          style: "primary"
        }
      ],
      [
        {
          text: "Delete Season",
          icon_custom_emoji_id: "5796499549287615611",
          callback_data: `tg_acc_del_${phone}`,
          style: "danger"
        }
      ],
      [
        {
          text: "Back",
          icon_custom_emoji_id: "5267490665117275176",
          callback_data: "tg_checker_menu",
          style: "danger"
        }
      ]
    ]
  };
}

export function getTgCheckerDashboardText(): string {
  const accounts = getSavedTgAccountsList();
  let text =
    `📱 <b>TELEGRAM CHECKER ACCOUNT MANAGEMENT</b>\n\n` +
    `🌐 Connect your Telegram account using <b>API ID</b> and <b>API Hash</b> from <a href="https://my.telegram.org">http://my.telegram.org</a> to enable high-speed Telegram number checking.\n\n` +
    `📊 <b>Connected Sessions (${accounts.length}):</b>\n`;

  if (accounts.length === 0) {
    text += `▫️ <i>No Telegram accounts logged in yet. Click <b>ADD TELEGRAM ACCOUNT</b> below to log in.</i>\n`;
  } else {
    accounts.forEach((acc, idx) => {
      const active = activeTgSessions.get(acc.phone);
      const isOnline = active && active.client && active.client.connected;
      const statusBadge = isOnline ? "🟢 Active Session" : "🟡 Saved Session";
      const uname = acc.username ? ` (@${acc.username.replace(/^@/, "")})` : "";
      text += `${idx + 1}. <b>+${acc.phone}</b> — ${acc.name || "User"}${uname}\n   ▫️ API ID: <code>${acc.apiId || TG_API_ID}</code> | ${statusBadge}\n`;
    });
    text += `\n💡 <b>Quick Check Active:</b> Send any phone number (e.g. <code>8801712345678</code>) or upload a <code>.txt</code>/<code>.csv</code> file right now in chat to check if a Telegram account is open!\n`;
    text += `\n👇 <i>Or click on any phone number button below to manage its API ID, API Hash, or Delete Session:</i>`;
  }

  return text;
}

export function getTgAccountDetailText(phone: string): string {
  const accounts = getSavedTgAccountsList();
  const acc = accounts.find((a) => a.phone === phone);
  if (!acc) {
    return `⚠️ <b>Account +${phone} not found in database.</b>`;
  }
  const active = activeTgSessions.get(acc.phone);
  const isOnline = active && active.client && active.client.connected;
  const useApiId = acc.apiId || TG_API_ID;
  const useApiHash = acc.apiHash || TG_API_HASH;

  return (
    `📱 <b>TELEGRAM ACCOUNT DETAILS</b>\n\n` +
    `▫️ <b>Phone Number:</b> <code>+${acc.phone}</code>\n` +
    `▫️ <b>Account Name:</b> ${acc.name || "Telegram User"}\n` +
    `▫️ <b>Username:</b> ${acc.username ? `@${acc.username.replace(/^@/, "")}` : "Not Set"}\n` +
    `▫️ <b>API ID:</b> <code>${useApiId}</code>\n` +
    `▫️ <b>API Hash:</b> <code>${useApiHash}</code>\n` +
    `▫️ <b>Session Status:</b> ${isOnline ? "🟢 Connected & Ready" : "🟡 Saved (Auto-Reconnect)"}\n` +
    `▫️ <b>Linked At:</b> <code>${new Date(acc.linkedAt).toLocaleString()}</code>\n\n` +
    `💡 <b>Ready to Check:</b> Send any phone number(s) in chat to check Telegram status using this gateway, or select an option below:`
  );
}

export const MANAGE_PACKAGE_KEYBOARD = {
  inline_keyboard: [
    [
      {
        text: "𝗥𝗘𝗙𝗥𝗘𝗦𝗛 𝗦𝗧𝗔𝗧𝗦",
        icon_custom_emoji_id: "5429136513831057777",
        callback_data: "manage_package_menu",
        style: "primary"
      }
    ],
    [
      {
        text: "Back",
        icon_custom_emoji_id: "5267490665117275176",
        callback_data: "premium_management_menu",
        style: "danger"
      }
    ]
  ]
};

export const BUY_API_INLINE_KEYBOARD = {
  inline_keyboard: [
    [
      {
        text: "DOWNLOAD API DOCUMENTS",
        icon_custom_emoji_id: "5352721946054268944",
        callback_data: "download_api_docs",
        style: "success"
      }
    ]
  ]
};

export const MY_PROFILE_INLINE_KEYBOARD = {
  inline_keyboard: [
    [
      {
        text: "MY API",
        icon_custom_emoji_id: "5170692113834181832",
        callback_data: "profile_my_api",
        style: "primary"
      },
      {
        text: "ADD MONEY",
        icon_custom_emoji_id: "5440896830072179569",
        callback_data: "profile_add_money",
        style: "success"
      }
    ],
    [
      {
        text: "INVITE FRIEND",
        icon_custom_emoji_id: "5325926401008746697",
        callback_data: "profile_invite_friend",
        style: "primary"
      }
    ]
  ]
};

function generateApiDocumentationContent(): string {
  return `================================================================================
       WHATSAPP & TELEGRAM NUMBER CHECKER API - INTEGRATION GUIDE
================================================================================
Generated Date: ${new Date().toISOString()}
Official API Base URL: https://dxazone-checker.125.zero-bot.org
Protocol: HTTPS / REST API
Output Format: JSON (application/json)
Authentication: Header "Authorization: Bearer <YOUR_API_KEY>"

================================================================================
                 PART 1: ENGLISH API DOCUMENTATION & GUIDE
================================================================================

--------------------------------------------------------------------------------
1. OVERVIEW & MULTI-USER ISOLATED ARCHITECTURE
--------------------------------------------------------------------------------
This enterprise REST API provides high-speed phone number validation and presence 
checking across WhatsApp Web servers and Telegram networks, with built-in 
Multi-User & Per-Number Isolation:

- Multi-User Bot Ready: When you integrate this API into your own Telegram bot 
  or web app with multiple users, each end-user (identified by "userId") gets 
  their own isolated database record and linked WhatsApp session(s).
- Connect WhatsApp via API: Any user can link their own WhatsApp number directly 
  through the API and receive the 8-digit pairing code in JSON.
- Check with Specific WhatsApp Number: Every single or bulk check request can 
  specify "senderPhone" (e.g. "8801700000000") and/or "userId" so that checks 
  run exclusively through that specific user's connected WhatsApp account.

--------------------------------------------------------------------------------
2. BASE URL & AUTHENTICATION
--------------------------------------------------------------------------------
Official API Base URL:
- Production Server: https://dxazone-checker.125.zero-bot.org

Include your API authorization token in the header (or "apiKey" in query/body):
Authorization: Bearer <YOUR_API_KEY>

--------------------------------------------------------------------------------
3. ENDPOINT 1: CONNECT / ADD WHATSAPP NUMBER (GET 8-DIGIT PAIRING CODE)
--------------------------------------------------------------------------------
Method: POST (or GET)
Path: /api/connect-whatsapp
Description: Initiates a WhatsApp session for a user's number, links it to their 
isolated "userId" database, and returns the 8-digit pairing code.

POST Request Body (JSON):
{
  "phone": "8801700000000",
  "userId": "55667788",
  "name": "User_Altima"
}

(Or GET: https://dxazone-checker.125.zero-bot.org/api/connect-whatsapp?phone=8801700000000&userId=55667788)

Response Example (Status: 200 OK):
{
  "success": true,
  "status": "pairing-code-ready",
  "phone": "8801700000000",
  "userId": "55667788",
  "pairingCode": "ABCD-1234",
  "rawCode": "ABCD1234",
  "instructions": "Open WhatsApp -> Linked Devices -> Link with phone number instead and enter the 8-digit code."
}

--------------------------------------------------------------------------------
4. ENDPOINT 2: CHECK USER STATUS & LINKED WHATSAPP ACCOUNTS
--------------------------------------------------------------------------------
Method: GET
Path: /api/user-status
Query Parameters:
- userId (string, optional): The user's ID in your bot/system (e.g. 55667788)
- senderPhone (string, optional): Specific WhatsApp number to check status for

Request Example:
GET https://dxazone-checker.125.zero-bot.org/api/user-status?userId=55667788&senderPhone=8801700000000

Response Example (Status: 200 OK):
{
  "success": true,
  "userId": "55667788",
  "connected": true,
  "activeSenderPhone": "8801700000000",
  "wsConnectedCount": 1,
  "accounts": [
    {
      "phone": "8801700000000",
      "name": "WhatsApp User",
      "userId": "55667788",
      "status": "connected",
      "linkedAt": "${new Date().toISOString()}"
    }
  ]
}

--------------------------------------------------------------------------------
5. ENDPOINT 3: CHECK SINGLE WHATSAPP NUMBER (BY SPECIFIC NUMBER / USER)
--------------------------------------------------------------------------------
Method: GET or POST
Path: /api/check-phone
Parameters (Query or JSON Body):
- phone (string, required): Target phone number to check (e.g. 8801712345678)
- senderPhone (string, optional): Specific linked WhatsApp number to check from (e.g. 8801700000000)
- userId (string, optional): Isolated user ID (automatically uses this user's linked WhatsApp)

Request Example:
GET https://dxazone-checker.125.zero-bot.org/api/check-phone?phone=8801712345678&senderPhone=8801700000000&userId=55667788

Response Example (Status: 200 OK):
{
  "success": true,
  "phone": "8801712345678",
  "exists": true,
  "status": "BAD",
  "jid": "8801712345678@s.whatsapp.net",
  "checkedBy": "8801700000000",
  "userId": "55667788",
  "whatsapp": {
    "exists": true,
    "jid": "8801712345678@s.whatsapp.net"
  },
  "checkedAt": "${new Date().toISOString()}"
}
(Note: "exists": true means WhatsApp account already exists = BAD; "exists": false means fresh/unregistered = GOOD)

--------------------------------------------------------------------------------
6. ENDPOINT 4: BULK BATCH WHATSAPP CHECKER (BY SPECIFIC NUMBER / USER)
--------------------------------------------------------------------------------
Method: POST
Path: /api/check-batch (or /api/check-phone-bulk)
Headers:
  Content-Type: application/json
  Authorization: Bearer YOUR_API_KEY

Request Body:
{
  "senderPhone": "8801700000000",
  "userId": "55667788",
  "numbers": [
    "8801712345678",
    "8801812345678",
    "923300000000"
  ]
}

Response Example (Status: 200 OK):
{
  "success": true,
  "total": 3,
  "checkedBy": "8801700000000",
  "userId": "55667788",
  "goodCount": 1,
  "badCount": 2,
  "activeCount": 2,
  "inactiveCount": 1,
  "good": [
    "8801812345678"
  ],
  "bad": [
    "8801712345678",
    "923300000000"
  ],
  "active": [
    "8801712345678",
    "923300000000"
  ],
  "inactive": [
    "8801812345678"
  ],
  "timestamp": "${new Date().toISOString()}"
}

--------------------------------------------------------------------------------
7. ENDPOINT 5: DISCONNECT / LOGOUT USER WHATSAPP NUMBER
--------------------------------------------------------------------------------
Method: POST
Path: /api/disconnect-whatsapp (or /api/delete-account)
Request Body:
{
  "phone": "8801700000000",
  "userId": "55667788"
}

--------------------------------------------------------------------------------
8. CODE EXAMPLES (MULTI-USER BOT INTEGRATION)
--------------------------------------------------------------------------------

A. cURL (Link WhatsApp & Check Batch with Specific Number):
--------------------------------------------------
# 1. Get 8-Digit Pairing Code for a User:
curl -X POST "https://dxazone-checker.125.zero-bot.org/api/connect-whatsapp" \\
  -H "Content-Type: application/json" \\
  -d '{"phone": "8801700000000", "userId": "55667788"}'

# 2. Check Numbers Using That Specific Linked WhatsApp Number:
curl -X POST "https://dxazone-checker.125.zero-bot.org/api/check-batch" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{"senderPhone": "8801700000000", "userId": "55667788", "numbers": ["8801712345678", "8801812345678"]}'

B. Python (requests - Multi-User Bot):
--------------------------------------------------
import requests

BASE_URL = "https://dxazone-checker.125.zero-bot.org"
HEADERS = {"Content-Type": "application/json", "Authorization": "Bearer YOUR_API_KEY"}

# Step 1: Connect a user's WhatsApp number and get 8-digit pairing code
pair_res = requests.post(f"{BASE_URL}/api/connect-whatsapp", json={
    "phone": "8801700000000",
    "userId": "55667788"
}, headers=HEADERS).json()
print("Pairing Code:", pair_res.get("pairingCode"))

# Step 2: Check numbers using that user's specific WhatsApp number
check_res = requests.post(f"{BASE_URL}/api/check-batch", json={
    "senderPhone": "8801700000000",
    "userId": "55667788",
    "numbers": ["8801712345678", "8801812345678"]
}, headers=HEADERS).json()
print("GOOD (Fresh):", check_res.get("good"))
print("BAD (Registered):", check_res.get("bad"))

C. Node.js (JavaScript / TypeScript):
--------------------------------------------------
const BASE_URL = "https://dxazone-checker.125.zero-bot.org";

// Connect WhatsApp for userId "55667788"
const pairResp = await fetch(BASE_URL + "/api/connect-whatsapp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phone: "8801700000000", userId: "55667788" })
});
const pairData = await pairResp.json();
console.log("8-Digit Pairing Code:", pairData.pairingCode);

// Check numbers using senderPhone "8801700000000"
const checkResp = await fetch(BASE_URL + "/api/check-batch", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_API_KEY"
  },
  body: JSON.stringify({
    senderPhone: "8801700000000",
    userId: "55667788",
    numbers: ["8801712345678", "8801812345678"]
  })
});
const result = await checkResp.json();
console.log("Checked by:", result.checkedBy, "GOOD:", result.good, "BAD:", result.bad);


================================================================================
             PART 2: সম্পূর্ণ বাংলা ডকুমেন্টেশন ও ব্যবহারের নির্দেশিকা
================================================================================

--------------------------------------------------------------------------------
১. পরিচিতি ও মাল্টি-ইউজার আইসোলেটেড সিস্টেম (Multi-User Isolated API)
--------------------------------------------------------------------------------
এই এন্টারপ্রাইজ REST API এর মাধ্যমে আপনি আপনার নিজের যেকোনো টেলিগ্রাম বট, 
ওয়েবসাইট বা সফটওয়্যারে হোয়াটসঅ্যাপ চেকার যুক্ত করতে পারবেন।

বিশেষ সুবিধাসমূহ:
- আলাদা ইউজার ডাটাবেজ (Per-User Isolated Database): আপনার বটে যদি ১০০ জন 
  ইউজার থাকে, তবে প্রতিটি ইউজার ("userId") API এর মাধ্যমে নিজের হোয়াটসঅ্যাপ 
  নাম্বার অ্যাড (Link) করতে পারবে এবং তার জন্য আলাদা ডাটাবেজ তৈরি হবে।
- নির্দিষ্ট নাম্বার দিয়ে চেকিং (Check by Specific Number): "senderPhone" এবং 
  "userId" প্যারামিটার ব্যবহার করে নির্দিষ্ট যে নাম্বারটি কানেক্ট করা হয়েছে, 
  শুধুমাত্র সেই নাম্বারটি দিয়েই সিঙ্গেল বা বাল্ক হোয়াটসঅ্যাপ নাম্বার চেক করা যাবে।
- এক ইউজারের কানেক্ট করা হোয়াটসঅ্যাপ অন্য কোনো ইউজার ব্যবহার করতে পারবে না।

--------------------------------------------------------------------------------
২. অফিশিয়াল এপিআই লিংক ও অথেনটিকেশন (Base URL & Authentication)
--------------------------------------------------------------------------------
অফিশিয়াল এপিআই বেস ইউআরএল (Base URL):
https://dxazone-checker.125.zero-bot.org

প্রতিটি রিকোয়েস্টে হেডার (Header)-এ আপনার API Key প্রদান করুন:
Authorization: Bearer <আপনার_এপিআই_কি>

--------------------------------------------------------------------------------
৩. এন্ডপয়েন্ট ১: এপিআই দিয়ে হোয়াটসঅ্যাপ অ্যাড ও ৮-ডিজিট কোড নেওয়া
--------------------------------------------------------------------------------
মেথড: POST অথবা GET
পাথ: /api/connect-whatsapp
কাজ: যেকোনো ইউজার তার হোয়াটসঅ্যাপ নাম্বার পাঠালে ৮-ডিজিটের পেয়ারিং কোড রিটার্ন করবে।

রিকোয়েস্ট বডি (JSON Body):
{
  "phone": "8801700000000",
  "userId": "55667788",
  "name": "Altima"
}

অথবা সরাসরি লিংক (GET):
https://dxazone-checker.125.zero-bot.org/api/connect-whatsapp?phone=8801700000000&userId=55667788

রেসপন্স উদাহরণ (200 OK):
{
  "success": true,
  "status": "pairing-code-ready",
  "phone": "8801700000000",
  "userId": "55667788",
  "pairingCode": "ABCD-1234",
  "rawCode": "ABCD1234",
  "instructions": "Open WhatsApp -> Linked Devices -> Link with phone number instead and enter the 8-digit code."
}

--------------------------------------------------------------------------------
৪. এন্ডপয়েন্ট ২: ইউজারের হোয়াটসঅ্যাপ কানেকশন স্ট্যাটাস ও ডাটাবেজ চেক
--------------------------------------------------------------------------------
মেথড: GET
পাথ: /api/user-status
প্যারামিটার:
- userId: আপনার বটের ওই ইউজারের আইডি (যেমন: 55667788)
- senderPhone (ঐচ্ছিক): নির্দিষ্ট হোয়াটসঅ্যাপ নাম্বার

রিকোয়েস্ট উদাহরণ:
GET https://dxazone-checker.125.zero-bot.org/api/user-status?userId=55667788

--------------------------------------------------------------------------------
৫. এন্ডপয়েন্ট ৩: নির্দিষ্ট নাম্বার দিয়ে সিঙ্গেল নাম্বার চেক (/api/check-phone)
--------------------------------------------------------------------------------
মেথড: GET অথবা POST
পাথ: /api/check-phone
প্যারামিটার:
- phone (আবশ্যক): যে নাম্বারটি চেক করতে চান (যেমন: 8801712345678)
- senderPhone (ঐচ্ছিক/প্রস্তাবিত): যে নির্দিষ্ট কানেক্টেড নাম্বার দিয়ে চেক করবেন (যেমন: 8801700000000)
- userId (ঐচ্ছিক/প্রস্তাবিত): ইউজারের আইডি (যার কানেক্টেড নাম্বার দিয়ে চেক হবে)

রিকোয়েস্ট উদাহরণ:
GET https://dxazone-checker.125.zero-bot.org/api/check-phone?phone=8801712345678&senderPhone=8801700000000&userId=55667788

রেসপন্স উদাহরণ:
{
  "success": true,
  "phone": "8801712345678",
  "exists": true,
  "status": "BAD",
  "jid": "8801712345678@s.whatsapp.net",
  "checkedBy": "8801700000000",
  "userId": "55667788"
}
নোট: যদি নাম্বারে হোয়াটসঅ্যাপ খোলা থাকে তবে "exists": true ("status": "BAD") আসবে, 
আর হোয়াটসঅ্যাপ খোলা না থাকলে "exists": false ("status": "GOOD") আসবে।

--------------------------------------------------------------------------------
৬. এন্ডপয়েন্ট ৪: নির্দিষ্ট নাম্বার দিয়ে বাল্ক ব্যাচ চেক (/api/check-batch)
--------------------------------------------------------------------------------
মেথড: POST
পাথ: /api/check-batch
রিকোয়েস্ট বডি (JSON Body):
{
  "senderPhone": "8801700000000",
  "userId": "55667788",
  "numbers": [
    "8801712345678",
    "8801812345678",
    "923300000000"
  ]
}

রেসপন্স উদাহরণ (200 OK):
{
  "success": true,
  "total": 3,
  "checkedBy": "8801700000000",
  "userId": "55667788",
  "goodCount": 1,
  "badCount": 2,
  "good": ["8801812345678"],
  "bad": ["8801712345678", "923300000000"],
  "active": ["8801712345678", "923300000000"],
  "inactive": ["8801812345678"]
}

--------------------------------------------------------------------------------
৭. এন্ডপয়েন্ট ৫: হোয়াটসঅ্যাপ নাম্বার ডিসকানেক্ট বা রিমুভ করা
--------------------------------------------------------------------------------
মেথড: POST
পাথ: /api/disconnect-whatsapp
রিকোয়েস্ট বডি:
{
  "phone": "8801700000000",
  "userId": "55667788"
}

--------------------------------------------------------------------------------
৮. সহায়তা ও এন্টারপ্রাইজ লাইসেন্স ক্রয় (Support & License Upgrade)
--------------------------------------------------------------------------------
আনলিমিটেড স্পিড প্যাকেজ ও এপিআই কি ক্রয় করতে যোগাযোগ করুন:
অ্যাডমিন আইডি: 8343010638
অফিশিয়াল এপিআই সার্ভার: https://dxazone-checker.125.zero-bot.org
================================================================================
`;
}

function getManagePackageDashboardText(): string {
  const { totalUsers, premiumUsers, freeUsers } = getUserStats();
  const users = getBotUsersList();
  const premiumUsersList = users.filter(u => u.isPremium);

  let text = 
    `💎 <b>PREMIUM & API PACKAGE MANAGEMENT</b>\n\n` +
    `📊 <b>User & License Overview:</b>\n` +
    `▫️ <b>Total Users:</b> <code>${totalUsers}</code> registered\n` +
    `▫️ <b>Premium Users:</b> <code>${premiumUsers}</code> with API package 💎\n` +
    `▫️ <b>Free Tier Users:</b> <code>${freeUsers}</code> standard\n\n` +
    `👑 <b>Active Premium API Users (${premiumUsersList.length}):</b>\n`;

  if (premiumUsersList.length === 0) {
    text += `▫️ <i>No external premium users granted yet.</i>\n\n`;
  } else {
    premiumUsersList.slice(0, 10).forEach((u, i) => {
      text += `${i + 1}. <b>${u.name}</b> (${u.username})\n   ▫️ Chat ID: <code>${u.chatId}</code>\n   ▫️ Tier: <b>${u.package}</b> | Granted: ${u.grantedAt ? new Date(u.grantedAt).toLocaleDateString() : "Active"}\n`;
    });
    if (premiumUsersList.length > 10) {
      text += `   <i>...and ${premiumUsersList.length - 10} more.</i>\n`;
    }
    text += `\n`;
  }

  text += 
    `🛠 <b>Admin Commands to Manage:</b>\n` +
    `▫️ <code>/setpremium &lt;chat_id&gt;</code> - Upgrade user to Premium API Package\n` +
    `▫️ <code>/removepremium &lt;chat_id&gt;</code> - Revoke Premium & revert to Free\n` +
    `▫️ <code>/users</code> - View full detailed list of all registered users\n\n` +
    `<i>Tap Refresh below to update live counts.</i>`;

  return text;
}

function getAdminPanelDashboardText(): string {
  const wsAccounts = getSavedAccountsList();
  const tgAccounts = getSavedTgAccountsList();
  const { totalUsers, premiumUsers, freeUsers } = getUserStats();
  return (
    `<tg-emoji emoji-id="5420155432272438703">⚙️</tg-emoji> <b>ADMIN CONTROL PANEL</b>\n` +
    `————————————\n` +
    `<tg-emoji emoji-id="5325926401008746697">👥</tg-emoji> Total Users : ${totalUsers}\n` +
    `<tg-emoji emoji-id="5352838545826420397">💎</tg-emoji> Premium Users : ${premiumUsers}\n` +
    `<tg-emoji emoji-id="5429274992166609833">👤</tg-emoji> Free Users : ${freeUsers}\n` +
    `————————————\n` +
    `<tg-emoji emoji-id="5429136513831057777">🔵</tg-emoji> ACTIVE TG : ${tgAccounts.length}\n` +
    `<tg-emoji emoji-id="5429612632430654504">🟢</tg-emoji> ACTIVE WS : ${wsAccounts.length}\n` +
    `————————————`
  );
}

async function handleTelegramCallbackQuery(call: any) {
  const callId = call.id;
  const data = call.data || "";
  const fromId = call.from?.id;
  const chatId = call.message?.chat?.id || fromId;
  const msgId = call.message?.message_id;

  if (chatId) {
    trackBotUser(chatId, call.from);
  }

  // Public callback: Download API Documentation
  if (data === "download_api_docs") {
    await answerTelegramCallbackQuery(callId, "📥 Preparing API documentation file...");
    const docContent = generateApiDocumentationContent();
    await sendTelegramDocument(
      chatId,
      docContent,
      "API_DOCUMENTATION_GUIDE.txt",
      "📄 <b>API Documentation & Integration Guide</b>\n\nOfficial WhatsApp & Telegram Checker API documentation (Bilingual: English & Bengali)."
    );
    return;
  }

  // Security check: Only target admin ID 8343010638 can use admin callbacks
  const adminCallbacks = [
    "system_settings",
    "premium_management_menu",
    "admin_panel_home",
    "manage_package_menu",
    "payment_management_menu",
    "api_management_menu",
    "force_join_menu",
    "broadcast_menu",
    "broadcast_cancel",
    "upload_firebase_json_menu",
    "bot_control_menu",
    "manage_refer_menu",
    "manage_support_menu",
    "deposit_method_menu",
    "dollar_rate_menu",
    "tg_checker_menu",
    "add_tg_account_start"
  ];
  const isTgAdminAction = adminCallbacks.includes(data) || data.startsWith("tg_acc_");
  if (isTgAdminAction) {
    if (String(fromId) !== ADMIN_CHAT_ID && String(chatId) !== ADMIN_CHAT_ID) {
      await answerTelegramCallbackQuery(callId, "⛔ Access Denied: You are not an administrator of this system!", true);
      return;
    }
  }

  if (data === "system_settings") {
    adminTgWizard.delete(String(chatId));
    const text = `⚙️ <b>SYSTEM SETTINGS</b>\n\nSelect a configuration menu below:`;
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", SETTINGS_MENU_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", SETTINGS_MENU_KEYBOARD);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "premium_management_menu") {
    adminTgWizard.delete(String(chatId));
    const text = `💎 <b>PREMIUM MANAGEMENT</b>\n\nConfigure premium features and checkers below:`;
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", PREMIUM_MANAGEMENT_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", PREMIUM_MANAGEMENT_KEYBOARD);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "tg_checker_menu") {
    const existingWiz = adminTgWizard.get(String(chatId));
    if (existingWiz?.client) {
      try { existingWiz.client.disconnect(); } catch {}
    }
    adminTgWizard.delete(String(chatId));
    const text = getTgCheckerDashboardText();
    const kb = getTgCheckerMenuKeyboard();
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", kb);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", kb);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "add_tg_account_start") {
    adminTgWizard.set(String(chatId), { step: "await_api_id" });
    const text =
      `➕ <b>ADD TELEGRAM ACCOUNT (Step 1/4)</b>\n\n` +
      `🌐 Log in to <a href="https://my.telegram.org">http://my.telegram.org</a> ➔ <b>API development tools</b> to get your credentials.\n\n` +
      `🔢 Please send your <b>API ID</b> in the chat (e.g. <code>2040</code> or <code>25481920</code>):`;
    const cancelKb = {
      inline_keyboard: [
        [
          {
            text: "Back",
            icon_custom_emoji_id: "5267490665117275176",
            callback_data: "tg_checker_menu",
            style: "danger"
          }
        ]
      ]
    };
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", cancelKb);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", cancelKb);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data.startsWith("tg_acc_view_")) {
    const phone = data.replace("tg_acc_view_", "").trim();
    adminTgWizard.delete(String(chatId));
    const text = getTgAccountDetailText(phone);
    const kb = getTgAccountDetailKeyboard(phone);
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", kb);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", kb);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data.startsWith("tg_acc_edit_id_")) {
    const phone = data.replace("tg_acc_edit_id_", "").trim();
    const acc = getSavedTgAccountsList().find((a) => a.phone === phone);
    adminTgWizard.set(String(chatId), { step: "edit_api_id", targetPhone: phone });
    const text =
      `✏️ <b>EDIT API ID (+${phone})</b>\n\n` +
      `▫️ <b>Current API ID:</b> <code>${acc?.apiId || TG_API_ID}</code>\n\n` +
      `👉 Please send the new <b>API ID</b> from <a href="https://my.telegram.org">http://my.telegram.org</a> in the chat:`;
    const backKb = {
      inline_keyboard: [
        [
          {
            text: "Back",
            icon_custom_emoji_id: "5267490665117275176",
            callback_data: `tg_acc_view_${phone}`,
            style: "danger"
          }
        ]
      ]
    };
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", backKb);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", backKb);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data.startsWith("tg_acc_edit_hash_")) {
    const phone = data.replace("tg_acc_edit_hash_", "").trim();
    const acc = getSavedTgAccountsList().find((a) => a.phone === phone);
    adminTgWizard.set(String(chatId), { step: "edit_api_hash", targetPhone: phone });
    const text =
      `🔑 <b>EDIT API HASH (+${phone})</b>\n\n` +
      `▫️ <b>Current API Hash:</b> <code>${acc?.apiHash || TG_API_HASH}</code>\n\n` +
      `👉 Please send the new <b>API Hash</b> from <a href="https://my.telegram.org">http://my.telegram.org</a> in the chat:`;
    const backKb = {
      inline_keyboard: [
        [
          {
            text: "Back",
            icon_custom_emoji_id: "5267490665117275176",
            callback_data: `tg_acc_view_${phone}`,
            style: "danger"
          }
        ]
      ]
    };
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", backKb);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", backKb);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data.startsWith("tg_acc_del_")) {
    const phone = data.replace("tg_acc_del_", "").trim();
    adminTgWizard.delete(String(chatId));
    deleteTgAccountFromDb(phone);
    await answerTelegramCallbackQuery(callId, `🗑 Session for +${phone} deleted successfully!`, true);
    const text = getTgCheckerDashboardText();
    const kb = getTgCheckerMenuKeyboard();
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", kb);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", kb);
    }
    return;
  }

  if (data === "payment_management_menu") {
    const text = `💳 <b>PAYMENT MANAGEMENT</b>\n\nConfigure deposit gateways, payment methods, and dollar exchange rates below:`;
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", PAYMENT_MANAGEMENT_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", PAYMENT_MANAGEMENT_KEYBOARD);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "api_management_menu") {
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "force_join_menu") {
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "broadcast_menu") {
    adminBroadcastActive.add(String(chatId));
    const users = getBotUsersList();
    const count = users.length;
    const text =
      `<tg-emoji emoji-id="5789428375261023681">📢</tg-emoji> <b>BROADCAST TO ALL USERS</b>\n` +
      `— — — — — — — — — —\n` +
      `👥 <b>Target Audience:</b> ${count} Registered Users\n\n` +
      `📤 <b>Supported Broadcast Formats:</b>\n` +
      `▫️ <b>Text Message:</b> Plain or formatted text with links\n` +
      `▫️ <b>Photo:</b> Single photo with caption\n` +
      `▫️ <b>Video:</b> Video file with caption\n` +
      `▫️ <b>Audio / Voice:</b> MP3, audio track, or voice note\n` +
      `▫️ <b>Document / File:</b> PDF, TXT, ZIP, APK, etc.\n\n` +
      `💬 <b>How to Broadcast:</b>\n` +
      `Simply send or forward your message / photo / video / audio / file directly in this chat right now. It will be immediately delivered to all users.\n` +
      `— — — — — — — — — —`;
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", BROADCAST_CANCEL_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", BROADCAST_CANCEL_KEYBOARD);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "broadcast_cancel") {
    adminBroadcastActive.delete(String(chatId));
    await answerTelegramCallbackQuery(callId, "❌ Broadcast cancelled.", true);
    const text = getAdminPanelDashboardText();
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", ADMIN_PANEL_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", ADMIN_PANEL_KEYBOARD);
    }
    return;
  }

  if (data === "bot_control_menu") {
    const text = `<tg-emoji emoji-id="5857154735299104907">🤖</tg-emoji> <b>BOT CONTROL</b>\n\nConfigure refer program and customer support options below:`;
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", BOT_CONTROL_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", BOT_CONTROL_KEYBOARD);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "manage_refer_menu") {
    await answerTelegramCallbackQuery(callId, "👥 Manage Refer configuration will be available soon.", true);
    return;
  }

  if (data === "manage_support_menu") {
    await answerTelegramCallbackQuery(callId, "💬 Manage Support configuration will be available soon.", true);
    return;
  }

  if (data === "deposit_method_menu") {
    await answerTelegramCallbackQuery(callId, "💳 Deposit Method configuration will be available soon.", true);
    return;
  }

  if (data === "dollar_rate_menu") {
    await answerTelegramCallbackQuery(callId, "💵 Dollar Rate configuration will be available soon.", true);
    return;
  }

  if (data === "manage_package_menu") {
    const text = getManagePackageDashboardText();
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", MANAGE_PACKAGE_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", MANAGE_PACKAGE_KEYBOARD);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "upload_firebase_json_menu") {
    adminFirebaseUploadActive.add(String(chatId));
    const text =
      `<tg-emoji emoji-id="5257969839313526622">📂</tg-emoji> <b>Please upload your Firebase .json key file.</b>\n` +
      `— — — — — — — — — —\n` +
      `ℹ️ <b>Service Account Key:</b>\n` +
      `Send or upload your Firebase service account <code>.json</code> key file directly in this chat.\n\n` +
      `💾 <b>Data that will sync to Firestore:</b>\n` +
      `▫️ 👥 <b>All Users & Balances:</b> <code>users</code> collection\n` +
      `▫️ 🔑 <b>User API Keys:</b> stored with each user doc\n` +
      `▫️ 📱 <b>Telegram Accounts & Seasons:</b> <code>tg_accounts</code> (API ID, API Hash, Session string)\n` +
      `▫️ 💳 <b>Payment Methods & Rates:</b> <code>settings/payment_config</code>\n` +
      `— — — — — — — — — —\n` +
      `<i>Tap Back below to cancel.</i>`;
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", FIREBASE_UPLOAD_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", FIREBASE_UPLOAD_KEYBOARD);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "admin_panel_home") {
    adminTgWizard.delete(String(chatId));
    adminBroadcastActive.delete(String(chatId));
    adminFirebaseUploadActive.delete(String(chatId));
    const text = getAdminPanelDashboardText();
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", ADMIN_PANEL_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", ADMIN_PANEL_KEYBOARD);
    }
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "profile_my_api" || data === "profile_add_money" || data === "profile_invite_friend") {
    await answerTelegramCallbackQuery(callId);
    return;
  }

  if (data === "dummy_alert") {
    await answerTelegramCallbackQuery(callId, "⚠️ This feature configuration will be available soon (Dummy Alert).", true);
    return;
  }

  await answerTelegramCallbackQuery(callId);
}

async function sendTelegramMessage(chatId: number, text: string, parseMode = "HTML", replyMarkup: any = null): Promise<number | null> {
  try {
    const formattedText = formatTelegramHtml(text);
    const activeMode = getUserMenuMode(chatId);
    const defaultMarkup = activeMode ? BACK_MENU_KB : getMainMenuKeyboard(chatId);
    const finalMarkup = replyMarkup === false
      ? null
      : ((!replyMarkup || replyMarkup === MAIN_MENU_KB) 
        ? (replyMarkup === MAIN_MENU_KB ? getMainMenuKeyboard(chatId) : defaultMarkup)
        : replyMarkup);

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
    const inlineMarkup = replyMarkup && replyMarkup.inline_keyboard ? replyMarkup : null;
    const payload: any = {
      chat_id: chatId,
      message_id: messageId,
      text: formattedText,
      parse_mode: "HTML",
    };
    if (inlineMarkup) {
      payload.reply_markup = inlineMarkup;
    }
    const response = await fetch(`${TG_API_URL}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errText = await response.text();
      if (errText.includes("message is not modified")) {
        return;
      }
      if (errText.includes("message can't be edited") || errText.includes("message to edit not found")) {
        await sendTelegramMessage(chatId, text, parseMode, replyMarkup);
        return;
      }
      console.warn("[Telegram bot] HTML editMessageText returned status:", response.status, errText, "Retrying with plain fallback...");
      const fallbackPayload: any = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
      };
      if (inlineMarkup) fallbackPayload.reply_markup = inlineMarkup;
      const fbResp = await fetch(`${TG_API_URL}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
      if (!fbResp.ok) {
        await sendTelegramMessage(chatId, text, parseMode, replyMarkup);
      }
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

async function handleTelegramDocumentMessage(chatId: number, document: any, captionText = "") {
  const activeMode = getUserMenuMode(chatId);
  if (activeMode !== "check_ws" && activeMode !== "check_tg") {
    await sendTelegramMessage(
      chatId,
      "⚠️ <b>No Option Selected!</b>\n\n👇 Select an option from the menu below:",
      "HTML",
      getMainMenuKeyboard(chatId)
    );
    return;
  }

  const fileId = document.file_id;
  const fileName = document.file_name || "numbers.txt";
  const isTgMode = activeMode === "check_tg";
  
  await sendTelegramMessage(
    chatId,
    `⏳ Processing <b>${fileName}</b>... Extracting phone numbers for ${isTgMode ? "Telegram" : "WhatsApp"} check.`,
    "HTML"
  );
  
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
    
    // 3. Extract numbers using smart extractor
    const extracted = extractPhoneNumbers(fileText);
    
    if (extracted.length > 0) {
      if (isTgMode) {
        await checkAndRespondTgBatch(chatId, extracted, true);
      } else {
        await checkAndRespondBatch(chatId, extracted, true);
      }
    } else {
      await sendTelegramMessage(chatId, "⚠️ No valid 8 to 15-digit mobile numbers found in this file. Please upload a valid .txt or .csv file.");
    }
  } catch (err: any) {
    console.error("[Telegram Bot] Error processing document:", err);
    await sendTelegramMessage(chatId, `❌ An error occurred while processing the file: ${err.message || err}`);
  }
}

async function startWhatsAppPairingForChat(chatId: number, rawPhoneInput: string, senderName: string) {
  const phoneCleaned = normalizePhone(rawPhoneInput);

  if (phoneCleaned.length < 8) {
    await sendTelegramMessage(chatId, "⚠️ Invalid phone number format. Example: `8801700000000`", "Markdown", BACK_MENU_KB);
    return;
  }

  const processingMsgId = await sendTelegramMessage(
    chatId,
    `<tg-emoji emoji-id="5337172996211648018">⏳</tg-emoji> 𝙿𝚛𝚘𝚌𝚌𝚎𝚜𝚜𝚒𝚗𝚐 𝚢𝚘𝚞𝚛 𝚛𝚎𝚚𝚞𝚎𝚜𝚝`,
    "HTML",
    false
  );

  // Bootstrap connection setup
  linkingOwners.set(phoneCleaned, { chatId, name: senderName });

  currentActivePhone = phoneCleaned;
  await initWhatsApp(phoneCleaned);

  const maskedPhone = phoneCleaned.length > 7
    ? `${phoneCleaned.slice(0, 3)}****${phoneCleaned.slice(-4)}`
    : phoneCleaned;

  // Dynamic wait for pairing code to generate
  let counter = 0;
  const maxRetries = 20;
  const timer = setInterval(async () => {
    counter++;
    const currentSession = activeSessions.get(phoneCleaned);
    if (currentSession && currentSession.status === "pairing-code-ready" && currentSession.pairingCode) {
      clearInterval(timer);
      const codeMsg =
        `✅ Device Pairing Code Sent Successfully!\n\n` +
        `📞 Number : ${maskedPhone}\n\n` +
        `💬 Pairing Code : <code>${currentSession.pairingCode}</code>`;
      const codeInlineKb = {
        inline_keyboard: [
          [
            {
              text: `${currentSession.pairingCode}`,
              icon_custom_emoji_id: "5429612632430654504",
              copy_text: { text: currentSession.pairingCode.replace(/-/g, "") },
              style: "success"
            }
          ]
        ]
      };
      if (processingMsgId) {
        await editTelegramMessage(chatId, processingMsgId, codeMsg, "HTML", codeInlineKb);
      } else {
        await sendTelegramMessage(chatId, codeMsg, "HTML", codeInlineKb);
      }
    } else if (currentSession && currentSession.status === "error") {
      clearInterval(timer);
      const errMsg = `❌ Failed to generate pairing code: ${currentSession.error || "WhatsApp Server Refusal"}`;
      if (processingMsgId) {
        await editTelegramMessage(chatId, processingMsgId, errMsg, "HTML");
      } else {
        await sendTelegramMessage(chatId, errMsg, "HTML", BACK_MENU_KB);
      }
    } else if (counter >= maxRetries) {
      clearInterval(timer);
      const timeoutMsg = `⏳ Code generation is taking a moment. Please check in 30 seconds using <code>/status</code>.`;
      if (processingMsgId) {
        await editTelegramMessage(chatId, processingMsgId, timeoutMsg, "HTML");
      } else {
        await sendTelegramMessage(chatId, timeoutMsg, "HTML", BACK_MENU_KB);
      }
    }
  }, 1000);
}

async function handleTelegramMessage(message: any) {
  const chatId = message.chat.id;
  const chatKey = String(chatId);
  const currentUser = trackBotUser(chatId, message.from || message.chat);

  // Check if Admin is currently in broadcast mode (intercepts text, photo, video, audio, voice, document)
  if (chatKey === ADMIN_CHAT_ID && adminBroadcastActive.has(chatKey)) {
    const rawText = (message.text || message.caption || "").trim();
    if (rawText === "BACK" || rawText.toUpperCase() === "BACK" || rawText === "/cancel" || rawText === "❌ CANCEL") {
      adminBroadcastActive.delete(chatKey);
      await sendTelegramMessage(chatId, "❌ <b>Broadcast cancelled.</b>", "HTML", ADMIN_PANEL_KEYBOARD);
      return;
    }

    adminBroadcastActive.delete(chatKey);
    const users = getBotUsersList();
    const targetChatIds = Array.from(new Set(users.map(u => u.chatId))).filter(
      id => id && String(id) !== "0" && String(id) !== chatKey
    );

    if (targetChatIds.length === 0) {
      await sendTelegramMessage(
        chatId,
        "⚠️ <b>No recipient users found!</b> Only you are registered in the bot so far.",
        "HTML",
        ADMIN_PANEL_KEYBOARD
      );
      return;
    }

    const statusMsgId = await sendTelegramMessage(
      chatId,
      `🚀 <b>Broadcasting to ${targetChatIds.length} users...</b>\n\n⏳ Please wait while your content is being delivered.`,
      "HTML"
    );

    const messageId = message.message_id;
    let delivered = 0;
    let failed = 0;

    for (const targetId of targetChatIds) {
      try {
        const resp = await fetch(`${TG_API_URL}/copyMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetId,
            from_chat_id: chatId,
            message_id: messageId
          })
        });
        if (resp.ok) {
          delivered++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
      await new Promise(r => setTimeout(r, 40));
    }

    const reportMsg =
      `✅ <b>BROADCAST COMPLETED!</b>\n` +
      `— — — — — — — — — —\n` +
      `📊 <b>Total Target:</b> ${targetChatIds.length}\n` +
      `🟢 <b>Delivered:</b> ${delivered}\n` +
      `🔴 <b>Failed / Blocked:</b> ${failed}\n` +
      `— — — — — — — — — —\n` +
      `<i>Your broadcast has been successfully sent to all bot users.</i>`;

    if (statusMsgId) {
      await editTelegramMessage(chatId, statusMsgId, reportMsg, "HTML", ADMIN_PANEL_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, reportMsg, "HTML", ADMIN_PANEL_KEYBOARD);
    }
    return;
  }

  // Check if Admin is uploading Firebase Service Account JSON
  if (chatKey === ADMIN_CHAT_ID && adminFirebaseUploadActive.has(chatKey)) {
    const rawText = (message.text || message.caption || "").trim();
    if (rawText === "BACK" || rawText.toUpperCase() === "BACK" || rawText === "/cancel" || rawText === "❌ CANCEL") {
      adminFirebaseUploadActive.delete(chatKey);
      await sendTelegramMessage(chatId, "❌ <b>Firebase upload cancelled.</b>", "HTML", ADMIN_PANEL_KEYBOARD);
      return;
    }

    let parsedJson: any = null;

    if (message.document) {
      const fileId = message.document.file_id;
      const fileName = message.document.file_name || "firebase.json";

      const waitMsgId = await sendTelegramMessage(
        chatId,
        `⏳ <b>Processing ${fileName}...</b>\n\nValidating Firebase service account credentials.`,
        "HTML"
      );

      try {
        const fileInfoRes = await fetch(`${TG_API_URL}/getFile?file_id=${fileId}`);
        const fileInfoData = await fileInfoRes.json();
        if (!fileInfoData.ok || !fileInfoData.result?.file_path) {
          throw new Error("Unable to retrieve file path from Telegram.");
        }
        const fileDownloadUrl = `https://api.telegram.org/file/bot${TG_TOKEN}/${fileInfoData.result.file_path}`;
        const fileRes = await fetch(fileDownloadUrl);
        const fileText = await fileRes.text();
        parsedJson = JSON.parse(fileText);
      } catch (fErr: any) {
        if (waitMsgId) {
          await editTelegramMessage(
            chatId,
            waitMsgId,
            `❌ <b>File parsing failed:</b> ${fErr.message || fErr}\n\nPlease ensure you upload a valid <code>.json</code> file.`,
            "HTML",
            FIREBASE_UPLOAD_KEYBOARD
          );
        } else {
          await sendTelegramMessage(
            chatId,
            `❌ <b>File parsing failed:</b> ${fErr.message || fErr}`,
            "HTML",
            FIREBASE_UPLOAD_KEYBOARD
          );
        }
        return;
      }
    } else if (message.text && (message.text.includes("project_id") || message.text.startsWith("{"))) {
      try {
        parsedJson = JSON.parse(message.text.trim());
      } catch (tErr: any) {
        await sendTelegramMessage(
          chatId,
          `⚠️ <b>Invalid JSON format:</b> ${tErr.message || tErr}\n\nPlease upload the file as a Telegram document.`,
          "HTML",
          FIREBASE_UPLOAD_KEYBOARD
        );
        return;
      }
    } else {
      await sendTelegramMessage(
        chatId,
        `📂 <b>Please upload your Firebase .json key file.</b>\n\nSend your Firebase service account <code>.json</code> file in this chat.`,
        "HTML",
        FIREBASE_UPLOAD_KEYBOARD
      );
      return;
    }

    if (!parsedJson || !parsedJson.project_id || (!parsedJson.private_key && !parsedJson.client_email)) {
      await sendTelegramMessage(
        chatId,
        `⚠️ <b>Invalid Firebase Service Account JSON!</b>\n\nYour JSON must contain <code>project_id</code>, <code>client_email</code>, and <code>private_key</code>.\n\nPlease generate a private key from Firebase Console ➔ Project Settings ➔ Service accounts.`,
        "HTML",
        FIREBASE_UPLOAD_KEYBOARD
      );
      return;
    }

    const initResult = await initFirebaseWithServiceAccount(parsedJson);
    if (!initResult.success) {
      await sendTelegramMessage(
        chatId,
        `❌ <b>Firebase initialization failed:</b>\n<code>${initResult.error}</code>`,
        "HTML",
        FIREBASE_UPLOAD_KEYBOARD
      );
      return;
    }

    adminFirebaseUploadActive.delete(chatKey);

    const users = getBotUsersList();
    const tgAccounts = getSavedTgAccountsList();

    const successMsg =
      `<tg-emoji emoji-id="5429612632430654504">✅</tg-emoji> <b>FIREBASE FIRESTORE CONNECTED!</b>\n` +
      `— — — — — — — — — —\n` +
      `🔥 <b>Project ID:</b> <code>${initResult.projectId}</code>\n` +
      `📧 <b>Client Email:</b> <code>${initResult.clientEmail}</code>\n\n` +
      `💾 <b>Synced to Firestore Database:</b>\n` +
      `▫️ 👥 <b>Users & Balances:</b> <code>${users.length}</code> records saved to <code>users</code>\n` +
      `▫️ 📱 <b>Telegram Accounts & Seasons:</b> <code>${tgAccounts.length}</code> accounts saved to <code>tg_accounts</code>\n` +
      `▫️ 💳 <b>Payment Methods:</b> Saved to <code>settings/payment_config</code>\n` +
      `— — — — — — — — — —\n` +
      `<i>All future user registrations, balances, API keys, payment methods, and Telegram seasons will now auto-save directly to your Firestore database!</i>`;

    await sendTelegramMessage(chatId, successMsg, "HTML", ADMIN_PANEL_KEYBOARD);
    return;
  }

  // Handle document file upload if any phone numbers file is sent
  if (message.document) {
    await handleTelegramDocumentMessage(chatId, message.document, message.caption || "");
    return;
  }

  const text = message.text ? message.text.trim() : "";
  if (!text) return;

  // COMMAND: /start
  if (text.startsWith("/start")) {
    setUserMenuMode(chatId, null);
    const startMsg =
      `👋 <b>WELCOME TO LIVE CHECKER</b>\n` +
      `————————————\n` +
      `<tg-emoji emoji-id="5429612632430654504">🟢</tg-emoji> <b>Live WhatsApp Checker</b>\n` +
      `<tg-emoji emoji-id="5429136513831057777">🔵</tg-emoji> <b>Live Telegram Checker</b>\n` +
      `————————————\n` +
      `👇 <i>Select an option from the menu below:</i>`;
    await sendTelegramMessage(chatId, startMsg, "HTML", getMainMenuKeyboard(chatId));
    return;
  }

  // BACK BUTTON ACTION
  if (text === "BACK" || text.toUpperCase() === "BACK") {
    setUserMenuMode(chatId, null);
    await sendTelegramMessage(
      chatId,
      `🔥 <b>Main Menu</b>\n\n👇 Select an option from the menu below:`,
      "HTML",
      getMainMenuKeyboard(chatId)
    );
    return;
  }

  // --- MENU BUILDER BUTTON ACTIONS ---
  if (text === "CONNECT WS CHECKER" || text.includes("CONNECT WS CHECKER")) {
    setUserMenuMode(chatId, "connect_ws");
    const connectMsg = 
      `🔗 <b>LINK YOUR WS NUMBER</b>\n` +
      `— — — — — — — — — —\n` +
      `<tg-emoji emoji-id="5429612632430654504">🟢</tg-emoji> Send Your Ws Number Example :\n` +
      `<code>8801700000000</code>\n` +
      `<code>923300000000</code>\n` +
      `— — — — — — — — — —\n` +
      `ℹ️ <b>How to Connect:</b>\n` +
      `Open <b>WhatsApp</b> ➜ <b>Linked Devices</b> ➜ <b>Link with phone number</b> and enter the 8-digit code.`;
    await sendTelegramMessage(chatId, connectMsg, "HTML", BACK_MENU_KB);
    return;
  }

  if (text === "CHECK WS NUMBER" || text.includes("CHECK WS NUMBER")) {
    setUserMenuMode(chatId, "check_ws");
    const checkGuideMsg = 
      `<tg-emoji emoji-id="5429612632430654504">🟢</tg-emoji> <b>CHECK WS NUMBER</b>\n` +
      `— — — — — — — — — —\n` +
      `ℹ️ Send Number(s) Example :\n` +
      `<code>8801700000000</code>\n` +
      `<code>923300000000</code>\n` +
      `— — — — — — — — — —\n` +
      `🟢 <b>GOOD</b> — 🚫 <b>BAD</b>`;
    await sendTelegramMessage(chatId, checkGuideMsg, "HTML", BACK_MENU_KB);
    return;
  }

  if (text === "CHECK TG NUMBER" || text.includes("CHECK TG NUMBER")) {
    setUserMenuMode(chatId, "check_tg");
    const checkTgGuideMsg = 
      `<tg-emoji emoji-id="5429136513831057777">🔵</tg-emoji> <b>CHECK TG NUMBER</b>\n` +
      `— — — — — — — — — —\n` +
      `ℹ️ Send Number(s) Example :\n` +
      `<code>8801700000000</code>\n` +
      `<code>923300000000</code>\n` +
      `— — — — — — — — — —\n` +
      `🔵 <b>GOOD</b> — ⚫ <b>BAD</b>`;
    await sendTelegramMessage(chatId, checkTgGuideMsg, "HTML", BACK_MENU_KB);
    return;
  }

  if (text === "BUY WS AND TG API" || text.includes("BUY WS AND TG API") || text === "BUY WS API" || text.includes("BUY WS API") || text === "BUY PACKAGE" || text.includes("BUY PACKAGE")) {
    setUserMenuMode(chatId, null);
    const buyApiMsg = 
      `⚡ *BUY WS AND TG API (WhatsApp & Telegram Checker API)*\n\n` +
      `🌐 *Official API Server:*\n` +
      `\`https://dxazone-checker.125.zero-bot.org\`\n\n` +
      `🔹 *Multi-User REST API Endpoints:*\n` +
      `▫️ \`POST /api/connect-whatsapp\` - Link user's WhatsApp & get 8-digit pairing code\n` +
      `▫️ \`GET /api/user-status?userId=...\` - Isolated user database & WS connection status\n` +
      `▫️ \`GET /api/check-phone?phone=...&senderPhone=...\` - Check single number via specific WhatsApp\n` +
      `▫️ \`POST /api/check-batch\` - High-speed bulk checker via specific \`senderPhone\` / \`userId\`\n\n` +
      `💎 *API Highlights:*\n` +
      `▫️ Per-user isolated database & WhatsApp session management\n` +
      `▫️ Check numbers using any specific connected WhatsApp number\n` +
      `▫️ High concurrency & multi-threaded throughput\n\n` +
      `📞 *To purchase API license keys:* Click the button below to download the full documentation guide or contact Admin directly.`;
    await sendTelegramMessage(chatId, buyApiMsg, "Markdown", BUY_API_INLINE_KEYBOARD);
    return;
  }

  if (text === "HELP" || text.includes("HELP")) {
    setUserMenuMode(chatId, null);
    const helpMsg = 
      `📖 *HELP & GUIDELINES*\n\n` +
      `*How to use:*\n` +
      `▫️ \`CONNECT WS CHECKER\` - Tap and send your number (e.g. \`8801700000000\`) to get a pairing code\n` +
      `▫️ \`CHECK WS NUMBER\` - Tap and send phone numbers directly to check WhatsApp\n` +
      `▫️ \`CHECK TG NUMBER\` - Tap and send phone numbers directly to check Telegram\n` +
      `▫️ \`BUY WS AND TG API\` - API license purchase & documentation\n` +
      `▫️ \`MY PROFILE\` - View your account and gateway info\n` +
      `▫️ \`/status\` - View connection health and active accounts\n` +
      `▫️ \`/logout <phone_number>\` - Remove an account\n` +
      `▫️ Upload .txt / .csv file - Process bulk number lists`;
    await sendTelegramMessage(chatId, helpMsg, "Markdown", getMainMenuKeyboard(chatId));
    return;
  }

  if (text === "MY PROFILE" || text.includes("MY PROFILE")) {
    setUserMenuMode(chatId, null);
    const accounts = getSavedAccountsList();
    const userFirstName = message.from?.first_name || message.chat?.first_name || "Telegram User";
    const userLastName = message.from?.last_name || "";
    const fullName = `${userFirstName} ${userLastName}`.trim();
    const username = message.from?.username ? `@${message.from.username}` : "Not Set";
    const userAccounts = accounts.filter(
      (a: any) =>
        String(a.addedByChatId) === String(chatId) ||
        String(linkingOwners.get(a.phone)?.chatId) === String(chatId)
    );
    const balanceUsd = typeof currentUser.balanceUsd === "number" ? currentUser.balanceUsd : 0;
    const balanceBdt = typeof currentUser.balanceBdt === "number" ? currentUser.balanceBdt : balanceUsd * 125;
    const accountLabel = currentUser.isPremium ? "Premium User" : "Free User";

    const profileMsg =
      `<tg-emoji emoji-id="5208604387156448480">👤</tg-emoji> <b>MY PROFILE</b>\n` +
      `— — — — — — — — — —\n` +
      `<tg-emoji emoji-id="5429274992166609833">👤</tg-emoji> <b>Name:</b> ${fullName}\n` +
      `<tg-emoji emoji-id="5336972142066047577">🌐</tg-emoji> <b>Username:</b> ${username}\n` +
      `<tg-emoji emoji-id="5352862640592949843">🆔</tg-emoji> <b>Telegram ID:</b> <code>${chatId}</code>\n` +
      `<tg-emoji emoji-id="5429612632430654504">🟢</tg-emoji> <b>WS CONNECTED :</b> ${userAccounts.length}\n` +
      `<tg-emoji emoji-id="5440896830072179569">💵</tg-emoji> <b>Balance :</b> ৳${balanceBdt} ( $${balanceUsd} )\n` +
      `<tg-emoji emoji-id="5352838545826420397">💎</tg-emoji> <b>Account :</b> ${accountLabel}\n` +
      `— — — — — — — — — —`;
    await sendTelegramMessage(chatId, profileMsg, "HTML", MY_PROFILE_INLINE_KEYBOARD);
    return;
  }

  if (text === "MY PACKAGE" || text.includes("MY PACKAGE")) {
    setUserMenuMode(chatId, null);
    const isPrem = currentUser.isPremium;
    const pkgName = isPrem ? (currentUser.package || "Premium API Tier") : "Free Starter Tier";
    const dailyLimit = isPrem ? "Unlimited checks / day" : "500 checks / day (Unlimited single checks)";
    const batchLimit = isPrem ? "100,000 numbers per batch" : "10,000 numbers per batch";
    const speed = isPrem ? "⚡ Hyper Fast Multi-Gateway (0.05s - 0.1s / number)" : "⚡ Ultra Fast (0.2s - 0.5s / number)";
    const apiAccess = isPrem ? "🟢 Full REST API & Webhooks Access Enabled" : "🟡 Basic Rate-Limited Access";

    const pkgMsg = 
      `📦 *MY PACKAGE DETAILS*\n\n` +
      `▫️ *Package:* ${isPrem ? "💎" : "🌟"} ${pkgName} ${isPrem ? "(Active License)" : "(Free Tier)"}\n` +
      `▫️ *Daily Limit:* ${dailyLimit}\n` +
      `▫️ *Bulk Batch Size:* ${batchLimit}\n` +
      `▫️ *Checking Speed:* ${speed}\n` +
      `▫️ *API Access:* ${apiAccess}\n` +
      `▫️ *Validity:* ♾️ Lifetime Active\n\n` +
      (isPrem 
        ? `✅ *Your Premium API Package is active!* You have priority gateway throughput.` 
        : `💡 To upgrade to an Unlimited Enterprise license, click *BUY WS AND TG API*.`);
    await sendTelegramMessage(chatId, pkgMsg, "Markdown", getMainMenuKeyboard(chatId));
    return;
  }

  if (text === "ADMIN PANEL" || text.includes("ADMIN PANEL") || text === "/admin" || text.startsWith("/admin")) {
    setUserMenuMode(chatId, null);
    if (String(chatId) !== ADMIN_CHAT_ID) {
      await sendTelegramMessage(chatId, `⛔ *Access Denied:* The Admin Panel is exclusively restricted to the designated admin (ID: \`${ADMIN_CHAT_ID}\`).`, "Markdown", getMainMenuKeyboard(chatId));
      return;
    }
    const adminMsg = getAdminPanelDashboardText();
    await sendTelegramMessage(chatId, adminMsg, "HTML", ADMIN_PANEL_KEYBOARD);
    return;
  }

  // COMMAND: /users (Admin Only)
  if (text === "/users" || text.startsWith("/users")) {
    if (String(chatId) !== ADMIN_CHAT_ID) {
      await sendTelegramMessage(chatId, "⛔ Access Denied: Admin only.");
      return;
    }
    const users = getBotUsersList();
    const { totalUsers, premiumUsers, freeUsers } = getUserStats();
    let userMsg = 
      `👥 <b>REGISTERED BOT USERS (${totalUsers})</b>\n\n` +
      `💎 <b>Premium API Package:</b> ${premiumUsers}\n` +
      `🌟 <b>Free Tier Users:</b> ${freeUsers}\n\n`;
    
    users.forEach((u, idx) => {
      const badge = u.isPremium ? "💎 PREMIUM" : "⚪ FREE";
      userMsg += `${idx + 1}. <b>${u.name}</b> (${u.username})\n   ▫️ ID: <code>${u.chatId}</code> | [${badge}]\n   ▫️ Package: <b>${u.package}</b>\n   ▫️ Last Active: <code>${new Date(u.lastActive).toLocaleDateString()}</code>\n\n`;
    });

    await sendTelegramMessage(chatId, userMsg, "HTML");
    return;
  }

  // COMMAND: /setpremium <chat_id>
  if (text.startsWith("/setpremium")) {
    if (String(chatId) !== ADMIN_CHAT_ID) {
      await sendTelegramMessage(chatId, "⛔ Access Denied: Admin only.");
      return;
    }
    const parts = text.split(/\s+/);
    const targetChatId = Number(parts[1]);
    if (!targetChatId || isNaN(targetChatId)) {
      await sendTelegramMessage(chatId, "⚠️ Usage: `/setpremium <chat_id>`\nExample: `/setpremium 123456789`");
      return;
    }
    const updated = setBotUserPackage(targetChatId, true, "Premium API");
    await sendTelegramMessage(
      chatId,
      `✅ <b>User Upgraded to Premium!</b>\n\n` +
      `▫️ <b>Name:</b> ${updated.name}\n` +
      `▫️ <b>Chat ID:</b> <code>${updated.chatId}</code>\n` +
      `▫️ <b>Package:</b> 💎 Premium API Package (Active)\n` +
      `▫️ <b>Granted:</b> ${new Date().toLocaleString()}`,
      "HTML"
    );
    sendTelegramMessage(
      targetChatId,
      `🎉 <b>Congratulations!</b>\n\nYour account has been upgraded to the 💎 <b>Premium API Package</b> by the administrator!\n\nYou now have unlimited checks, priority gateway access, and full API privileges. Check details via <b>MY PACKAGE</b>.`,
      "HTML"
    ).catch(() => {});
    return;
  }

  // COMMAND: /removepremium <chat_id>
  if (text.startsWith("/removepremium")) {
    if (String(chatId) !== ADMIN_CHAT_ID) {
      await sendTelegramMessage(chatId, "⛔ Access Denied: Admin only.");
      return;
    }
    const parts = text.split(/\s+/);
    const targetChatId = Number(parts[1]);
    if (!targetChatId || isNaN(targetChatId)) {
      await sendTelegramMessage(chatId, "⚠️ Usage: `/removepremium <chat_id>`\nExample: `/removepremium 123456789`");
      return;
    }
    const updated = setBotUserPackage(targetChatId, false, "Free");
    await sendTelegramMessage(
      chatId,
      `✅ <b>User Downgraded!</b>\n\n` +
      `▫️ <b>Name:</b> ${updated.name}\n` +
      `▫️ <b>Chat ID:</b> <code>${updated.chatId}</code>\n` +
      `▫️ <b>Package:</b> ⚪ Free Tier`,
      "HTML"
    );
    return;
  }

  // COMMAND: /login <phone_number>
  if (text.startsWith("/login")) {
    const rawPhoneInput = text.substring(6).trim();
    if (!rawPhoneInput) {
      await sendTelegramMessage(chatId, "⚠️ Please provide a phone number. Example: `8801700000000`");
      return;
    }
    const senderName = message.from?.first_name || message.chat?.first_name || "Telegram User";
    await startWhatsAppPairingForChat(chatId, rawPhoneInput, senderName);
    return;
  }

  // COMMAND: /status
  if (text.startsWith("/status")) {
    const saved = getSavedAccountsList();
    const myAccounts = saved.filter(acc => String(acc.addedByChatId) === String(chatId));
    const isAdmin = String(chatId) === ADMIN_CHAT_ID;
    const otherAccounts = isAdmin ? saved.filter(acc => String(acc.addedByChatId) !== String(chatId)) : [];

    if (myAccounts.length === 0 && otherAccounts.length === 0) {
      await sendTelegramMessage(chatId, "ℹ️ You have not linked any WhatsApp account yet. Tap *CONNECT WS CHECKER* and send your phone number to connect.");
      return;
    }

    let statusMsg = `📊 *WhatsApp Connection Status:* \n\n`;

    if (myAccounts.length > 0) {
      statusMsg += `👤 *Your Linked Accounts (${myAccounts.length}):*\n`;
      myAccounts.forEach((acc, idx) => {
        const activeS = activeSessions.get(acc.phone);
        const onlineStatus = activeS ? activeS.status : "disconnected";
        const statusEmoji = onlineStatus === "connected" ? "🟢 Connected" : onlineStatus === "connecting" ? "🟡 Connecting" : "🔴 Offline";
        statusMsg += `${idx + 1}. *+${acc.phone}* (${acc.name || "WhatsApp User"})\n   Status: ${statusEmoji}\n`;
      });
      statusMsg += `\n`;
    } else {
      statusMsg += `⚠️ *No personal WhatsApp account linked yet.*\nTap *CONNECT WS CHECKER* to link your WhatsApp.\n\n`;
    }

    if (isAdmin && otherAccounts.length > 0) {
      statusMsg += `👥 *Other Users' Accounts (${otherAccounts.length}):*\n`;
      otherAccounts.forEach((acc, idx) => {
        const activeS = activeSessions.get(acc.phone);
        const onlineStatus = activeS ? activeS.status : "disconnected";
        const statusEmoji = onlineStatus === "connected" ? "🟢 Online" : "🔴 Offline";
        statusMsg += `${idx + 1}. *+${acc.phone}* (Added by: ${acc.addedByName || "User"})\n   Status: ${statusEmoji}\n`;
      });
    }

    await sendTelegramMessage(chatId, statusMsg);
    return;
  }

  // COMMAND: /logout <phone>
  if (text.startsWith("/logout")) {
    const rawPhoneInput = text.substring(7).trim();
    if (!rawPhoneInput) {
      await sendTelegramMessage(chatId, "⚠️ Please provide a phone number. Example: `/logout 8801700000000`");
      return;
    }
    const phoneCleaned = normalizePhone(rawPhoneInput);
    const saved = getSavedAccountsList();
    const targetAcc = saved.find(a => a.phone === phoneCleaned);
    const isAdmin = String(chatId) === ADMIN_CHAT_ID;

    if (!targetAcc || (!isAdmin && String(targetAcc.addedByChatId) !== String(chatId))) {
      await sendTelegramMessage(chatId, `⚠️ *+${phoneCleaned}* was not found in your linked accounts.`);
      return;
    }

    const existed = deleteAccountFromDb(phoneCleaned);
    if (existed) {
      await sendTelegramMessage(chatId, `✅ *+${phoneCleaned}* has been disconnected and removed from your account.`);
    } else {
      await sendTelegramMessage(chatId, `⚠️ *+${phoneCleaned}* was not found in the database.`);
    }
    return;
  }

  // COMMAND: /checktg <number>
  if (text.startsWith("/checktg")) {
    const rawInput = text.substring(8).trim();
    const extracted = extractPhoneNumbers(rawInput);
    if (extracted.length === 0) {
      await sendTelegramMessage(chatId, "⚠️ Please provide a phone number to check on Telegram. Example: `/checktg 8801712345678`");
      return;
    }
    await checkAndRespondTgBatch(chatId, extracted, false);
    return;
  }

  // COMMAND: /check <number>
  if (text.startsWith("/check")) {
    const rawInput = text.substring(6).trim();
    const extracted = extractPhoneNumbers(rawInput);
    if (extracted.length === 0) {
      await sendTelegramMessage(chatId, "⚠️ Please provide a phone number to check. Example: `8801712345678`");
      return;
    }
    await checkAndRespondBatch(chatId, extracted);
    return;
  }

  // HANDLE ADMIN TG CHECKER WIZARD (Add Telegram Account / Edit API ID / Edit API Hash)
  const wiz = adminTgWizard.get(chatKey);
  if (wiz && String(chatId) === ADMIN_CHAT_ID) {
    const cancelWizKb = {
      inline_keyboard: [
        [
          {
            text: "Back",
            icon_custom_emoji_id: "5267490665117275176",
            callback_data: wiz.targetPhone ? `tg_acc_view_${wiz.targetPhone}` : "tg_checker_menu",
            style: "danger"
          }
        ]
      ]
    };

    if (wiz.step === "edit_api_id" && wiz.targetPhone) {
      const parsedId = Number(text.replace(/\D/g, ""));
      if (!parsedId || isNaN(parsedId) || parsedId < 100) {
        await sendTelegramMessage(chatId, "⚠️ Invalid API ID. Please send a valid numeric API ID (e.g. `2040` or `25481920`).", "Markdown", cancelWizKb);
        return;
      }
      updateTgAccountCredentialsInDb(wiz.targetPhone, parsedId, undefined);
      adminTgWizard.delete(chatKey);
      await sendTelegramMessage(
        chatId,
        `✅ <b>API ID Updated Successfully!</b>\n\n` + getTgAccountDetailText(wiz.targetPhone),
        "HTML",
        getTgAccountDetailKeyboard(wiz.targetPhone)
      );
      return;
    }

    if (wiz.step === "edit_api_hash" && wiz.targetPhone) {
      const cleanHash = text.trim();
      if (cleanHash.length < 10) {
        await sendTelegramMessage(chatId, "⚠️ Invalid API Hash. Please send a valid API Hash string from http://my.telegram.org.", "Markdown", cancelWizKb);
        return;
      }
      updateTgAccountCredentialsInDb(wiz.targetPhone, undefined, cleanHash);
      adminTgWizard.delete(chatKey);
      await sendTelegramMessage(
        chatId,
        `✅ <b>API Hash Updated Successfully!</b>\n\n` + getTgAccountDetailText(wiz.targetPhone),
        "HTML",
        getTgAccountDetailKeyboard(wiz.targetPhone)
      );
      return;
    }

    if (wiz.step === "await_api_id") {
      const parsedId = Number(text.replace(/\D/g, ""));
      if (!parsedId || isNaN(parsedId) || parsedId < 100) {
        await sendTelegramMessage(chatId, "⚠️ Invalid API ID. Please send your numeric <b>API ID</b> from <a href=\"https://my.telegram.org\">http://my.telegram.org</a>:", "HTML", cancelWizKb);
        return;
      }
      wiz.apiId = parsedId;
      wiz.step = "await_api_hash";
      adminTgWizard.set(chatKey, wiz);
      await sendTelegramMessage(
        chatId,
        `🔑 <b>ADD TELEGRAM ACCOUNT (Step 2/4)</b>\n\n` +
        `✅ <b>API ID Saved:</b> <code>${parsedId}</code>\n\n` +
        `Now please send your <b>API Hash</b> from <a href="https://my.telegram.org">http://my.telegram.org</a>:`,
        "HTML",
        cancelWizKb
      );
      return;
    }

    if (wiz.step === "await_api_hash") {
      const cleanHash = text.trim();
      if (cleanHash.length < 10) {
        await sendTelegramMessage(chatId, "⚠️ Invalid API Hash. Please send your 32-character <b>API Hash</b> from <a href=\"https://my.telegram.org\">http://my.telegram.org</a>:", "HTML", cancelWizKb);
        return;
      }
      wiz.apiHash = cleanHash;
      wiz.step = "await_phone";
      adminTgWizard.set(chatKey, wiz);
      await sendTelegramMessage(
        chatId,
        `📱 <b>ADD TELEGRAM ACCOUNT (Step 3/4)</b>\n\n` +
        `✅ <b>API ID:</b> <code>${wiz.apiId}</code>\n` +
        `✅ <b>API Hash:</b> <code>${cleanHash.substring(0, 8)}...</code>\n\n` +
        `Now send the <b>Telegram Phone Number</b> with country code (e.g. <code>8801712345678</code>):`,
        "HTML",
        cancelWizKb
      );
      return;
    }

    if (wiz.step === "await_phone") {
      const cleanPhone = normalizePhone(text);
      if (!cleanPhone || cleanPhone.length < 8) {
        await sendTelegramMessage(chatId, "⚠️ Invalid phone number. Please send a valid phone number with country code (e.g. <code>8801712345678</code>):", "HTML", cancelWizKb);
        return;
      }
      await sendTelegramMessage(chatId, `⏳ Connecting to Telegram servers and requesting login code for <b>+${cleanPhone}</b>...`, "HTML");
      try {
        const useApiId = wiz.apiId || TG_API_ID;
        const useApiHash = wiz.apiHash || TG_API_HASH;
        const client = new TelegramClient(new StringSession(""), useApiId, useApiHash, {
          connectionRetries: 3
        });
        await client.connect();
        const { phoneCodeHash } = await client.sendCode(
          { apiId: useApiId, apiHash: useApiHash },
          "+" + cleanPhone
        );
        wiz.phone = cleanPhone;
        wiz.phoneCodeHash = phoneCodeHash;
        wiz.client = client;
        wiz.step = "await_otp";
        adminTgWizard.set(chatKey, wiz);

        await sendTelegramMessage(
          chatId,
          `📩 <b>ADD TELEGRAM ACCOUNT (Step 4/4 - Verification Code)</b>\n\n` +
          `A login code (OTP) has been sent to your Telegram account <b>+${cleanPhone}</b>!\n\n` +
          `👉 Please send the <b>5-digit Login Code (OTP)</b> here:\n` +
          `<i>(Tip: Send it with spaces like <code>1 2 3 4 5</code> so Telegram does not block the login code)</i>`,
          "HTML",
          cancelWizKb
        );
      } catch (err: any) {
        console.error("[TG Checker Login] sendCode error:", err);
        await sendTelegramMessage(
          chatId,
          `❌ <b>Failed to send verification code:</b>\n<code>${err?.message || err}</code>\n\nPlease verify your API ID, API Hash, and Phone Number, or tap <b>Back</b>.`,
          "HTML",
          cancelWizKb
        );
      }
      return;
    }

    if (wiz.step === "await_otp") {
      const cleanCode = text.replace(/\D/g, "");
      if (!cleanCode || cleanCode.length < 4) {
        await sendTelegramMessage(chatId, "⚠️ Please send the valid 5-digit OTP code (e.g. <code>1 2 3 4 5</code>):", "HTML", cancelWizKb);
        return;
      }
      try {
        await wiz.client.invoke(
          new Api.auth.SignIn({
            phoneNumber: "+" + wiz.phone,
            phoneCodeHash: wiz.phoneCodeHash!,
            phoneCode: cleanCode
          })
        );
        const me: any = await wiz.client.getMe();
        const sessionStr = String(wiz.client.session.save());
        saveTgAccountToDb(
          wiz.phone!,
          me?.firstName || "Telegram User",
          me?.username || "",
          sessionStr,
          wiz.apiId || TG_API_ID,
          wiz.apiHash || TG_API_HASH
        );
        activeTgSessions.set(wiz.phone!, { client: wiz.client, status: "connected" });
        startTgUserbotListeners(wiz.client, wiz.phone!);
        adminTgWizard.delete(chatKey);

        await sendTelegramMessage(
          chatId,
          `🎉 <b>Telegram Account Logged In Successfully!</b>\n\n` +
          `▫️ <b>Phone:</b> <code>+${wiz.phone}</code>\n` +
          `▫️ <b>Name:</b> ${me?.firstName || "Telegram User"}\n` +
          `▫️ <b>API ID:</b> <code>${wiz.apiId}</code>\n\n` +
          getTgCheckerDashboardText(),
          "HTML",
          getTgCheckerMenuKeyboard()
        );
      } catch (err: any) {
        const errMsg = String(err?.errorMessage || err?.message || err);
        if (errMsg.includes("SESSION_PASSWORD_NEEDED")) {
          wiz.step = "await_2fa";
          adminTgWizard.set(chatKey, wiz);
          await sendTelegramMessage(
            chatId,
            `🔐 <b>Two-Step Verification (2FA) Required</b>\n\n` +
            `This Telegram account has a 2FA Cloud Password enabled.\n` +
            `👉 Please send your <b>2FA Password</b> to complete login:`,
            "HTML",
            cancelWizKb
          );
          return;
        }
        console.error("[TG Checker Login] OTP signIn error:", err);
        await sendTelegramMessage(
          chatId,
          `❌ <b>Login Failed:</b> <code>${errMsg}</code>\n\nPlease send the correct OTP code or tap <b>Back</b>.`,
          "HTML",
          cancelWizKb
        );
      }
      return;
    }

    if (wiz.step === "await_2fa") {
      try {
        await wiz.client.signInWithPassword(
          { apiId: wiz.apiId || TG_API_ID, apiHash: wiz.apiHash || TG_API_HASH },
          {
            password: async () => text.trim(),
            onError: (e: any) => { throw e; }
          }
        );
        const me: any = await wiz.client.getMe();
        const sessionStr = String(wiz.client.session.save());
        saveTgAccountToDb(
          wiz.phone!,
          me?.firstName || "Telegram User",
          me?.username || "",
          sessionStr,
          wiz.apiId || TG_API_ID,
          wiz.apiHash || TG_API_HASH
        );
        activeTgSessions.set(wiz.phone!, { client: wiz.client, status: "connected" });
        startTgUserbotListeners(wiz.client, wiz.phone!);
        adminTgWizard.delete(chatKey);

        await sendTelegramMessage(
          chatId,
          `🎉 <b>Telegram Account Logged In Successfully (2FA Verified)!</b>\n\n` +
          `▫️ <b>Phone:</b> <code>+${wiz.phone}</code>\n` +
          `▫️ <b>Name:</b> ${me?.firstName || "Telegram User"}\n` +
          `▫️ <b>API ID:</b> <code>${wiz.apiId}</code>\n\n` +
          getTgCheckerDashboardText(),
          "HTML",
          getTgCheckerMenuKeyboard()
        );
      } catch (err: any) {
        console.error("[TG Checker Login] 2FA error:", err);
        await sendTelegramMessage(
          chatId,
          `❌ <b>2FA Password Incorrect or Failed:</b> <code>${err?.message || err}</code>\n\nPlease try sending your 2FA password again or tap <b>Back</b>.`,
          "HTML",
          cancelWizKb
        );
      }
      return;
    }
  }

  // HANDLE DIRECT PHONE NUMBER INPUT BASED ON ACTIVE MENU MODE
  const activeMode = getUserMenuMode(chatId);
  const extractedNumbers = extractPhoneNumbers(text);

  if (activeMode === "connect_ws") {
    if (extractedNumbers.length > 0) {
      const senderName = message.from?.first_name || message.chat?.first_name || "Telegram User";
      await startWhatsAppPairingForChat(chatId, extractedNumbers[0], senderName);
    } else {
      await sendTelegramMessage(
        chatId,
        "⚠️ Please send a valid WhatsApp phone number with country code (e.g. `8801700000000`) or tap *BACK* to return to the Main Menu.",
        "Markdown",
        BACK_MENU_KB
      );
    }
    return;
  }

  if (extractedNumbers.length > 0) {
    if (activeMode === "check_tg") {
      await checkAndRespondTgBatch(chatId, extractedNumbers, false);
    } else if (activeMode === "check_ws") {
      await checkAndRespondBatch(chatId, extractedNumbers, false);
    } else {
      await sendTelegramMessage(
        chatId,
        "⚠️ <b>No Option Selected!</b>\n\n👇 Select an option from the menu below:",
        "HTML",
        getMainMenuKeyboard(chatId)
      );
    }
  } else {
    if (activeMode === "check_ws" || activeMode === "check_tg") {
      await sendTelegramMessage(
        chatId,
        "⚠️ Please send valid phone number(s) with country code (e.g. `8801712345678`) or upload a `.txt` / `.csv` file, or tap *BACK* to return to the Main Menu.",
        "Markdown",
        BACK_MENU_KB
      );
    } else {
      await sendTelegramMessage(
        chatId,
        "⚠️ <b>No Option Selected!</b>\n\n👇 Select an option from the menu below:",
        "HTML",
        getMainMenuKeyboard(chatId)
      );
    }
  }
}

interface TgUserInfo {
  phone: string;
  name: string;
  username: string;
  userId: string;
}

async function checkAndRespondTgBatch(chatId: number, rawNumbers: string[], fromFile = false) {
  const tgAccounts = getSavedTgAccountsList();
  const candidatePhones: string[] = [];

  for (const [ph, sess] of activeTgSessions.entries()) {
    if (sess && sess.client && sess.client.connected) {
      candidatePhones.push(ph);
    }
  }
  for (const acc of tgAccounts) {
    if (acc.phone && !candidatePhones.includes(acc.phone)) {
      candidatePhones.push(acc.phone);
    }
  }

  if (candidatePhones.length === 0) {
    await sendTelegramMessage(
      chatId,
      "⚠️ <b>টেলিগ্রাম চেকার সার্ভিস সাময়িকভাবে বন্ধ আছে!</b>\n\n" +
      "🛠 <b>এডমিন এখনো চেকার অন করেন নাই।</b>\n" +
      "দয়া করে কিছুক্ষণ অপেক্ষা করুন, এডমিন চেকার অন করলে আবার চেক করতে পারবেন অথবা সাপোর্টে যোগাযোগ করুন।\n\n" +
      "<i>(Telegram Checker is currently inactive. Admin has not enabled the checker yet. Please try again later or contact support.)</i>",
      "HTML",
      BACK_MENU_KB
    );
    return;
  }

  const normalizedList: string[] = [];
  const seen = new Set<string>();
  for (const num of rawNumbers) {
    const clean = normalizePhone(num);
    if (!clean || clean.length < 7) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    normalizedList.push(clean);
  }

  if (normalizedList.length === 0) {
    await sendTelegramMessage(
      chatId,
      "⚠️ No valid phone numbers found. Please provide valid numbers with country codes (e.g. <code>8801712345678</code>).",
      "HTML",
      BACK_MENU_KB
    );
    return;
  }

  let client: TelegramClient | null = null;
  let senderPhone = "";
  let lastConnectErr = "";

  for (const ph of candidatePhones) {
    try {
      client = await getActiveTgClient(ph);
      senderPhone = ph;
      break;
    } catch (err: any) {
      lastConnectErr = err?.message || String(err);
      console.warn(`[TG Checker] Failed connecting +${ph}:`, lastConnectErr);
    }
  }

  if (!client || !senderPhone) {
    await sendTelegramMessage(
      chatId,
      "⚠️ <b>টেলিগ্রাম চেকার সার্ভিস সাময়িকভাবে অফলাইন আছে!</b>\n\n" +
      "🛠 <b>এডমিন এখনো চেকার অন করেন নাই অথবা গেটওয়ে মেইনট্যানেন্সে আছে।</b>\n" +
      "দয়া করে কিছুক্ষণ পর আবার চেষ্টা করুন অথবা সাপোর্টে যোগাযোগ করুন।\n\n" +
      "<i>(Telegram Checker gateway is currently offline for maintenance. Please check back shortly.)</i>",
      "HTML",
      BACK_MENU_KB
    );
    return;
  }

  const progressMsgId = await sendTelegramMessage(
    chatId,
    `<tg-emoji emoji-id="5337172996211648018">⏳</tg-emoji> 𝙿𝚛𝚘𝚌𝚌𝚎𝚜𝚜𝚒𝚗𝚐 𝚢𝚘𝚞𝚛 𝚛𝚎𝚚𝚞𝚎𝚜𝚝`,
    "HTML",
    false
  );

  const activeTG: string[] = [];
  const inactiveTG: string[] = [];
  const activeDetails = new Map<string, TgUserInfo>();

  // Map saved checker accounts themselves in case someone checks the gateway's own number
  const savedAccountsByPhone = new Map<string, SavedTgAccount>();
  for (const acc of tgAccounts) {
    savedAccountsByPhone.set(normalizePhone(acc.phone), acc);
  }

  const chunkSize = 25;

  for (let i = 0; i < normalizedList.length; i += chunkSize) {
    const chunk = normalizedList.slice(i, i + chunkSize);

    // Step 1: For small batches (<= 5 numbers), try Api.contacts.ResolvePhone first so we get real Telegram names without overwriting contact names
    if (chunk.length <= 5) {
      for (const num of chunk) {
        try {
          const resolved: any = await client.invoke(new Api.contacts.ResolvePhone({ phone: "+" + num }));
          if (resolved && Array.isArray(resolved.users) && resolved.users.length > 0) {
            const u = resolved.users[0];
            const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
            activeDetails.set(num, {
              phone: num,
              name: fullName || "Telegram User",
              username: u.username || "",
              userId: u.id ? String(u.id) : ""
            });
          }
        } catch {}
      }
    }

    // Step 2: ImportContacts fallback for any numbers in chunk not yet resolved
    const unresolvedChunk = chunk.filter(num => !activeDetails.has(num));
    if (unresolvedChunk.length > 0) {
      const clientIdToPhone = new Map<string, string>();
      const contacts = unresolvedChunk.map((num, idx) => {
        const cid = BigInt(i + idx + 1);
        clientIdToPhone.set(cid.toString(), num);
        return new Api.InputPhoneContact({
          clientId: cid as any,
          phone: "+" + num,
          firstName: "TGUser",
          lastName: ""
        });
      });

      try {
        const result: any = await client.invoke(new Api.contacts.ImportContacts({ contacts }));
        const usersById = new Map<string, any>();
        const usersToDelete: any[] = [];

        if (result && Array.isArray(result.users)) {
          for (const u of result.users) {
            const uid = u.id ? String(u.id) : "";
            if (uid) {
              usersById.set(uid, u);
              usersToDelete.push(u);
            }
            if (u.phone) {
              const cleanUPhone = normalizePhone(String(u.phone));
              if (cleanUPhone) {
                const rawName = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
                const cleanName = (!rawName || rawName === "TGUser" || rawName.startsWith("TGCheck")) ? "Telegram User" : rawName;
                activeDetails.set(cleanUPhone, {
                  phone: cleanUPhone,
                  name: cleanName,
                  username: u.username || "",
                  userId: uid
                });
              }
            }
          }
        }

        if (result && Array.isArray(result.imported)) {
          for (const imp of result.imported) {
            const cidStr = imp.clientId !== undefined ? String(imp.clientId) : "";
            const uidStr = imp.userId !== undefined ? String(imp.userId) : "";
            const matchedPhone = clientIdToPhone.get(cidStr);
            if (matchedPhone) {
              const u = usersById.get(uidStr);
              const rawName = u ? [u.firstName, u.lastName].filter(Boolean).join(" ").trim() : "";
              const cleanName = (!rawName || rawName === "TGUser" || rawName.startsWith("TGCheck")) ? "Telegram User" : rawName;
              activeDetails.set(matchedPhone, {
                phone: matchedPhone,
                name: cleanName,
                username: u?.username || "",
                userId: uidStr
              });
            }
          }
        }

        // Single-contact fallback when user privacy hides phone field and clientId is 0
        if (unresolvedChunk.length === 1 && result && Array.isArray(result.users) && result.users.length > 0 && !activeDetails.has(unresolvedChunk[0])) {
          const u = result.users[0];
          const rawName = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
          const cleanName = (!rawName || rawName === "TGUser" || rawName.startsWith("TGCheck")) ? "Telegram User" : rawName;
          activeDetails.set(unresolvedChunk[0], {
            phone: unresolvedChunk[0],
            name: cleanName,
            username: u.username || "",
            userId: u.id ? String(u.id) : ""
          });
        }

        if (usersToDelete.length > 0) {
          await client.invoke(new Api.contacts.DeleteContacts({ id: usersToDelete })).catch(() => {});
        }
      } catch (e: any) {
        console.warn("[TG Bulk Check] Batch import error:", e?.message || e);
      }
    }

    for (const num of chunk) {
      if (!activeDetails.has(num) && savedAccountsByPhone.has(num)) {
        const ownAcc = savedAccountsByPhone.get(num)!;
        activeDetails.set(num, {
          phone: num,
          name: ownAcc.name || "Telegram User",
          username: ownAcc.username || "",
          userId: "Connected Gateway"
        });
      }

      if (activeDetails.has(num)) {
        activeTG.push(num);
      } else {
        inactiveTG.push(num);
      }
    }

    if (normalizedList.length > 25 && progressMsgId) {
      const doneCount = Math.min(i + chunkSize, normalizedList.length);
      const pct = Math.round((doneCount / normalizedList.length) * 100);
      await editTelegramMessage(
        chatId,
        progressMsgId,
        `<tg-emoji emoji-id="5337172996211648018">⏳</tg-emoji> 𝙿𝚛𝚘𝚌𝚌𝚎𝚜𝚜𝚒𝚗𝚐 𝚢𝚘𝚞𝚛 𝚛𝚎𝚚𝚞𝚎𝚜𝚝 (${doneCount}/${normalizedList.length} - ${pct}%)`
      );
    }
  }

  const reportText =
    `<tg-emoji emoji-id="5429136513831057777">🔵</tg-emoji> <b>LIVE TG NUMBER CHECKER</b> \n` +
    `--------------------------------\n` +
    `🔵 GOOD — ⚫ BAD`;

  const displayList = normalizedList.slice(0, 100);
  const inlineKeyboardRows = displayList.map((num) => {
    const isCreated = activeDetails.has(num);
    const statusEmoji = isCreated ? "⚫" : "🔵";
    return [
      {
        text: `+${num} ${statusEmoji}`,
        icon_custom_emoji_id: "5429136513831057777",
        copy_text: { text: `+${num}` },
        style: isCreated ? "danger" : "success"
      }
    ];
  });

  const inlineMarkup = {
    inline_keyboard: inlineKeyboardRows
  };

  if (progressMsgId) {
    await editTelegramMessage(chatId, progressMsgId, reportText, "HTML", inlineMarkup);
  } else {
    await sendTelegramMessage(chatId, reportText, "HTML", inlineMarkup);
  }

  if (fromFile || normalizedList.length > 100) {
    const activeText = activeTG.map((x) => `+${x}`).join("\n");
    const inactiveText = inactiveTG.map((x) => `+${x}`).join("\n");
    if (activeTG.length > 0) {
      await sendTelegramDocument(chatId, activeText, "bad_telegram_numbers.txt", `⚫ BAD Telegram Numbers (${activeTG.length})`);
    }
    if (inactiveTG.length > 0) {
      await sendTelegramDocument(chatId, inactiveText, "good_telegram_numbers.txt", `🔵 GOOD Telegram Numbers (${inactiveTG.length})`);
    }
  }
}

async function checkAndRespondBatch(chatId: number, rawNumbers: string[], fromFile = false) {
  // Strictly find an active linked connected WhatsApp session belonging ONLY to this specific user
  let resolvedSession: ConnectedSession | null = null;
  const saved = getSavedAccountsList();
  const myAccounts = saved.filter(
    acc =>
      String(acc.addedByChatId) === String(chatId) ||
      String(linkingOwners.get(acc.phone)?.chatId) === String(chatId)
  );

  for (const acc of myAccounts) {
    const activeS = activeSessions.get(acc.phone);
    if (activeS && activeS.status === "connected" && activeS.sock) {
      resolvedSession = activeS;
      break;
    }
  }

  // Also check in-memory sessions that were paired by this user in the current process
  if (!resolvedSession) {
    for (const [phone, owner] of linkingOwners.entries()) {
      if (String(owner.chatId) === String(chatId)) {
        const activeS = activeSessions.get(phone);
        if (activeS && activeS.status === "connected" && activeS.sock) {
          resolvedSession = activeS;
          break;
        }
      }
    }
  }

  if (!resolvedSession) {
    await sendTelegramMessage(
      chatId,
      "⚠️ *You have not connected your WhatsApp account yet!* \n\nTo check WhatsApp numbers, please connect your own WhatsApp account first by tapping *CONNECT WS CHECKER* or using: `/login 8801700000000`."
    );
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
    await sendTelegramMessage(chatId, "⚠️ No valid phone numbers found. Please provide valid numbers with country codes.");
    return;
  }

  const progressMsgId = await sendTelegramMessage(
    chatId, 
    `<tg-emoji emoji-id="5337172996211648018">⏳</tg-emoji> 𝙿𝚛𝚘𝚌𝚌𝚎𝚜𝚜𝚒𝚗𝚐 𝚢𝚘𝚞𝚛 𝚛𝚎𝚚𝚞𝚎𝚜𝚝`,
    "HTML",
    false
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
                const cleanReturned = normalizePhone(String(item.jid || "").split(":")[0].split("@")[0]);
                if (cleanReturned) {
                  chunkExists.add(`${cleanReturned}@s.whatsapp.net`);
                }
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
      const doneCount = Math.min(i + chunkSize, normalizedList.length);
      const percentage = Math.round((doneCount / normalizedList.length) * 100);
      await editTelegramMessage(
        chatId,
        progressMsgId,
        `<tg-emoji emoji-id="5337172996211648018">⏳</tg-emoji> 𝙿𝚛𝚘𝚌𝚌𝚎𝚜𝚜𝚒𝚗𝚐 𝚢𝚘𝚞𝚛 𝚛𝚎𝚚𝚞𝚎𝚜𝚝 (${doneCount}/${normalizedList.length} - ${percentage}%)`
      );
    }

    if (i + chunkSize < normalizedList.length) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }

  // Delivery of the reports
  const reportText =
    `<tg-emoji emoji-id="5429612632430654504">🟢</tg-emoji> <b>LIVE WS NUMBER CHECKER</b> \n` +
    `--------------------------------\n` +
    `🟢 GOOD — 🚫 BAD`;

  const activeSet = new Set(activeWA);
  const displayList = normalizedList.slice(0, 100);
  const inlineKeyboardRows = displayList.map((num) => {
    const isCreated = activeSet.has(num);
    const statusEmoji = isCreated ? "🚫" : "🟢";
    return [
      {
        text: `+${num} ${statusEmoji}`,
        icon_custom_emoji_id: "5429612632430654504",
        copy_text: { text: `+${num}` },
        style: isCreated ? "danger" : "primary"
      }
    ];
  });

  const inlineMarkup = {
    inline_keyboard: inlineKeyboardRows
  };

  if (progressMsgId) {
    await editTelegramMessage(chatId, progressMsgId, reportText, "HTML", inlineMarkup);
  } else {
    await sendTelegramMessage(chatId, reportText, "HTML", inlineMarkup);
  }

  if (fromFile || normalizedList.length > 100) {
    const activeText = activeWA.map((item) => `+${item}`).join("\n");
    const inactiveText = inactiveWA.map((item) => `+${item}`).join("\n");

    if (activeWA.length > 0) {
      await sendTelegramDocument(
        chatId,
        activeText,
        "bad_whatsapp_numbers.txt",
        `🚫 BAD WhatsApp Numbers (${activeWA.length})`
      );
    }
    if (inactiveWA.length > 0) {
      await sendTelegramDocument(
        chatId,
        inactiveText,
        "good_whatsapp_numbers.txt",
        `🟢 GOOD WhatsApp Numbers (${inactiveWA.length})`
      );
    }
  }
}

// --- REST API ENDPOINTS (MULTI-USER & PER-NUMBER ISOLATED) ---

async function handleApiConnectWhatsApp(req: any, res: any, waitForCodeDefault = true) {
  const rawPhone = (req.body?.phone || req.body?.senderPhone || req.query?.phone || req.query?.senderPhone || "") as string;
  const rawUserId = (req.body?.userId || req.query?.userId || "") as string;
  const rawName = (req.body?.name || req.query?.name || "") as string;
  const authHeader = (req.headers?.authorization || "") as string;
  const apiKey = (req.body?.apiKey || req.query?.apiKey || authHeader.replace(/^Bearer\s+/i, "").trim() || "") as string;
  const waitParam = req.body?.wait ?? req.query?.wait;
  const shouldWait = waitParam !== undefined ? String(waitParam) !== "false" : waitForCodeDefault;

  if (!rawPhone) {
    return res.status(400).json({ success: false, error: "Phone number is required (e.g. 8801700000000)." });
  }

  const phoneCleaned = normalizePhone(rawPhone);
  if (phoneCleaned.length < 8) {
    return res.status(400).json({ success: false, error: "Invalid phone number format. Include country code (e.g. 8801700000000)." });
  }

  const cleanUserId = rawUserId ? String(rawUserId).trim() : "";
  const cleanName = rawName ? String(rawName).trim() : (cleanUserId ? `User ${cleanUserId}` : "API User");

  console.log(`[API Connect WA] Phone: +${phoneCleaned}, UserId: ${cleanUserId || "default"}`);

  linkingOwners.set(phoneCleaned, {
    name: cleanName,
    externalUserId: cleanUserId || undefined,
    apiKey: apiKey || undefined,
    chatId: cleanUserId && /^\d+$/.test(cleanUserId) ? Number(cleanUserId) : undefined,
  });

  if (cleanUserId) {
    upsertApiUserPhone(cleanUserId, phoneCleaned, cleanName, apiKey || undefined);
  }

  currentActivePhone = phoneCleaned;
  await initWhatsApp(phoneCleaned, false);

  if (!shouldWait && !cleanUserId) {
    return res.json({
      success: true,
      status: "processing",
      phone: phoneCleaned,
    });
  }

  // Wait up to 9 seconds for Baileys to generate the 8-digit pairing code
  const startTime = Date.now();
  while (Date.now() - startTime < 9500) {
    const sess = activeSessions.get(phoneCleaned);
    if (sess && sess.status === "pairing-code-ready" && sess.pairingCode) {
      return res.json({
        success: true,
        status: "pairing-code-ready",
        phone: phoneCleaned,
        userId: cleanUserId || undefined,
        pairingCode: sess.pairingCode,
        rawCode: sess.pairingCode.replace(/-/g, ""),
        instructions: "Open WhatsApp -> Linked Devices -> Link with phone number instead and enter the 8-digit code."
      });
    }
    if (sess && sess.status === "connected") {
      return res.json({
        success: true,
        status: "connected",
        phone: phoneCleaned,
        userId: cleanUserId || undefined,
        message: "WhatsApp number is already connected!"
      });
    }
    if (sess && sess.status === "error") {
      return res.status(500).json({
        success: false,
        status: "error",
        phone: phoneCleaned,
        userId: cleanUserId || undefined,
        error: sess.error || "Failed to generate pairing code from WhatsApp server."
      });
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  const finalSess = activeSessions.get(phoneCleaned);
  return res.json({
    success: true,
    status: finalSess?.status || "processing",
    phone: phoneCleaned,
    userId: cleanUserId || undefined,
    pairingCode: finalSess?.pairingCode || null,
    rawCode: finalSess?.pairingCode ? finalSess.pairingCode.replace(/-/g, "") : null,
    instructions: "Open WhatsApp -> Linked Devices -> Link with phone number instead and enter the 8-digit code."
  });
}

app.get("/api/request-code", async (req, res) => {
  const waitDefault = Boolean(req.query.userId || req.query.wait === "true");
  await handleApiConnectWhatsApp(req, res, waitDefault);
});

app.post("/api/request-code", async (req, res) => {
  await handleApiConnectWhatsApp(req, res, true);
});

app.get("/api/connect-whatsapp", async (req, res) => {
  await handleApiConnectWhatsApp(req, res, true);
});

app.post("/api/connect-whatsapp", async (req, res) => {
  await handleApiConnectWhatsApp(req, res, true);
});

// Isolated per-user & per-number WhatsApp status endpoint
app.get("/api/user-status", (req, res) => {
  const rawUserId = (req.query.userId || "") as string;
  const rawSender = (req.query.senderPhone || req.query.phone || "") as string;
  const cleanUserId = rawUserId.trim();
  const cleanSender = rawSender ? normalizePhone(rawSender) : "";

  const dbAccounts = getSavedAccountsList();
  const apiUsers = getApiUsersList();
  const userRecord = cleanUserId ? apiUsers.find((u) => String(u.userId) === cleanUserId) : undefined;

  let filteredAccounts = dbAccounts;
  if (cleanUserId) {
    filteredAccounts = dbAccounts.filter(
      (acc) =>
        String(acc.externalUserId) === cleanUserId ||
        String(acc.addedByChatId) === cleanUserId ||
        (userRecord && userRecord.senderPhones.includes(acc.phone))
    );
  }
  if (cleanSender) {
    filteredAccounts = filteredAccounts.filter((acc) => acc.phone === cleanSender);
    if (filteredAccounts.length === 0 && activeSessions.has(cleanSender)) {
      const s = activeSessions.get(cleanSender)!;
      filteredAccounts = [
        {
          phone: cleanSender,
          name: s.profile?.name || "WhatsApp User",
          linkedAt: new Date().toISOString(),
          externalUserId: cleanUserId || undefined
        }
      ];
    }
  }

  const detailedAccounts = filteredAccounts.map((acc) => {
    const sess = activeSessions.get(acc.phone);
    return {
      phone: acc.phone,
      name: acc.name || sess?.profile?.name || "WhatsApp User",
      userId: acc.externalUserId || (acc.addedByChatId ? String(acc.addedByChatId) : cleanUserId || undefined),
      status: sess ? sess.status : "disconnected",
      pairingCode: sess?.pairingCode || undefined,
      linkedAt: acc.linkedAt
    };
  });

  const connectedAccounts = detailedAccounts.filter((a) => a.status === "connected");

  return res.json({
    success: true,
    userId: cleanUserId || undefined,
    senderPhone: cleanSender || undefined,
    connected: connectedAccounts.length > 0,
    activeSenderPhone: connectedAccounts[0]?.phone || userRecord?.activeSenderPhone || null,
    wsConnectedCount: connectedAccounts.length,
    totalChecks: userRecord?.checksCount || 0,
    accounts: detailedAccounts
  });
});

app.get("/api/status", (req, res) => {
  const rawUserId = (req.query.userId || "") as string;
  const rawSender = (req.query.senderPhone || req.query.phone || "") as string;

  if (rawUserId || rawSender) {
    const cleanSender = rawSender ? normalizePhone(rawSender) : "";
    if (cleanSender && activeSessions.has(cleanSender)) {
      const s = activeSessions.get(cleanSender)!;
      return res.json({
        status: s.status,
        phone: s.phoneNumber,
        userId: rawUserId || undefined,
        pairingCode: s.pairingCode,
        profile: s.profile,
        error: s.error,
      });
    }
    const resolved = resolveApiWhatsAppSession(rawSender, rawUserId);
    if (resolved.session) {
      return res.json({
        status: resolved.session.status,
        phone: resolved.senderPhone,
        userId: rawUserId || undefined,
        pairingCode: resolved.session.pairingCode,
        profile: resolved.session.profile,
        error: resolved.session.error,
      });
    }
  }

  updateGlobalSessionStateToSelectedActive();
  res.json(sessionState);
});

app.get("/api/reset-session", (req, res) => {
  const targetPhone = req.query.phone ? normalizePhone(String(req.query.phone)) : currentActivePhone;
  if (targetPhone) {
    deleteAccountFromDb(targetPhone);
  }
  res.json({ status: "ok", phone: targetPhone });
});

app.post("/api/send-message", async (req, res) => {
  const { to, text, senderPhone, fromPhone, userId } = req.body;
  const resolved = resolveApiWhatsAppSession(senderPhone || fromPhone, userId);
  if (!resolved.session || !resolved.session.sock) {
    return res.status(400).json({ error: resolved.error || "WhatsApp is not connected." });
  }

  if (!to || !text) {
    return res.status(400).json({ error: "Recipient and text message are required." });
  }

  try {
    const cleanTo = normalizePhone(String(to));
    const jid = `${cleanTo}@s.whatsapp.net`;
    const result = await resolved.session.sock.sendMessage(jid, { text });
    res.json({ success: true, senderPhone: resolved.senderPhone, result });
  } catch (err: any) {
    console.error("Error sending custom message via Baileys:", err);
    res.status(500).json({ error: err.message || "Failed to send message." });
  }
});

// Handler for single phone WhatsApp check (supports GET and POST, with senderPhone & userId isolation)
async function handleApiCheckSinglePhone(req: any, res: any) {
  const phoneParam = (req.query?.phone || req.body?.phone || req.query?.number || req.body?.number || "") as string;
  const senderPhoneParam = (req.query?.senderPhone || req.body?.senderPhone || req.query?.fromPhone || req.body?.fromPhone || req.query?.gatewayPhone || req.body?.gatewayPhone || "") as string;
  const userIdParam = (req.query?.userId || req.body?.userId || "") as string;

  if (!phoneParam) {
    return res.status(400).json({ success: false, error: "Target phone number ('phone') is required." });
  }

  const resolved = resolveApiWhatsAppSession(senderPhoneParam, userIdParam);
  if (!resolved.session || !resolved.session.sock) {
    return res.status(400).json({
      success: false,
      error: resolved.error || "WhatsApp is not connected. Please connect your WhatsApp number first via /api/connect-whatsapp."
    });
  }

  try {
    const cleanPhone = normalizePhone(phoneParam);
    if (!cleanPhone || cleanPhone.length < 6) {
      return res.status(400).json({ success: false, error: "Invalid phone number format." });
    }

    const jid = `${cleanPhone}@s.whatsapp.net`;
    console.log(`[Presence Checker] Querying JID: ${jid} via senderPhone: +${resolved.senderPhone} (userId: ${resolved.userId || "default"})`);

    let exists = false;
    let resolvedJid = jid;

    try {
      const result = await resolved.session.sock.onWhatsApp(jid);
      if (result && result.length > 0 && result[0].exists) {
        exists = true;
        resolvedJid = result[0].jid;
      }
    } catch (err: any) {
      console.error("[Presence Checker] onWhatsApp error:", err?.message || err);
    }

    if (resolved.userId) {
      incrementApiUserChecks(resolved.userId, 1);
    }

    return res.json({
      success: true,
      phone: cleanPhone,
      exists,
      status: exists ? "BAD" : "GOOD",
      jid: exists ? resolvedJid : undefined,
      checkedBy: resolved.senderPhone,
      userId: resolved.userId || undefined,
      whatsapp: {
        exists,
        jid: exists ? resolvedJid : null
      },
      checkedAt: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("Error in check-phone endpoint execution:", err);
    res.status(500).json({ success: false, error: err.message || "Failed to execute presence check on WhatsApp network." });
  }
}

app.get("/api/check-phone", async (req, res) => {
  await handleApiCheckSinglePhone(req, res);
});

app.post("/api/check-phone", async (req, res) => {
  await handleApiCheckSinglePhone(req, res);
});

// Endpoint to check Telegram Username or Chat ID with live status & linked whatsapp count
app.get("/api/check-telegram", async (req, res) => {
  const query = req.query.query as string;
  if (!query) {
    return res.status(400).json({ error: "Username or Chat ID is required." });
  }

  let normalizedQuery = query.trim();
  if (/^[a-zA-Z]/.test(normalizedQuery) && !normalizedQuery.startsWith("@")) {
    normalizedQuery = "@" + normalizedQuery;
  }

  try {
    console.log(`[Telegram Checker] Live query to Telegram API: getChat for ${normalizedQuery}`);
    
    const botRes = await fetch(`${TG_API_URL}/getChat?chat_id=${encodeURIComponent(normalizedQuery)}`);
    const botData = await botRes.json();
    
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

// Shared handler for bulk / batch WhatsApp number checking (supports specific senderPhone & isolated userId)
async function handleApiCheckBulkPhones(req: any, res: any) {
  const rawList = req.body?.numbers || req.body?.phones;
  const senderPhoneParam = (req.body?.senderPhone || req.body?.fromPhone || req.body?.gatewayPhone || req.query?.senderPhone || req.query?.fromPhone || "") as string;
  const userIdParam = (req.body?.userId || req.query?.userId || "") as string;

  const resolved = resolveApiWhatsAppSession(senderPhoneParam, userIdParam);
  if (!resolved.session || !resolved.session.sock) {
    return res.status(400).json({
      success: false,
      error: resolved.error || "WhatsApp is not connected. Please connect your WhatsApp number first via /api/connect-whatsapp."
    });
  }

  if (!rawList || !Array.isArray(rawList) || rawList.length === 0) {
    return res.status(400).json({
      success: false,
      error: "An array of phone numbers ('numbers' or 'phones') is required in the request body."
    });
  }

  const sockToUse = resolved.session.sock;

  try {
    const normalizedList: { original: string; cleanPhone: string; jid: string }[] = [];
    const seen = new Set<string>();

    for (const phone of rawList) {
      if (phone === null || phone === undefined) continue;
      const strPhone = String(phone).trim();
      if (!strPhone) continue;

      const cleanPhone = normalizePhone(strPhone);
      if (!cleanPhone || cleanPhone.length < 5) continue;

      if (seen.has(cleanPhone)) continue;
      seen.add(cleanPhone);

      const jid = `${cleanPhone}@s.whatsapp.net`;
      normalizedList.push({
        original: strPhone,
        cleanPhone,
        jid
      });
    }

    if (normalizedList.length === 0) {
      return res.json({
        success: true,
        total: 0,
        checkedBy: resolved.senderPhone,
        userId: resolved.userId || undefined,
        goodCount: 0,
        badCount: 0,
        activeCount: 0,
        inactiveCount: 0,
        good: [],
        bad: [],
        active: [],
        inactive: [],
        exists: [],
        notExists: [],
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[Presence Bulk Checker] Starting batch query of ${normalizedList.length} numbers via +${resolved.senderPhone} (userId: ${resolved.userId || "default"}).`);

    const chunkSize = 50;
    const existsJids = new Set<string>();

    for (let i = 0; i < normalizedList.length; i += chunkSize) {
      const chunk = normalizedList.slice(i, i + chunkSize);
      const jidsToQuery = chunk.map(item => item.jid);

      let retryCount = 0;
      let querySuccess = false;

      while (retryCount < 2 && !querySuccess) {
        try {
          const result = await sockToUse.onWhatsApp(...jidsToQuery);
          if (result && Array.isArray(result)) {
            for (const item of result) {
              if (item.exists) {
                existsJids.add(item.jid);
                const cleanReturned = normalizePhone(String(item.jid || "").split(":")[0].split("@")[0]);
                if (cleanReturned) {
                  existsJids.add(`${cleanReturned}@s.whatsapp.net`);
                }
              }
            }
          }
          querySuccess = true;
        } catch (err: any) {
          retryCount++;
          console.warn(`[Presence Bulk Checker] Chunk query at index ${i} failed (attempt ${retryCount}/2):`, err?.message || err);
          if (retryCount >= 2) {
            for (const jid of jidsToQuery) {
              try {
                if (sockToUse) {
                  const result = await sockToUse.onWhatsApp(jid);
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

      if (i + chunkSize < normalizedList.length) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }

    const existsList: any[] = [];
    const notExistsList: any[] = [];
    const activePhones: string[] = [];
    const inactivePhones: string[] = [];

    for (const item of normalizedList) {
      if (existsJids.has(item.jid)) {
        existsList.push({
          phone: item.cleanPhone,
          jid: item.jid,
          original: item.original
        });
        activePhones.push(item.cleanPhone);
      } else {
        notExistsList.push({
          phone: item.cleanPhone,
          original: item.original
        });
        inactivePhones.push(item.cleanPhone);
      }
    }

    if (resolved.userId) {
      incrementApiUserChecks(resolved.userId, normalizedList.length);
    }

    console.log(`[Presence Bulk Checker] Completed via +${resolved.senderPhone}. Active(BAD): ${existsList.length}, Fresh(GOOD): ${notExistsList.length}`);

    return res.json({
      success: true,
      total: normalizedList.length,
      checkedBy: resolved.senderPhone,
      userId: resolved.userId || undefined,
      goodCount: inactivePhones.length,
      badCount: activePhones.length,
      activeCount: activePhones.length,
      inactiveCount: inactivePhones.length,
      good: inactivePhones,
      bad: activePhones,
      active: activePhones,
      inactive: inactivePhones,
      exists: existsList,
      notExists: notExistsList,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("Error in bulk check handler:", err);
    res.status(500).json({ success: false, error: err.message || "Failed to execute bulk presence query on WhatsApp." });
  }
}

app.post("/api/check-phone-bulk", async (req, res) => {
  await handleApiCheckBulkPhones(req, res);
});

app.post("/api/check-batch", async (req, res) => {
  await handleApiCheckBulkPhones(req, res);
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
    const targetPhone = normalizePhone(String(phone));
    const client = await getActiveTgClient(senderPhone);

    console.log(`[Telegram Check-Phone API] Checking +${targetPhone} using +${senderPhone}...`);

    try {
      const resolved: any = await client.invoke(new Api.contacts.ResolvePhone({ phone: "+" + targetPhone }));
      if (resolved && Array.isArray(resolved.users) && resolved.users.length > 0) {
        const user: any = resolved.users[0];
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
    } catch {}

    const result = await client.invoke(
      new Api.contacts.ImportContacts({
        contacts: [
          new Api.InputPhoneContact({
            clientId: Math.floor(Math.random() * 10000000) as any,
            phone: "+" + targetPhone,
            firstName: "TGUser",
            lastName: ""
          })
        ]
      })
    );

    if (result && result.users && result.users.length > 0) {
      const user: any = result.users[0];
      
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
        const firstName = user.firstName === "TGUser" ? "Telegram User" : (user.firstName || "");
        return res.json({
          exists: true,
          phone: user.phone || targetPhone,
          id: user.id ? user.id.toString() : "",
          firstName,
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

// NEW MULTI-ACCOUNT API ENDPOINTS FOR CLIENT UI & MULTI-USER ISOLATION
app.get("/api/accounts", (req, res) => {
  const rawUserId = (req.query.userId || "") as string;
  const cleanUserId = rawUserId.trim();
  const dbAccounts = getSavedAccountsList();
  const filtered = cleanUserId
    ? dbAccounts.filter(
        (acc) => String(acc.externalUserId) === cleanUserId || String(acc.addedByChatId) === cleanUserId
      )
    : dbAccounts;

  const results = filtered.map(acc => {
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
  const rawPhone = req.body?.phone || req.body?.senderPhone;
  const rawUserId = req.body?.userId;
  if (!rawPhone) {
    return res.status(400).json({ error: "Phone number is required." });
  }
  const phone = normalizePhone(String(rawPhone));
  const dbAccounts = getSavedAccountsList();
  const exists = dbAccounts.some(acc => acc.phone === phone);
  if (!exists) {
    return res.status(404).json({ error: "Account not found in local database." });
  }
  if (rawUserId) {
    upsertApiUserPhone(String(rawUserId), phone);
  }
  currentActivePhone = phone;
  updateGlobalSessionStateToSelectedActive();
  res.json({ success: true, currentActivePhone, userId: rawUserId || undefined });
});

function handleApiDeleteWhatsAppAccount(req: any, res: any) {
  const rawPhone = req.body?.phone || req.body?.senderPhone || req.query?.phone || req.query?.senderPhone;
  const rawUserId = req.body?.userId || req.query?.userId;
  if (!rawPhone) {
    return res.status(400).json({ success: false, error: "Phone number is required." });
  }
  const cleanPhone = normalizePhone(String(rawPhone));
  if (rawUserId) {
    removeApiUserPhone(cleanPhone, String(rawUserId));
  }
  const success = deleteAccountFromDb(cleanPhone);
  res.json({ success, phone: cleanPhone, userId: rawUserId || undefined });
}

app.post("/api/delete-account", (req, res) => {
  handleApiDeleteWhatsAppAccount(req, res);
});

app.post("/api/disconnect-whatsapp", (req, res) => {
  handleApiDeleteWhatsAppAccount(req, res);
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
