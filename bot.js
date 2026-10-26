/**
 * ============================================================================
 * LINKIFY - STANDALONE WHATSAPP & TELEGRAM BOT ENGINE (Node.js)
 * ============================================================================
 * এটি সম্পূর্ণ একটি একক (Single) Node.js ফাইল।
 * কোনো ওয়েবসাইট বা এক্সপ্রেস ছাড়া সরাসরি রান করতে পারেন:
 * Command: node bot.js
 * ============================================================================
 */

import express from "express";
import fs from "fs";
import path from "path";
import pino from "pino";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { initializeApp, cert, getApps, getApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// --- CONFIGURATION ---
export const TG_TOKEN = process.env.TG_TOKEN || "8847916537:AAFC_L4RgUgO_molInYI0FKhgpmVElhwFHY";
export const TG_API_URL = `https://api.telegram.org/bot${TG_TOKEN}`;
export const DB_FILE = path.join(process.cwd(), "db_accounts.json");
export const API_USERS_DB_FILE = path.join(process.cwd(), "db_api_users.json");
export const TG_DB_FILE = path.join(process.cwd(), "db_telegram_accounts.json");
export const USERS_DB_FILE = path.join(process.cwd(), "db_bot_users.json");
export const FIREBASE_KEY_FILE = path.join(process.cwd(), "firebase-service-account.json");
export const ADMIN_CHAT_ID = "8343010638";
export let firestoreDb = null;
export function getFirestoreDb() {
  return firestoreDb;
}
export const TG_API_ID = Number(process.env.TELEGRAM_API_ID || "2040");
export const TG_API_HASH = process.env.TELEGRAM_API_HASH || "b18441a1fff1153b5436ca404d41255e";

export const activeTgSessions = new Map();
export const adminTgWizard = new Map();

export const DEFAULT_TG_ACCOUNTS = [
  {
    phone: "923360688180",
    name: "Sam",
    username: "",
    session: "1BAAOMTQ5LjE1NC4xNjcuOTEAUA0XUuC0sR9QcKSD/nr4DbQNRgshev/WIvgzLy45i8UeoqHql35yU9dpkZS65HimmE37Mm6yJXv2XfiZwZarWMeDihIbMXJih7XMSMP5phRsCw8g+N03CP6mlgPzFlBORhFu/SzhvsJiZ82RkE/jw++78XJRIw73iE2caEH6v1ErgG0qcz79SQkcBPZLRkFzmaFOORvlJdQvbkn5fpK+Lywve+M+2oe6vmTHUpMnI6za9n/wqBI8A0jhjZ5+RrRKmzMKp2uzI3SjakJJ2XDWVDa2huS1tJPA5OZiazFWAo6Z4j/Rurab6FWg9yIdu4hEGYJnWrl9UQqYh3TDIl0tf34=",
    apiId: 31763326,
    apiHash: "21b699c4de6dfe44a29b6456ee456eb4",
    linkedAt: "2026-10-25T08:19:34.507Z",
    status: "connected"
  }
];

// --- IN-MEMORY RAM DATA OBJECTS (0ms latency, zero Firestore read cost) ---
let inMemoryTgAccounts = null;
let inMemoryUsers = null;
let inMemorySettings = {
  dollarRate: 125,
  currency: "BDT",
  methods: [
    { id: "bkash", name: "bKash Personal", number: "01700000000", status: "active" },
    { id: "nagad", name: "Nagad Personal", number: "01700000000", status: "active" },
    { id: "binance", name: "Binance Pay USDT", payId: "12345678", status: "active" }
  ]
};

// 1. ATOMIC LOCAL WRITE (Write to .tmp then rename atomically - zero chance of corrupted JSON)
function atomicWriteJson(filePath, data) {
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
export function syncFirebaseUsers(usersToSync) {
  if (!firestoreDb) return;
  const list = usersToSync || inMemoryUsers || [];
  (async () => {
    try {
      const batch = firestoreDb.batch();
      for (const u of list) {
        const ref = firestoreDb.collection("users").doc(String(u.chatId));
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
    } catch (err) {
      console.warn("[Firebase Save Error - Users]:", err?.message || err);
    }
  })();
}

export function syncFirebaseTgAccount(acc) {
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

export function deleteFirebaseTgAccount(phone) {
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

export function getSavedTgAccountsList() {
  if (inMemoryTgAccounts) return inMemoryTgAccounts;
  if (!fs.existsSync(TG_DB_FILE)) {
    inMemoryTgAccounts = [...DEFAULT_TG_ACCOUNTS];
    saveLocalTgDB();
    return inMemoryTgAccounts;
  }
  try {
    inMemoryTgAccounts = JSON.parse(fs.readFileSync(TG_DB_FILE, "utf-8"));
    return inMemoryTgAccounts || [];
  } catch {
    inMemoryTgAccounts = [];
    return [];
  }
}

export function saveTgAccountToDb(phone, name, username, session, apiId = TG_API_ID, apiHash = TG_API_HASH) {
  const accounts = getSavedTgAccountsList();
  const idx = accounts.findIndex((a) => a.phone === phone);
  const targetAcc = {
    phone,
    name,
    username,
    session,
    apiId,
    apiHash,
    linkedAt: new Date().toISOString(),
    status: "connected"
  };

  if (idx > -1) {
    accounts[idx] = targetAcc;
  } else {
    accounts.push(targetAcc);
  }

  inMemoryTgAccounts = accounts;
  saveLocalTgDB();
  syncFirebaseTgAccount(targetAcc);
}

export async function getActiveTgClient(phone) {
  const existing = activeTgSessions.get(phone);
  if (existing && existing.client && existing.client.connected) {
    return existing.client;
  }
  const accounts = getSavedTgAccountsList();
  const acc = accounts.find((a) => a.phone === phone);
  if (!acc || !acc.session) {
    throw new Error(`Telegram session not found for +${phone}`);
  }
  const useApiId = Number(acc.apiId) || TG_API_ID;
  const useApiHash = acc.apiHash || TG_API_HASH;
  const client = new TelegramClient(new StringSession(acc.session), useApiId, useApiHash, {
    connectionRetries: 3
  });
  await client.connect();
  activeTgSessions.set(phone, { client, status: "connected" });
  return client;
}

export function updateTgAccountCredentialsInDb(phone, newApiId, newApiHash) {
  const accounts = getSavedTgAccountsList();
  const idx = accounts.findIndex((a) => a.phone === phone);
  if (idx === -1) return null;
  if (newApiId !== undefined) accounts[idx].apiId = newApiId;
  if (newApiHash !== undefined) accounts[idx].apiHash = newApiHash;

  inMemoryTgAccounts = accounts;
  saveLocalTgDB();
  syncFirebaseTgAccount(accounts[idx]);

  const existing = activeTgSessions.get(phone);
  if (existing?.client) {
    try { existing.client.disconnect(); } catch {}
    activeTgSessions.delete(phone);
  }
  getActiveTgClient(phone).catch(() => {});
  return accounts[idx];
}

export function deleteTgAccountFromDb(phone) {
  const session = activeTgSessions.get(phone);
  if (session?.client) {
    try { session.client.disconnect(); } catch {}
  }
  activeTgSessions.delete(phone);
  const accounts = getSavedTgAccountsList();
  const filtered = accounts.filter((a) => a.phone !== phone);
  const existed = accounts.length !== filtered.length;

  inMemoryTgAccounts = filtered;
  saveLocalTgDB();
  deleteFirebaseTgAccount(phone);

  return existed;
}

// ==========================================
// Premium Emoji Database & Utilities (All-in-One)
// ==========================================
export const PEM = {
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

export const GLOBAL_BODY_EMOJIS = {
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

export function pem(key) {
  return PEM[key] || "";
}

export function applyPremiumEmojis(rawText) {
  if (!rawText) return "";
  if (rawText.includes("LIVE WS NUMBER CHECKER") || rawText.includes("LIVE TG NUMBER CHECKER")) {
    return rawText;
  }
  const existingTags = [];
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

export function formatTelegramHtml(text) {
  if (!text) return "";
  const savedTags = [];
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

// --- IN-MEMORY SESSION STATES ---
const activeSessions = new Map();
let currentActivePhone = null;
const linkingOwners = new Map();

// --- PHONE NUMBER NORMALIZATION ---
export function normalizePhone(raw) {
  let clean = String(raw).replace(/\D/g, "");
  if (!clean) return "";

  // Bangladeshi phone normalization
  if (clean.startsWith("0") && clean.length === 11) {
    clean = "88" + clean;
  } else if (clean.startsWith("1") && clean.length === 10) {
    clean = "880" + clean;
  }

  // Strip extra leading zero from national part for known international country codes
  const commonCodes = [
    "880", "91", "92", "977", "94", "960", "93", "966", "971", "1", "44", "968", "974", "965", "964",
    "962", "961", "967", "60", "65", "81", "82", "62", "63", "66", "84", "95", "855", "52", "55", "54",
    "57", "51", "56", "39", "34", "33", "49", "90", "31", "32", "41", "46", "351", "30", "43", "48", "7",
    "61", "64", "27", "20", "234", "254", "212"
  ];
  commonCodes.sort((a, b) => b.length - a.length);

  for (const cc of commonCodes) {
    if (clean.startsWith(cc)) {
      let national = clean.substring(cc.length);
      while (national.startsWith("0")) {
        national = national.substring(1);
      }
      clean = `${cc}${national}`;
      break;
    }
  }

  return clean;
}

export function extractPhoneNumbers(rawText) {
  if (!rawText) return [];
  const results = [];
  const seen = new Set();

  const addCandidate = (raw) => {
    const digitsOnly = String(raw).replace(/\D/g, "");
    if (digitsOnly.length < 8 || digitsOnly.length > 15) return;
    const clean = normalizePhone(digitsOnly);
    if (clean && clean.length >= 8 && clean.length <= 15 && !seen.has(clean)) {
      seen.add(clean);
      results.push(clean);
    }
  };

  const formattedMatches = String(rawText).match(/(?:\+?\d[\d\s\-().]{6,18}\d)/g);
  if (formattedMatches) {
    for (const m of formattedMatches) {
      addCandidate(m);
    }
  }

  const contiguousMatches = String(rawText).match(/(\+?[0-9]{8,15})/g);
  if (contiguousMatches) {
    for (const m of contiguousMatches) {
      addCandidate(m);
    }
  }

  return results;
}

// --- LOCAL DATABASE HELPERS (MULTI-USER & PER-NUMBER ISOLATED) ---
export function getApiUsersList() {
  if (!fs.existsSync(API_USERS_DB_FILE)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(API_USERS_DB_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export function saveApiUsersList(users) {
  try {
    fs.writeFileSync(API_USERS_DB_FILE, JSON.stringify(users, null, 2), "utf-8");
  } catch (e) {}
}

export function upsertApiUserPhone(userId, phone, name = "API User", apiKey = undefined) {
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

export function removeApiUserPhone(phone, userId = undefined) {
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

export function incrementApiUserChecks(userId, count) {
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

export function getSavedAccountsList() {
  let accounts = [];
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        accounts = parsed;
      }
    } catch (e) {}
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
            if (isRegistered && !accounts.some((a) => a.phone === phone)) {
              const discoveredName = creds?.me?.name || "WhatsApp User";
              const pendingOwner = linkingOwners.get(phone);
              accounts.push({
                phone,
                name: discoveredName,
                linkedAt: new Date().toISOString(),
                addedByChatId: pendingOwner?.chatId ?? 8343010638,
                addedByName: pendingOwner?.name || discoveredName,
                externalUserId: pendingOwner?.externalUserId,
                apiKey: pendingOwner?.apiKey,
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

export function saveAccountToDb(phone, name, addedByChatId, addedByName, externalUserId, apiKey) {
  const accounts = getSavedAccountsList();
  const existingIdx = accounts.findIndex((acc) => acc.phone === phone);
  const cleanName = name || "WhatsApp User";

  if (existingIdx > -1) {
    accounts[existingIdx].name = cleanName;
    accounts[existingIdx].linkedAt = new Date().toISOString();
    if (addedByChatId !== undefined) accounts[existingIdx].addedByChatId = addedByChatId;
    if (addedByName !== undefined) accounts[existingIdx].addedByName = addedByName;
    if (externalUserId !== undefined) accounts[existingIdx].externalUserId = externalUserId;
    if (apiKey !== undefined) accounts[existingIdx].apiKey = apiKey;
  } else {
    accounts.push({
      phone,
      name: cleanName,
      linkedAt: new Date().toISOString(),
      addedByChatId,
      addedByName,
      externalUserId,
      apiKey,
    });
  }

  if (externalUserId) {
    upsertApiUserPhone(externalUserId, phone, addedByName || cleanName, apiKey);
  }

  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(accounts, null, 2), "utf-8");
    console.log(`[DB] Account +${phone} saved to ${DB_FILE}`);
  } catch (e) {
    console.error("[DB] Failed saving account:", e);
  }
}

export function deleteAccountFromDb(phone) {
  const session = activeSessions.get(phone);
  if (session && session.sock) {
    try {
      session.sock.end(undefined);
    } catch (e) {}
    activeSessions.delete(phone);
  }

  const authDir = path.join(process.cwd(), `whatsapp_auth_session_${phone}`);
  if (fs.existsSync(authDir)) {
    try {
      fs.rmSync(authDir, { recursive: true, force: true });
    } catch (e) {}
  }

  removeApiUserPhone(phone);

  const accounts = getSavedAccountsList();
  const filtered = accounts.filter((acc) => acc.phone !== phone);
  const existed = accounts.length !== filtered.length;

  if (existed) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(filtered, null, 2), "utf-8");
    } catch (e) {}
  }

  if (currentActivePhone === phone) {
    currentActivePhone = filtered.length > 0 ? filtered[0].phone : null;
  }

  return existed;
}

export function resolveApiWhatsAppSession(rawSenderPhone, rawUserId) {
  const cleanSender = rawSenderPhone ? normalizePhone(String(rawSenderPhone)) : "";
  const cleanUserId = rawUserId ? String(rawUserId).trim() : "";
  const savedAccounts = getSavedAccountsList();

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
          error: `WhatsApp number +${cleanSender} does not belong to userId '${cleanUserId}'.`,
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
      error: `WhatsApp number +${cleanSender} is not connected. Please link this number first via /api/connect-whatsapp.`,
    };
  }

  if (cleanUserId) {
    const apiUsers = getApiUsersList();
    const userRec = apiUsers.find((u) => String(u.userId) === cleanUserId);
    const candidatePhones = new Set();

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
      error: `No active WhatsApp account connected for userId '${cleanUserId}'. Please link a WhatsApp number first via /api/connect-whatsapp.`,
    };
  }

  if (currentActivePhone && activeSessions.has(currentActivePhone)) {
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
    error: "No WhatsApp account is currently connected. Please link a WhatsApp number first via /api/connect-whatsapp.",
  };
}

// --- TELEGRAM BOT API HELPERS ---
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
    } catch (err) {
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
    } catch (err) {
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
    } catch (e) {
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
          const restored = [];
          usersSnap.forEach(d => restored.push(d.data()));
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
          const restoredTg = [];
          tgSnap.forEach(d => restoredTg.push(d.data()));
          if (restoredTg.length > 0) {
            inMemoryTgAccounts = restoredTg;
            saveLocalTgDB();
            console.log(`✅ Restored ${restoredTg.length} TG accounts from Firestore to Local DB!`);
          }
        }
      }
    } catch (err) {
      console.warn("❌ Firebase Startup Sync Warning:", err.message);
    }
  }
}

// Auto-run loadDB on initialization
loadDB().catch(e => console.warn("[loadDB] Error on startup:", e));

export async function syncAllDataToFirestore() {
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

export async function initFirebaseWithServiceAccount(serviceAccountObj) {
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

    initializeApp({ credential: cert(serviceAccountObj) });
    firestoreDb = getFirestore();

    await syncAllDataToFirestore();

    return {
      success: true,
      projectId: serviceAccountObj.project_id,
      clientEmail: serviceAccountObj.client_email || "service-account"
    };
  } catch (err) {
    console.error("[Firebase Firestore] Init error:", err);
    return { success: false, error: err.message || String(err) };
  }
}

export function getBotUsersList() {
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

export function saveBotUsersList(users) {
  inMemoryUsers = users;
  saveLocalUsersDB();
  syncFirebaseUsers(users);
}

export function trackBotUser(chatId, fromObj) {
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
    const newUser = {
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

export function setBotUserPackage(targetChatId, isPremium, packageName = "Premium API") {
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

export function getMainMenuKeyboard(chatId) {
  const rows = [
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
const userMenuMode = new Map();
// Track active admin broadcast mode
const adminBroadcastActive = new Set();
// Track active admin firebase upload mode
const adminFirebaseUploadActive = new Set();

export function getUserMenuMode(chatId) {
  const key = String(chatId);
  if (userMenuMode.has(key)) {
    return userMenuMode.get(key);
  }
  const users = getBotUsersList();
  const u = users.find((item) => String(item.chatId) === key);
  if (u?.menuMode) {
    userMenuMode.set(key, u.menuMode);
    return u.menuMode;
  }
  return undefined;
}

export function setUserMenuMode(chatId, mode) {
  const key = String(chatId);
  if (mode) {
    userMenuMode.set(key, mode);
  } else {
    userMenuMode.delete(key);
  }
  const users = getBotUsersList();
  const idx = users.findIndex((item) => String(item.chatId) === key);
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
  const rows = [
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

export function getTgAccountDetailKeyboard(phone) {
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

export function getTgCheckerDashboardText() {
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

export function getTgAccountDetailText(phone) {
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

export function generateApiDocumentationContent() {
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

export function getManagePackageDashboardText() {
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

export function getAdminPanelDashboardText() {
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

export async function handleTelegramCallbackQuery(call) {
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

export async function sendTelegramMessage(chatId, text, parseMode = "HTML", replyMarkup = null) {
  try {
    const formattedText = formatTelegramHtml(text);
    const activeMode = getUserMenuMode(chatId);
    const defaultMarkup = activeMode ? BACK_MENU_KB : getMainMenuKeyboard(chatId);
    const finalMarkup = replyMarkup === false
      ? null
      : ((!replyMarkup || replyMarkup === MAIN_MENU_KB)
        ? (replyMarkup === MAIN_MENU_KB ? getMainMenuKeyboard(chatId) : defaultMarkup)
        : replyMarkup);

    const payload = {
      chat_id: chatId,
      text: formattedText,
      parse_mode: "HTML"
    };
    if (finalMarkup) {
      payload.reply_markup = finalMarkup;
    }
    const res = await fetch(`${TG_API_URL}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      return data.result?.message_id || null;
    } else {
      const errText = await res.text();
      console.warn("[Telegram] HTML sendMessage failed, falling back:", res.status, errText);
      const fallbackPayload = {
        chat_id: chatId,
        text,
      };
      if (finalMarkup) fallbackPayload.reply_markup = finalMarkup;
      const fbRes = await fetch(`${TG_API_URL}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        return fbData.result?.message_id || null;
      }
    }
  } catch (err) {
    console.error("[Telegram] Error sending message:", err);
  }
  return null;
}

export async function editTelegramMessage(chatId, messageId, text, parseMode = "HTML", replyMarkup = null) {
  try {
    const formattedText = formatTelegramHtml(text);
    const inlineMarkup = replyMarkup && replyMarkup.inline_keyboard ? replyMarkup : null;
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text: formattedText,
      parse_mode: "HTML",
    };
    if (inlineMarkup) {
      payload.reply_markup = inlineMarkup;
    }
    const res = await fetch(`${TG_API_URL}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text();
      if (errText.includes("message is not modified")) {
        return;
      }
      if (errText.includes("message can't be edited") || errText.includes("message to edit not found")) {
        await sendTelegramMessage(chatId, text, parseMode, replyMarkup);
        return;
      }
      console.warn("[Telegram] HTML editMessageText failed, retrying plain:", res.status, errText);
      const fallbackPayload = {
        chat_id: chatId,
        message_id: messageId,
        text,
      };
      if (inlineMarkup) fallbackPayload.reply_markup = inlineMarkup;
      const fbRes = await fetch(`${TG_API_URL}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
      if (!fbRes.ok) {
        await sendTelegramMessage(chatId, text, parseMode, replyMarkup);
      }
    }
  } catch (err) {
    console.error("[Telegram] Error editing message:", err);
  }
}

export async function answerTelegramCallbackQuery(callbackQueryId, text = null, showAlert = false) {
  try {
    const payload = {
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
    console.error("[Telegram] Error answering callback query:", err);
  }
}

export async function sendTelegramDocument(chatId, fileContent, fileName, caption) {
  try {
    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append("caption", formatTelegramHtml(caption));
    formData.append("parse_mode", "HTML");
    const blob = new Blob([fileContent], { type: "text/plain" });
    formData.append("document", blob, fileName);

    const res = await fetch(`${TG_API_URL}/sendDocument`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      console.error("[Telegram] sendDocument failed:", await res.text());
    }
  } catch (err) {
    console.error("[Telegram] Error sending document:", err);
  }
}

// --- WHATSAPP BAILEYS ENGINE ---
export async function initWhatsApp(phoneNumber, isReconnect = false) {
  try {
    console.log(`[WhatsApp] Connecting: +${phoneNumber} (Reconnect: ${isReconnect})`);

    const existing = activeSessions.get(phoneNumber);
    if (existing?.sock) {
      try {
        existing.sock.end(undefined);
      } catch (e) {}
    }

    const authDir = `whatsapp_auth_session_${phoneNumber}`;
    if (!isReconnect && fs.existsSync(authDir)) {
      try {
        fs.rmSync(authDir, { recursive: true, force: true });
      } catch (e) {}
    }

    activeSessions.set(phoneNumber, {
      phoneNumber,
      sock: null,
      status: "connecting",
      pairingCode: "",
      profile: null,
      error: null,
    });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    let version = [2, 3000, 1035194821];
    try {
      const fetched = await fetchLatestBaileysVersion();
      if (fetched?.version) version = fetched.version;
    } catch (e) {}

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      browser: ["Ubuntu", "Chrome", "20.0.04"],
    });

    const sessRef = activeSessions.get(phoneNumber);
    if (sessRef) sessRef.sock = sock;

    sock.ev.on("creds.update", async () => {
      await saveCreds();
      try {
        const creds = sock.authState?.creds;
        if (creds && (creds.registered || creds.account || creds.me?.id)) {
          const owner = linkingOwners.get(phoneNumber);
          const profileName = sock.user?.name || creds.me?.name || "WhatsApp User";
          saveAccountToDb(phoneNumber, profileName, owner?.chatId, owner?.name, owner?.externalUserId, owner?.apiKey);
        }
      } catch {}
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;
      console.log(`[WhatsApp Update] +${phoneNumber} => ${connection}`);

      const sess = activeSessions.get(phoneNumber);
      if (!sess) return;

      if (connection === "connecting") {
        if (sess.status !== "pairing-code-ready" && sess.status !== "connected") {
          sess.status = "connecting";
        }
      } else if (connection === "open") {
        sess.status = "connected";
        const cleanJid = sock.user?.id?.split("@")[0] || "";
        sess.profile = {
          name: sock.user?.name || "WhatsApp User",
          phone: cleanJid.split(":")[0],
        };
        console.log(`✅ [WhatsApp Connected] +${phoneNumber} as "${sess.profile.name}"`);

        const owner = linkingOwners.get(phoneNumber);
        saveAccountToDb(phoneNumber, sock.user?.name || "", owner?.chatId, owner?.name, owner?.externalUserId, owner?.apiKey);

        if (owner?.chatId) {
          sendTelegramMessage(
            owner.chatId,
            `🎉 *WhatsApp Linked Successfully!* \n\nYour WhatsApp account (+${phoneNumber}) has been connected and linked to your Telegram account.`
          );
        }
      } else if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        console.log(`[WhatsApp Closed] +${phoneNumber}, Reason code: ${statusCode}`);
        if (loggedOut) {
          sess.status = "disconnected";
          sess.error = "Logged out from device";
          deleteAccountFromDb(phoneNumber);
        } else {
          sess.status = "connecting";
          setTimeout(() => {
            if (activeSessions.has(phoneNumber)) {
              initWhatsApp(phoneNumber, true);
            }
          }, 3000);
        }
      }
    });

    // Request Pairing Code if not registered
    setTimeout(async () => {
      try {
        const sess = activeSessions.get(phoneNumber);
        if (!sess) return;

        if (!sock.authState.creds.registered && !isReconnect) {
          console.log(`[WhatsApp] Requesting Pairing Code for: +${phoneNumber}`);
          const rawCode = await sock.requestPairingCode(phoneNumber);
          let formattedCode = rawCode;
          if (rawCode && rawCode.length === 8) {
            formattedCode = `${rawCode.substring(0, 4)}-${rawCode.substring(4)}`;
          }

          sess.status = "pairing-code-ready";
          sess.pairingCode = formattedCode;
          console.log(`🔑 [Pairing Code] +${phoneNumber} => ${formattedCode}`);
        }
      } catch (err) {
        console.error(`[WhatsApp Pairing Error] +${phoneNumber}:`, err.message || err);
        const sess = activeSessions.get(phoneNumber);
        if (sess) {
          sess.status = "error";
          sess.error = err.message || "Failed to generate pairing code.";
        }
      }
    }, 2000);
  } catch (err) {
    console.error(`[WhatsApp Init Error] +${phoneNumber}:`, err);
  }
}

// Check single number on WhatsApp using Web App's JID system
export async function checkWhatsAppNumber(phoneToCheck, gatewayPhone = null) {
  let resolvedSock = null;

  if (gatewayPhone && activeSessions.has(gatewayPhone)) {
    const s = activeSessions.get(gatewayPhone);
    if (s.status === "connected" && s.sock) resolvedSock = s.sock;
  }

  if (!resolvedSock && currentActivePhone && activeSessions.has(currentActivePhone)) {
    const s = activeSessions.get(currentActivePhone);
    if (s.status === "connected" && s.sock) resolvedSock = s.sock;
  }

  if (!resolvedSock) {
    for (const [, s] of activeSessions) {
      if (s.status === "connected" && s.sock) {
        resolvedSock = s.sock;
        break;
      }
    }
  }

  if (!resolvedSock) {
    throw new Error("কোনো সক্রিয় হোয়াটসঅ্যাপ অ্যাকাউন্ট সংযুক্ত নেই! দয়া করে প্রথমে /login করুন।");
  }

  const clean = normalizePhone(phoneToCheck);
  const jid = `${clean}@s.whatsapp.net`;
  try {
    const result = await resolvedSock.onWhatsApp(jid);
    const exists = Boolean(result && result.length > 0 && result[0].exists);
    return {
      phone: clean,
      exists,
      jid: exists ? (result[0].jid || jid) : null,
    };
  } catch (err) {
    console.error(`[Check Error] ${jid}:`, err.message || err);
    return { phone: clean, exists: false, jid: null };
  }
}

// Bulk check batch handler using Web App's JID chunking system
export async function checkAndRespondBatch(chatId, rawNumbers, fromFile = false) {
  let resolvedSession = null;
  const saved = getSavedAccountsList();
  const myAccounts = saved.filter(
    (acc) =>
      String(acc.addedByChatId) === String(chatId) ||
      String(linkingOwners.get(acc.phone)?.chatId) === String(chatId)
  );

  for (const acc of myAccounts) {
    const s = activeSessions.get(acc.phone);
    if (s && s.status === "connected" && s.sock) {
      resolvedSession = s;
      break;
    }
  }

  if (!resolvedSession) {
    for (const [phone, owner] of linkingOwners.entries()) {
      if (String(owner.chatId) === String(chatId)) {
        const s = activeSessions.get(phone);
        if (s && s.status === "connected" && s.sock) {
          resolvedSession = s;
          break;
        }
      }
    }
  }

  if (!resolvedSession) {
    await sendTelegramMessage(
      chatId,
      "⚠️ *You have not connected your WhatsApp account yet!* \n\n" +
        "To check WhatsApp numbers, please connect your own WhatsApp account first by tapping *CONNECT WS CHECKER* or using:\n" +
        "`/login 8801700000000`"
    );
    return;
  }

  const normalizedList = [];
  const seen = new Set();
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

  const activeWA = [];
  const inactiveWA = [];
  const chunkSize = 50;

  for (let i = 0; i < normalizedList.length; i += chunkSize) {
    const chunk = normalizedList.slice(i, i + chunkSize);
    const jidsToQuery = chunk.map((num) => `${num}@s.whatsapp.net`);
    const jidToNumMap = new Map();
    chunk.forEach((num) => jidToNumMap.set(`${num}@s.whatsapp.net`, num));

    const chunkExists = new Set();
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
          break;
        }
      } catch (e) {
        retryCount++;
        if (retryCount >= 2) {
          for (const jid of jidsToQuery) {
            try {
              if (resolvedSession && resolvedSession.sock) {
                const result = await resolvedSession.sock.onWhatsApp(jid);
                if (result && Array.isArray(result) && result[0]?.exists) {
                  chunkExists.add(jid);
                }
              }
              await new Promise((r) => setTimeout(r, 80));
            } catch {}
          }
          querySuccess = true;
        } else {
          await new Promise((resolve) => setTimeout(resolve, 800));
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

    if (normalizedList.length > 50 && progressMsgId) {
      const doneCount = Math.min(i + chunkSize, normalizedList.length);
      const pct = Math.round((doneCount / normalizedList.length) * 100);
      await editTelegramMessage(
        chatId,
        progressMsgId,
        `<tg-emoji emoji-id="5337172996211648018">⏳</tg-emoji> 𝙿𝚛𝚘𝚌𝚌𝚎𝚜𝚜𝚒𝚗𝚐 𝚢𝚘𝚞𝚛 𝚛𝚎𝚚𝚞𝚎𝚜𝚝 (${doneCount}/${normalizedList.length} - ${pct}%)`
      );
    }

    if (i + chunkSize < normalizedList.length) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

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
    const activeText = activeWA.map((x) => `+${x}`).join("\n");
    const inactiveText = inactiveWA.map((x) => `+${x}`).join("\n");

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

// Document file handler (.txt/.csv)
export async function handleTelegramDocument(chatId, doc, captionText = "") {
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

  const fileId = doc.file_id;
  const fileName = doc.file_name || "numbers.txt";
  const isTgMode = activeMode === "check_tg";

  await sendTelegramMessage(
    chatId,
    `⏳ Processing <b>${fileName}</b>... Extracting phone numbers for ${isTgMode ? "Telegram" : "WhatsApp"} check.`,
    "HTML"
  );

  try {
    const fileInfoRes = await fetch(`${TG_API_URL}/getFile?file_id=${fileId}`);
    if (!fileInfoRes.ok) throw new Error("getFile failed");
    const fileInfo = await fileInfoRes.json();
    const filePath = fileInfo?.result?.file_path;
    if (!filePath) throw new Error("Could not obtain file path");

    const downloadUrl = `https://api.telegram.org/file/bot${TG_TOKEN}/${filePath}`;
    const dlRes = await fetch(downloadUrl);
    if (!dlRes.ok) throw new Error("Failed downloading file from Telegram");

    const fileText = await dlRes.text();
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
  } catch (err) {
    console.error("[Telegram Doc Error]:", err);
    await sendTelegramMessage(chatId, `❌ An error occurred while processing the file: ${err.message || err}`);
  }
}

async function startWhatsAppPairingForChat(chatId, rawPhoneInput, senderName) {
  const clean = normalizePhone(rawPhoneInput);
  if (clean.length < 8) {
    await sendTelegramMessage(chatId, "⚠️ Invalid phone number format. Example: `8801700000000`", "Markdown", BACK_MENU_KB);
    return;
  }

  const processingMsgId = await sendTelegramMessage(
    chatId,
    `<tg-emoji emoji-id="5337172996211648018">⏳</tg-emoji> 𝙿𝚛𝚘𝚌𝚌𝚎𝚜𝚜𝚒𝚗𝚐 𝚢𝚘𝚞𝚛 𝚛𝚎𝚚𝚞𝚎𝚜𝚝`,
    "HTML",
    false
  );

  linkingOwners.set(clean, { chatId, name: senderName });
  currentActivePhone = clean;

  await initWhatsApp(clean, false);

  const maskedPhone = clean.length > 7
    ? `${clean.slice(0, 3)}****${clean.slice(-4)}`
    : clean;

  let counter = 0;
  const maxWait = 20;
  const checkTimer = setInterval(async () => {
    counter++;
    const sess = activeSessions.get(clean);

    if (sess && sess.status === "pairing-code-ready" && sess.pairingCode) {
      clearInterval(checkTimer);
      const codeMsg =
        `✅ Device Pairing Code Sent Successfully!\n\n` +
        `📞 Number : ${maskedPhone}\n\n` +
        `💬 Pairing Code : <code>${sess.pairingCode}</code>`;
      const codeInlineKb = {
        inline_keyboard: [
          [
            {
              text: `${sess.pairingCode}`,
              icon_custom_emoji_id: "5429612632430654504",
              copy_text: { text: sess.pairingCode.replace(/-/g, "") },
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
    } else if (sess && sess.status === "error") {
      clearInterval(checkTimer);
      const errMsg = `❌ Failed to generate pairing code: ${sess.error || "Server did not respond"}`;
      if (processingMsgId) {
        await editTelegramMessage(chatId, processingMsgId, errMsg, "HTML");
      } else {
        await sendTelegramMessage(chatId, errMsg, "HTML", BACK_MENU_KB);
      }
    } else if (counter >= maxWait) {
      clearInterval(checkTimer);
      const timeoutMsg = `⏳ Code generation is taking a moment. Please check in 30 seconds using <code>/status</code>.`;
      if (processingMsgId) {
        await editTelegramMessage(chatId, processingMsgId, timeoutMsg, "HTML");
      } else {
        await sendTelegramMessage(chatId, timeoutMsg, "HTML", BACK_MENU_KB);
      }
    }
  }, 1000);
}

// Telegram Message Dispatcher
export async function handleTelegramMessage(message) {
  const chatId = message.chat?.id;
  if (!chatId) return;
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
    const targetChatIds = Array.from(new Set(users.map((u) => u.chatId))).filter(
      (id) => id && String(id) !== "0" && String(id) !== chatKey
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
      await new Promise((r) => setTimeout(r, 40));
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

    let parsedJson = null;

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
      } catch (fErr) {
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
      } catch (tErr) {
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

  if (message.document) {
    await handleTelegramDocument(chatId, message.document, message.caption || "");
    return;
  }

  const text = (message.text || "").trim();
  if (!text) return;

  // /start
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
      `⚡ *BUY WS AND TG API*\n\n` +
      `🌐 *API Base URL:*\n` +
      `\`https://dxazone-checker.125.zero-bot.org\`\n\n` +
      `🔹 *Multi-User & Per-Number API Endpoints:*\n` +
      `▫️ \`POST /api/connect-whatsapp\` - Link user's WS & get 8-digit code\n` +
      `▫️ \`GET /api/user-status?userId=...\` - Check user's connected WS numbers\n` +
      `▫️ \`GET /api/check-phone?phone=...&senderPhone=...&userId=...\` - Single check via specific number/user\n` +
      `▫️ \`POST /api/check-batch\` - Bulk check via specific number/user\n` +
      `▫️ \`POST /api/disconnect-whatsapp\` - Remove a user's WS number\n\n` +
      `💎 *Features:*\n` +
      `▫️ Per-user isolated database (\`userId\` & \`senderPhone\`)\n` +
      `▫️ Each user in your bot/site can add their own WhatsApp & check numbers independently\n\n` +
      `📥 Tap below to download the full API Documentation or contact Admin:`;
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
      (a) =>
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

  // /login <phone>
  if (text.startsWith("/login")) {
    const raw = text.substring(6).trim();
    if (!raw) {
      await sendTelegramMessage(chatId, "⚠️ Please provide a phone number. Example: `8801700000000`");
      return;
    }
    const senderName = message.from?.first_name || message.chat?.first_name || "Telegram User";
    await startWhatsAppPairingForChat(chatId, raw, senderName);
    return;
  }

  // /status
  if (text.startsWith("/status")) {
    const saved = getSavedAccountsList();
    const myAccounts = saved.filter((acc) => String(acc.addedByChatId) === String(chatId));
    const isAdmin = String(chatId) === ADMIN_CHAT_ID;
    const otherAccounts = isAdmin ? saved.filter((acc) => String(acc.addedByChatId) !== String(chatId)) : [];

    if (myAccounts.length === 0 && otherAccounts.length === 0) {
      await sendTelegramMessage(chatId, "ℹ️ You have not linked any WhatsApp account yet. Tap *CONNECT WS CHECKER* and send your phone number to connect.");
      return;
    }

    let statusMsg = `📊 *WhatsApp Connection Status:*\n\n`;
    if (myAccounts.length > 0) {
      statusMsg += `👤 *Your Linked Accounts (${myAccounts.length}):*\n`;
      myAccounts.forEach((acc, idx) => {
        const s = activeSessions.get(acc.phone);
        const isOnline = s?.status === "connected";
        const icon = isOnline ? "🟢 Connected" : "🔴 Offline";
        statusMsg += `${idx + 1}. *+${acc.phone}* (${acc.name || "WhatsApp User"})\n   Status: ${icon}\n`;
      });
    } else {
      statusMsg += `⚠️ *No personal WhatsApp account linked yet.*\nTap *CONNECT WS CHECKER* to link your WhatsApp.\n`;
    }

    if (isAdmin && otherAccounts.length > 0) {
      statusMsg += `\n👥 *Other Users' Accounts (${otherAccounts.length}):*\n`;
      otherAccounts.forEach((acc, idx) => {
        const s = activeSessions.get(acc.phone);
        const isOnline = s?.status === "connected";
        const icon = isOnline ? "🟢 Online" : "🔴 Offline";
        statusMsg += `${idx + 1}. *+${acc.phone}* (Added by: ${acc.addedByName || "User"})\n   Status: ${icon}\n`;
      });
    }

    await sendTelegramMessage(chatId, statusMsg);
    return;
  }

  // /logout <phone>
  if (text.startsWith("/logout")) {
    const raw = text.substring(7).trim();
    if (!raw) {
      await sendTelegramMessage(chatId, "⚠️ Please provide a phone number. Example: `/logout 8801700000000`");
      return;
    }

    const clean = normalizePhone(raw);
    const saved = getSavedAccountsList();
    const targetAcc = saved.find((a) => a.phone === clean);
    const isAdmin = String(chatId) === ADMIN_CHAT_ID;

    if (!targetAcc || (!isAdmin && String(targetAcc.addedByChatId) !== String(chatId))) {
      await sendTelegramMessage(chatId, `⚠️ *+${clean}* was not found in your linked accounts.`);
      return;
    }

    const deleted = deleteAccountFromDb(clean);
    if (deleted) {
      await sendTelegramMessage(chatId, `✅ *+${clean}* has been disconnected and removed from your account.`);
    } else {
      await sendTelegramMessage(chatId, `⚠️ *+${clean}* was not found in the database.`);
    }
    return;
  }

  // /checktg <phone>
  if (text.startsWith("/checktg")) {
    const raw = text.substring(8).trim();
    const extracted = extractPhoneNumbers(raw);
    if (extracted.length === 0) {
      await sendTelegramMessage(chatId, "⚠️ Please provide a phone number to check on Telegram. Example: `/checktg 8801712345678`");
      return;
    }
    await checkAndRespondTgBatch(chatId, extracted, false);
    return;
  }

  // /check <phone>
  if (text.startsWith("/check")) {
    const raw = text.substring(6).trim();
    const extracted = extractPhoneNumbers(raw);
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
      } catch (err) {
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
            phoneCodeHash: wiz.phoneCodeHash,
            phoneCode: cleanCode
          })
        );
        const me = await wiz.client.getMe();
        const sessionStr = String(wiz.client.session.save());
        saveTgAccountToDb(
          wiz.phone,
          me?.firstName || "Telegram User",
          me?.username || "",
          sessionStr,
          wiz.apiId || TG_API_ID,
          wiz.apiHash || TG_API_HASH
        );
        activeTgSessions.set(wiz.phone, { client: wiz.client, status: "connected" });
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
      } catch (err) {
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
            onError: (e) => { throw e; }
          }
        );
        const me = await wiz.client.getMe();
        const sessionStr = String(wiz.client.session.save());
        saveTgAccountToDb(
          wiz.phone,
          me?.firstName || "Telegram User",
          me?.username || "",
          sessionStr,
          wiz.apiId || TG_API_ID,
          wiz.apiHash || TG_API_HASH
        );
        activeTgSessions.set(wiz.phone, { client: wiz.client, status: "connected" });
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
      } catch (err) {
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
      await checkAndRespondBatch(chatId, extractedNumbers);
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

export async function checkAndRespondTgBatch(chatId, rawNumbers, fromFile = false) {
  const tgAccounts = getSavedTgAccountsList();
  const candidatePhones = [];

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

  const normalizedList = [];
  const seen = new Set();
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

  let client = null;
  let senderPhone = "";
  let lastConnectErr = "";

  for (const ph of candidatePhones) {
    try {
      client = await getActiveTgClient(ph);
      senderPhone = ph;
      break;
    } catch (err) {
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

  const activeTG = [];
  const inactiveTG = [];
  const activeDetails = new Map();

  const savedAccountsByPhone = new Map();
  for (const acc of tgAccounts) {
    savedAccountsByPhone.set(normalizePhone(acc.phone), acc);
  }

  const chunkSize = 25;

  for (let i = 0; i < normalizedList.length; i += chunkSize) {
    const chunk = normalizedList.slice(i, i + chunkSize);

    if (chunk.length <= 5) {
      for (const num of chunk) {
        try {
          const resolved = await client.invoke(new Api.contacts.ResolvePhone({ phone: "+" + num }));
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

    const unresolvedChunk = chunk.filter((num) => !activeDetails.has(num));
    if (unresolvedChunk.length > 0) {
      const clientIdToPhone = new Map();
      const contacts = unresolvedChunk.map((num, idx) => {
        const cid = BigInt(i + idx + 1);
        clientIdToPhone.set(cid.toString(), num);
        return new Api.InputPhoneContact({
          clientId: cid,
          phone: "+" + num,
          firstName: "TGUser",
          lastName: ""
        });
      });

      try {
        const result = await client.invoke(new Api.contacts.ImportContacts({ contacts }));
        const usersById = new Map();
        const usersToDelete = [];

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
      } catch (e) {
        console.warn("[TG Bulk Check] Batch import error:", e?.message || e);
      }
    }

    for (const num of chunk) {
      if (!activeDetails.has(num) && savedAccountsByPhone.has(num)) {
        const ownAcc = savedAccountsByPhone.get(num);
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

export async function initAllTgSessions() {
  const accounts = getSavedTgAccountsList();
  if (accounts.length === 0) return;
  console.log(`[Telegram Service] Restoring ${accounts.length} saved Telegram session(s)...`);
  for (const acc of accounts) {
    if (acc.session) {
      try {
        await getActiveTgClient(acc.phone);
        console.log(`✅ [Telegram Service] Restored session for +${acc.phone}`);
      } catch (err) {
        console.warn(`⚠️ [Telegram Service] Could not restore +${acc.phone}:`, err?.message || err);
      }
    }
  }
}

// --- TELEGRAM LONG POLLING LOOP ---
export async function startTelegramPolling() {
  console.log(`[Telegram Bot] Initializing long-polling with token: ${TG_TOKEN.substring(0, 8)}...`);

  // Reset webhooks & verify bot
  try {
    await fetch(`${TG_API_URL}/deleteWebhook`, { method: "POST" });
    const meRes = await fetch(`${TG_API_URL}/getMe`);
    if (meRes.ok) {
      const meData = await meRes.json();
      console.log(`🤖 [Telegram Bot] Connected as: @${meData.result?.username} (ID: ${meData.result?.id})`);
    } else {
      console.error(`⚠️ [Telegram Bot] getMe failed (${meRes.status}):`, await meRes.text());
    }
  } catch (err) {
    console.error("[Telegram Bot] Webhook reset error:", err);
  }

  let offset = 0;
  while (true) {
    try {
      const res = await fetch(`${TG_API_URL}/getUpdates?offset=${offset}&timeout=30`, {
        signal: AbortSignal.timeout(45000),
      });

      if (!res.ok) {
        console.warn(`[Telegram Bot] HTTP error ${res.status}, retrying in 5s...`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = Math.max(offset, update.update_id + 1);
          if (update.message) {
            handleTelegramMessage(update.message).catch((e) => console.error("[Telegram Bot] Handler error:", e));
          }
          if (update.callback_query) {
            handleTelegramCallbackQuery(update.callback_query).catch((e) => console.error("[Telegram Bot] Callback error:", e));
          }
        }
      }
    } catch (err) {
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

// --- STANDALONE EXPRESS REST API SERVER FOR https://dxazone-checker.125.zero-bot.org ---
export function startApiServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "25mb" }));

  // CORS support for external bots/websites
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({
      success: true,
      service: "DXAZONE WhatsApp & Telegram Multi-User Checker API",
      baseUrl: "https://dxazone-checker.125.zero-bot.org",
      activeGateways: Array.from(activeSessions.values()).filter((s) => s.status === "connected").length,
    });
  });

  app.get("/api/status", (req, res) => {
    const queryPhone = (req.query.phone || req.query.senderPhone || "").toString().replace(/[^0-9]/g, "");
    const queryUserId = (req.query.userId || "").toString().trim();

    if (queryPhone || queryUserId) {
      const targetPhone = queryPhone || resolveApiWhatsAppSession(undefined, queryUserId).usedPhone || "";
      const sess = targetPhone ? activeSessions.get(targetPhone) : undefined;
      const savedList = getSavedAccountsList();
      const userAccounts = queryUserId
        ? savedList
            .filter((a) => a.externalUserId === queryUserId || a.ownerChatId === queryUserId)
            .map((a) => ({
              ...a,
              status: activeSessions.get(a.phone)?.status || "disconnected",
            }))
        : [];

      return res.json({
        success: true,
        userId: queryUserId || null,
        activePhone: targetPhone || null,
        status: sess ? sess.status : "disconnected",
        pairingCode: sess ? sess.pairingCode : null,
        rawCode: sess && sess.pairingCode ? sess.pairingCode.replace(/[^A-Z0-9]/g, "") : null,
        phoneNumber: sess ? sess.phoneNumber : targetPhone || null,
        profile: sess ? sess.profile : null,
        error: sess ? sess.error : null,
        userAccounts,
      });
    }

    const activeSess = currentActivePhone ? activeSessions.get(currentActivePhone) : null;
    res.json({
      activePhone: currentActivePhone,
      status: activeSess ? activeSess.status : "disconnected",
      pairingCode: activeSess ? activeSess.pairingCode : null,
      phoneNumber: activeSess ? activeSess.phoneNumber : null,
      profile: activeSess ? activeSess.profile : null,
      error: activeSess ? activeSess.error : null,
    });
  });

  app.get("/api/user-status", (req, res) => {
    const userId = (req.query.userId || req.query.externalUserId || "").toString().trim();
    const senderPhone = (req.query.senderPhone || req.query.phone || "").toString().replace(/[^0-9]/g, "");

    const saved = getSavedAccountsList();
    const apiUsers = getApiUsersList();
    const userRecord = userId ? apiUsers.find((u) => u.userId === userId) : undefined;

    const matchingAccounts = saved
      .filter((acc) => {
        if (senderPhone && acc.phone === senderPhone) return true;
        if (userId && (acc.externalUserId === userId || acc.ownerChatId === userId)) return true;
        if (userRecord && userRecord.phones.includes(acc.phone)) return true;
        return false;
      })
      .map((acc) => {
        const sess = activeSessions.get(acc.phone);
        return {
          phone: acc.phone,
          name: sess?.profile?.name || acc.name || "WhatsApp User",
          status: sess?.status || "disconnected",
          pairingCode: sess?.pairingCode || null,
          rawCode: sess?.pairingCode ? sess.pairingCode.replace(/[^A-Z0-9]/g, "") : null,
          addedAt: acc.addedAt,
          externalUserId: acc.externalUserId || userId || null,
        };
      });

    if (senderPhone && !matchingAccounts.some((m) => m.phone === senderPhone)) {
      const liveSess = activeSessions.get(senderPhone);
      if (liveSess) {
        matchingAccounts.push({
          phone: senderPhone,
          name: liveSess.profile?.name || "Pending User",
          status: liveSess.status,
          pairingCode: liveSess.pairingCode,
          rawCode: liveSess.pairingCode ? liveSess.pairingCode.replace(/[^A-Z0-9]/g, "") : null,
          addedAt: new Date().toISOString(),
          externalUserId: userId || null,
        });
      }
    }

    const connectedCount = matchingAccounts.filter((a) => a.status === "connected").length;
    res.json({
      success: true,
      userId: userId || null,
      connectedCount,
      totalChecks: userRecord?.totalChecks || 0,
      accounts: matchingAccounts,
    });
  });

  app.get("/api/accounts", (req, res) => {
    const userId = (req.query.userId || "").toString().trim();
    const saved = getSavedAccountsList();
    const filtered = userId
      ? saved.filter((acc) => acc.externalUserId === userId || acc.ownerChatId === userId)
      : saved;
    const enriched = filtered.map((acc) => {
      const sess = activeSessions.get(acc.phone);
      return {
        ...acc,
        status: sess ? sess.status : "disconnected",
        active: acc.phone === currentActivePhone,
      };
    });
    res.json({ accounts: enriched, activePhone: currentActivePhone });
  });

  const handleConnectWhatsAppApi = async (req, res) => {
    try {
      const rawPhone = req.body?.phone || req.body?.phoneNumber || req.query?.phone || req.query?.phoneNumber;
      const userId = (req.body?.userId || req.body?.externalUserId || req.query?.userId || req.query?.externalUserId || "")
        .toString()
        .trim();
      const userName = (req.body?.userName || req.body?.name || req.query?.userName || "")
        .toString()
        .trim();
      const apiKey = (req.body?.apiKey || req.query?.apiKey || req.headers["x-api-key"] || "")
        .toString()
        .trim();

      if (!rawPhone) {
        return res.status(400).json({ error: "Phone number is required (e.g. 8801700000000)" });
      }
      const cleanPhone = rawPhone.toString().replace(/[^0-9]/g, "");
      if (cleanPhone.length < 7) {
        return res.status(400).json({ error: "Invalid phone number. Include country code without +." });
      }

      if (userId) {
        upsertApiUserPhone(userId, cleanPhone, userName || `API User ${userId}`, apiKey || undefined);
      }

      linkingOwners.set(cleanPhone, {
        chatId: userId || undefined,
        name: userName || (userId ? `API User (${userId})` : "API User"),
        externalUserId: userId || undefined,
        apiKey: apiKey || undefined,
      });

      await initWhatsApp(cleanPhone, false);

      let attempts = 0;
      while (attempts < 30) {
        const sess = activeSessions.get(cleanPhone);
        if (sess?.pairingCode) {
          const rawCode = sess.pairingCode.replace(/[^A-Z0-9]/g, "");
          return res.json({
            success: true,
            status: sess.status,
            phone: cleanPhone,
            userId: userId || null,
            pairingCode: sess.pairingCode,
            rawCode,
            instructions:
              "Open WhatsApp > Linked Devices > Link a Device > Link with phone number instead, then enter this 8-digit code.",
          });
        }
        if (sess?.status === "error") {
          return res.status(500).json({ error: sess.error || "Failed to generate pairing code" });
        }
        if (sess?.status === "connected") {
          return res.json({
            success: true,
            status: "connected",
            phone: cleanPhone,
            userId: userId || null,
            message: "Already connected",
          });
        }
        await new Promise((r) => setTimeout(r, 500));
        attempts++;
      }

      res.status(504).json({ error: "Timed out waiting for WhatsApp pairing code. Please try again." });
    } catch (error) {
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  };

  app.post("/api/request-code", handleConnectWhatsAppApi);
  app.post("/api/connect-whatsapp", handleConnectWhatsAppApi);
  app.get("/api/connect-whatsapp", handleConnectWhatsAppApi);

  app.post("/api/switch-account", (req, res) => {
    const { phone } = req.body || {};
    const cleanPhone = (phone || "").toString().replace(/[^0-9]/g, "");
    if (!activeSessions.has(cleanPhone)) {
      initWhatsApp(cleanPhone, true);
    }
    currentActivePhone = cleanPhone;
    res.json({ success: true, activePhone: currentActivePhone });
  });

  const handleDisconnectWhatsAppApi = async (req, res) => {
    const rawPhone = req.body?.phone || req.body?.senderPhone || req.query?.phone || req.query?.senderPhone;
    const userId = (req.body?.userId || req.query?.userId || "").toString().trim();
    const cleanPhone = (rawPhone || "").toString().replace(/[^0-9]/g, "");
    if (!cleanPhone) {
      return res.status(400).json({ error: "phone is required" });
    }

    if (userId) {
      const saved = getSavedAccountsList();
      const acc = saved.find((a) => a.phone === cleanPhone);
      if (acc && acc.externalUserId && acc.externalUserId !== userId) {
        return res.status(403).json({
          error: `Phone +${cleanPhone} belongs to another userId and cannot be deleted by ${userId}.`,
        });
      }
      removeApiUserPhone(userId, cleanPhone);
    }

    const sess = activeSessions.get(cleanPhone);
    if (sess && sess.sock) {
      try {
        await sess.sock.logout();
      } catch (e) {}
      try {
        sess.sock.end(undefined);
      } catch (e) {}
    }
    activeSessions.delete(cleanPhone);
    deleteAccountFromDb(cleanPhone);

    const authDir = getSessionDir(cleanPhone);
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }

    if (currentActivePhone === cleanPhone) {
      const remaining = getSavedAccountsList();
      currentActivePhone = remaining.length > 0 ? remaining[0].phone : null;
    }

    res.json({ success: true, deletedPhone: cleanPhone, activePhone: currentActivePhone });
  };

  app.post("/api/delete-account", handleDisconnectWhatsAppApi);
  app.post("/api/disconnect-whatsapp", handleDisconnectWhatsAppApi);

  const handleCheckPhone = async (req, res) => {
    const phone = req.body?.phone || req.query?.phone;
    const senderPhone =
      req.body?.senderPhone ||
      req.body?.fromPhone ||
      req.body?.gatewayPhone ||
      req.query?.senderPhone ||
      req.query?.fromPhone ||
      req.query?.gatewayPhone;
    const userId =
      req.body?.userId ||
      req.body?.externalUserId ||
      req.query?.userId ||
      req.query?.externalUserId;

    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const resolved = resolveApiWhatsAppSession(
      senderPhone ? String(senderPhone) : undefined,
      userId ? String(userId) : undefined
    );

    if (!resolved.session || resolved.session.status !== "connected" || !resolved.session.sock) {
      return res.status(400).json({
        error: resolved.error || "WhatsApp is not connected. Please link a WhatsApp account first.",
        userId: userId || null,
        senderPhone: senderPhone || null,
      });
    }

    try {
      const cleanPhone = phone.toString().replace(/[^0-9]/g, "");
      if (cleanPhone.length < 7) {
        return res.status(400).json({ error: "Invalid phone number format" });
      }

      const [result] = await resolved.session.sock.onWhatsApp(cleanPhone);
      if (userId) incrementApiUserChecks(String(userId), 1);

      if (result && result.exists) {
        return res.json({
          success: true,
          phone: cleanPhone,
          status: "GOOD",
          exists: true,
          jid: result.jid,
          checkedByPhone: resolved.usedPhone,
          userId: userId || null,
        });
      } else {
        return res.json({
          success: true,
          phone: cleanPhone,
          status: "BAD",
          exists: false,
          jid: null,
          checkedByPhone: resolved.usedPhone,
          userId: userId || null,
        });
      }
    } catch (error) {
      console.error("Error checking phone:", error);
      return res.status(500).json({ error: error.message || "Failed to check phone number" });
    }
  };

  app.post("/api/check-phone", handleCheckPhone);
  app.get("/api/check-phone", handleCheckPhone);

  const handleBulkCheckPhone = async (req, res) => {
    const phones = req.body?.phones || req.body?.numbers;
    const senderPhone =
      req.body?.senderPhone ||
      req.body?.fromPhone ||
      req.body?.gatewayPhone ||
      req.query?.senderPhone ||
      req.query?.fromPhone;
    const userId =
      req.body?.userId ||
      req.body?.externalUserId ||
      req.query?.userId ||
      req.query?.externalUserId;

    if (!Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: "An array of phone numbers ('phones' or 'numbers') is required" });
    }

    const resolved = resolveApiWhatsAppSession(
      senderPhone ? String(senderPhone) : undefined,
      userId ? String(userId) : undefined
    );

    if (!resolved.session || resolved.session.status !== "connected" || !resolved.session.sock) {
      return res.status(400).json({
        error: resolved.error || "WhatsApp is not connected. Please link a WhatsApp account first.",
        userId: userId || null,
        senderPhone: senderPhone || null,
      });
    }

    const results = [];
    for (const rawPhone of phones) {
      const cleanPhone = String(rawPhone).replace(/[^0-9]/g, "");
      if (cleanPhone.length < 7) {
        results.push({ phone: rawPhone, status: "INVALID", exists: false, error: "Invalid phone number format" });
        continue;
      }

      try {
        const [result] = await resolved.session.sock.onWhatsApp(cleanPhone);
        if (result && result.exists) {
          results.push({ phone: cleanPhone, status: "GOOD", exists: true, jid: result.jid });
        } else {
          results.push({ phone: cleanPhone, status: "BAD", exists: false, jid: null });
        }
      } catch (err) {
        results.push({ phone: cleanPhone, status: "ERROR", exists: false, error: err.message || "Check failed" });
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    if (userId) incrementApiUserChecks(String(userId), results.length);

    return res.json({
      success: true,
      total: results.length,
      goodCount: results.filter((r) => r.exists).length,
      badCount: results.filter((r) => !r.exists).length,
      checkedByPhone: resolved.usedPhone,
      userId: userId || null,
      results,
    });
  };

  app.post("/api/check-phone-bulk", handleBulkCheckPhone);
  app.post("/api/check-batch", handleBulkCheckPhone);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Standalone REST API Server running on http://0.0.0.0:${PORT}`);
    console.log(`🔗 Public Domain Ready: https://dxazone-checker.125.zero-bot.org`);
  });
}

// --- BOOTSTRAP AUTO RESTORE ON STARTUP ---
export async function main() {
  console.log("=================================================");
  console.log("🚀 Starting Linkify Standalone WhatsApp-Telegram Bot");
  console.log("=================================================");

  const saved = getSavedAccountsList();
  if (saved.length > 0) {
    console.log(`[Startup] Found ${saved.length} saved WhatsApp accounts. Auto-reconnecting...`);
    currentActivePhone = saved[0].phone;
    for (const acc of saved) {
      initWhatsApp(acc.phone, true);
    }
  } else {
    console.log("[Startup] No saved accounts found. Use /login in Telegram to link your first WhatsApp.");
  }

  // Restore saved Telegram checker sessions
  await initAllTgSessions();

  // Start HTTP REST API server when running standalone (index.js / bot.js)
  if (!process.env.LINKIFY_WEB_SERVER) {
    startApiServer();
  }

  // Start Telegram bot listener
  startTelegramPolling();
}

// Execute directly when run as standalone script (bot.js or index.js)
if (!process.env.LINKIFY_WEB_SERVER) {
  main();
}
