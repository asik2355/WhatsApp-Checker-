/**
 * ============================================================================
 * LINKIFY - STANDALONE WHATSAPP & TELEGRAM BOT ENGINE (Node.js)
 * ============================================================================
 * এটি সম্পূর্ণ একটি একক (Single) Node.js ফাইল।
 * কোনো ওয়েবসাইট বা এক্সপ্রেস ছাড়া সরাসরি রান করতে পারেন:
 * Command: node bot.js
 * ============================================================================
 */

import fs from "fs";
import path from "path";
import pino from "pino";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

// --- CONFIGURATION ---
export const TG_TOKEN = process.env.TG_TOKEN || "8847916537:AAFC_L4RgUgO_molInYI0FKhgpmVElhwFHY";
export const TG_API_URL = `https://api.telegram.org/bot${TG_TOKEN}`;
export const DB_FILE = path.join(process.cwd(), "db_accounts.json");

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
  const existingTags = [];
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

export function formatTelegramHtml(text) {
  if (!text) return "";
  const savedTags = [];
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

// --- LOCAL DATABASE HELPERS ---
export function getSavedAccountsList() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

export function saveAccountToDb(phone, name, addedByChatId, addedByName) {
  const accounts = getSavedAccountsList();
  const existingIdx = accounts.findIndex((acc) => acc.phone === phone);
  const cleanName = name || "WhatsApp User";

  if (existingIdx > -1) {
    accounts[existingIdx].name = cleanName;
    accounts[existingIdx].linkedAt = new Date().toISOString();
    if (addedByChatId !== undefined) accounts[existingIdx].addedByChatId = addedByChatId;
    if (addedByName !== undefined) accounts[existingIdx].addedByName = addedByName;
  } else {
    accounts.push({
      phone,
      name: cleanName,
      linkedAt: new Date().toISOString(),
      addedByChatId,
      addedByName,
    });
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

// --- TELEGRAM BOT API HELPERS ---
export const ADMIN_CHAT_ID = "8343010638";

const USERS_DB_FILE = path.join(process.cwd(), "db_bot_users.json");

export function getBotUsersList() {
  if (!fs.existsSync(USERS_DB_FILE)) {
    const now = new Date().toISOString();
    const adminUser = {
      chatId: Number(ADMIN_CHAT_ID),
      username: "@Admin",
      name: "System Administrator",
      firstSeen: now,
      lastActive: now,
      isPremium: true,
      package: "Enterprise API",
      grantedAt: now,
      checksCount: 0
    };
    try {
      fs.writeFileSync(USERS_DB_FILE, JSON.stringify([adminUser], null, 2), "utf-8");
      return [adminUser];
    } catch {
      return [adminUser];
    }
  }
  try {
    const data = fs.readFileSync(USERS_DB_FILE, "utf-8");
    const list = JSON.parse(data);
    if (!list.some(u => String(u.chatId) === ADMIN_CHAT_ID)) {
      const now = new Date().toISOString();
      list.push({
        chatId: Number(ADMIN_CHAT_ID),
        username: "@Admin",
        name: "System Administrator",
        firstSeen: now,
        lastActive: now,
        isPremium: true,
        package: "Enterprise API",
        grantedAt: now,
        checksCount: 0
      });
      fs.writeFileSync(USERS_DB_FILE, JSON.stringify(list, null, 2), "utf-8");
    }
    return list;
  } catch (e) {
    console.error("[DB Users] Error reading db_bot_users.json:", e);
    return [];
  }
}

export function saveBotUsersList(users) {
  try {
    fs.writeFileSync(USERS_DB_FILE, JSON.stringify(users, null, 2), "utf-8");
  } catch (e) {
    console.error("[DB Users] Failed to write db_bot_users.json:", e);
  }
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
        text: "𝗦𝗘𝗧𝗧𝗜𝗡𝗚𝗦",
        icon_custom_emoji_id: "5420155432272438703",
        callback_data: "system_settings",
        style: "primary"
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

export function generateApiDocumentationContent() {
  return `================================================================================
       WHATSAPP & TELEGRAM NUMBER CHECKER API - INTEGRATION GUIDE
================================================================================
Generated Date: ${new Date().toISOString()}
Protocol: HTTPS / REST API
Output Format: JSON (application/json)
Authentication: Header "Authorization: Bearer <YOUR_API_KEY>"

================================================================================
                 PART 1: ENGLISH API DOCUMENTATION & GUIDE
================================================================================

--------------------------------------------------------------------------------
1. OVERVIEW & ARCHITECTURE
--------------------------------------------------------------------------------
This enterprise REST API provides high-speed phone number validation and presence 
checking across WhatsApp Web servers and Telegram networks.
Features:
- Single & Multi-threaded Bulk Validation
- Real-time WhatsApp JID resolution (JID: <phone>@s.whatsapp.net)
- Full device session presence & business account tag detection
- 99.9% Uptime with automatic multi-gateway failover redundancy
- Webhook events and Telegram automated alerts

--------------------------------------------------------------------------------
2. BASE URL & AUTHENTICATION
--------------------------------------------------------------------------------
Base URLs:
- Production Gateway: https://ais-dev-vkulebubzwd2ybb2kjedeu-484782538497.asia-southeast1.run.app
- Local VPS / Node Engine: http://localhost:3000

All HTTP requests must include your API authorization token in the header:
Authorization: Bearer <YOUR_API_KEY>

--------------------------------------------------------------------------------
3. ENDPOINT 1: VERIFY SINGLE PHONE NUMBER
--------------------------------------------------------------------------------
Method: GET
Path: /api/check-phone
Query Parameters:
- phone (string, required): Phone number formatted with country code (e.g. +8801700000000)

Request Example:
GET /api/check-phone?phone=+8801712345678 HTTP/1.1
Host: api.yourdomain.com
Authorization: Bearer YOUR_API_KEY

Response Example (Status: 200 OK):
{
  "phone": "8801712345678",
  "exists": true,
  "whatsapp": {
    "exists": true,
    "jid": "8801712345678@s.whatsapp.net"
  },
  "checkedAt": "${new Date().toISOString()}"
}

--------------------------------------------------------------------------------
4. ENDPOINT 2: BULK BATCH NUMBER CHECKER (HIGH SPEED)
--------------------------------------------------------------------------------
Method: POST
Path: /api/check-batch
Headers:
  Content-Type: application/json
  Authorization: Bearer YOUR_API_KEY

Request Body:
{
  "numbers": [
    "+8801712345678",
    "+8801812345678",
    "+919876543210",
    "+12015550123"
  ]
}

Response Example (Status: 200 OK):
{
  "total": 4,
  "activeCount": 3,
  "inactiveCount": 1,
  "active": [
    "8801712345678",
    "+919876543210",
    "+12015550123"
  ],
  "inactive": [
    "+8801812345678"
  ],
  "timestamp": "${new Date().toISOString()}"
}

--------------------------------------------------------------------------------
5. ENDPOINT 3: GATEWAY & BOT STATUS
--------------------------------------------------------------------------------
Method: GET
Path: /api/status

Response Example:
{
  "status": "connected",
  "phone": "8801700000000",
  "profile": {
    "name": "Linkify Business Node"
  },
  "activeSessionsCount": 1
}

--------------------------------------------------------------------------------
6. CODE EXAMPLES
--------------------------------------------------------------------------------

A. cURL (Command Line):
--------------------------------------------------
curl -X POST "https://your-api-domain.com/api/check-batch" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{"numbers": ["+8801712345678", "+8801812345678"]}'

B. Python (requests):
--------------------------------------------------
import requests

url = "https://your-api-domain.com/api/check-batch"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_API_KEY"
}
payload = {
    "numbers": ["+8801712345678", "+8801812345678"]
}

response = requests.post(url, json=payload, headers=headers)
data = response.json()
print("Active Numbers:", data.get("active"))
print("Inactive Numbers:", data.get("inactive"))

C. Node.js (JavaScript / TypeScript):
--------------------------------------------------
const response = await fetch("https://your-api-domain.com/api/check-batch", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_API_KEY"
  },
  body: JSON.stringify({
    numbers: ["+8801712345678", "+8801812345678"]
  })
});
const result = await response.json();
console.log("Result:", result);

D. PHP (cURL):
--------------------------------------------------
<?php
$ch = curl_init('https://your-api-domain.com/api/check-batch');
$payload = json_encode(['numbers' => ['+8801712345678', '+8801812345678']]);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Authorization: Bearer YOUR_API_KEY'
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);
$data = json_decode($response, true);
print_r($data);
?>

--------------------------------------------------------------------------------
7. HTTP STATUS & ERROR CODES
--------------------------------------------------------------------------------
200 OK           : Request completed successfully.
400 Bad Request  : Invalid phone number format or missing required payload.
401 Unauthorized : Invalid or expired API Key.
429 Too Many Req : Rate limit exceeded for current package tier.
503 Unavailable  : WhatsApp gateway node reconnecting. Retry in 2-3 seconds.

--------------------------------------------------------------------------------
8. SUPPORT & LICENSE UPGRADE
--------------------------------------------------------------------------------
To purchase enterprise access tokens, increase concurrency, or integrate custom 
webhooks, contact the official system administrator in Telegram:
Admin ID: 8343010638
Telegram Bot: @WhatsappCheckerApi_Bot


================================================================================
             PART 2: সম্পূর্ণ বাংলা ডকুমেন্টেশন ও ব্যবহারের নির্দেশিকা
================================================================================

--------------------------------------------------------------------------------
১. পরিচিতি ও সিস্টেমের ক্ষমতাসমূহ (Overview & Capabilities)
--------------------------------------------------------------------------------
এই এন্টারপ্রাইজ REST API এর মাধ্যমে আপনি যেকোনো সফটওয়্যার, সিআরএম, ই-কমার্স বা
ওয়েবসাইট থেকে সরাসরি রিয়েল-টাইমে হোয়াটসঅ্যাপ ও টেলিগ্রাম নম্বর যাচাই করতে পারবেন।
নম্বরটিতে হোয়াটসঅ্যাপ সক্রিয় আছে কিনা এবং বিজনেস প্রোফাইল কিনা তা মিলি-সেকেন্ডে নির্ণয় করা যায়।

মূল সুবিধাসমূহ:
- একক এবং হাজার হাজার নম্বর একসাথে বাল্ক চেকিং
- অতি দ্রুত রেসপন্স টাইম (০.১ - ০.৩ সেকেন্ড প্রতি নম্বর)
- একাধিক গেটওয়ের মাধ্যমে ৯৯.৯% আপটাইম ব্যাকআপ
- স্বয়ংক্রিয় ওয়েবহুক ও টেলিগ্রাম নোটিফিকেশন সুবিধা

--------------------------------------------------------------------------------
২. বেস ইউআরএল ও এপিআই অথেনটিকেশন (Base URL & Authentication)
--------------------------------------------------------------------------------
সার্ভার লিংকসমূহ:
- প্রোডাকশন গেটওয়ে: https://ais-dev-vkulebubzwd2ybb2kjedeu-484782538497.asia-southeast1.run.app
- লোকাল সার্ভার: http://localhost:3000

প্রতিটি HTTP রিকোয়েস্টে হেডার (Header)-এ আপনার সিক্রেট API Key প্রদান করতে হবে:
Authorization: Bearer <আপনার_এপিআই_কি>

--------------------------------------------------------------------------------
৩. এন্ডপয়েন্ট ১: একটি মাত্র নম্বর যাচাই (Verify Single Phone Number)
--------------------------------------------------------------------------------
মেথড: GET
পাথ: /api/check-phone
প্রয়োজনীয় প্যারামিটার:
- phone (string): কান্ট্রি কোড সহ ফোন নম্বর (যেমন: +8801700000000)

রিকোয়েস্ট উদাহরণ:
GET /api/check-phone?phone=+8801712345678 HTTP/1.1
Host: api.yourdomain.com
Authorization: Bearer YOUR_API_KEY

রেসপন্স উদাহরণ (200 OK):
{
  "phone": "8801712345678",
  "exists": true,
  "whatsapp": {
    "exists": true,
    "jid": "8801712345678@s.whatsapp.net"
  },
  "checkedAt": "${new Date().toISOString()}"
}
ব্যাখ্যা: যদি নম্বরটিতে হোয়াটসঅ্যাপ সক্রিয় থাকে তবে "exists": true আসবে, অন্যথায় false আসবে।

--------------------------------------------------------------------------------
৪. এন্ডপয়েন্ট ২: বাল্ক ব্যাচ চেকার (Bulk Batch Number Checker - High Speed)
--------------------------------------------------------------------------------
মেথড: POST
পাথ: /api/check-batch
হেডার:
  Content-Type: application/json
  Authorization: Bearer YOUR_API_KEY

রিকোয়েস্ট বডি (JSON Body):
{
  "numbers": [
    "+8801712345678",
    "+8801812345678",
    "+919876543210",
    "+12015550123"
  ]
}

রেসপন্স উদাহরণ (200 OK):
{
  "total": 4,
  "activeCount": 3,
  "inactiveCount": 1,
  "active": [
    "8801712345678",
    "+919876543210",
    "+12015550123"
  ],
  "inactive": [
    "+8801812345678"
  ],
  "timestamp": "${new Date().toISOString()}"
}
ব্যাখ্যা: একসাথে হাজার হাজার নম্বর পাঠালে সার্ভার স্বয়ংক্রিয়ভাবে সক্রিয় (active)
এবং নিষ্ক্রিয় (inactive) তালিকা আলাদা করে রিটার্ন করে।

--------------------------------------------------------------------------------
৫. এন্ডপয়েন্ট ৩: গেটওয়ে ও বটের বর্তমান অবস্থা (Gateway Status)
--------------------------------------------------------------------------------
মেথড: GET
পাথ: /api/status

রেসপন্স উদাহরণ:
{
  "status": "connected",
  "phone": "8801700000000",
  "profile": {
    "name": "Linkify Business Node"
  },
  "activeSessionsCount": 1
}
ব্যাখ্যা: স্ট্যাটাস "connected" থাকলে বুঝতে হবে গেটওয়ে সম্পূর্ণ প্রস্তুত ও লাইভ রয়েছে।

--------------------------------------------------------------------------------
৬. প্রোগ্রামিং কোড উদাহরণ (Code Examples)
--------------------------------------------------------------------------------

ক. cURL (কমান্ড লাইন দিয়ে পরীক্ষা):
--------------------------------------------------
curl -X POST "https://your-api-domain.com/api/check-batch" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{"numbers": ["+8801712345678", "+8801812345678"]}'

খ. Python (পাইথন স্ক্রিপ্ট):
--------------------------------------------------
import requests

url = "https://your-api-domain.com/api/check-batch"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_API_KEY"
}
payload = {
    "numbers": ["+8801712345678", "+8801812345678"]
}

response = requests.post(url, json=payload, headers=headers)
data = response.json()
print("সক্রিয় নম্বরসমূহ:", data.get("active"))
print("নিষ্ক্রিয় নম্বরসমূহ:", data.get("inactive"))

গ. Node.js (জাভাস্ক্রিপ্ট / টাইপস্ক্রিপ্ট):
--------------------------------------------------
const response = await fetch("https://your-api-domain.com/api/check-batch", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_API_KEY"
  },
  body: JSON.stringify({
    numbers: ["+8801712345678", "+8801812345678"]
  })
});
const result = await response.json();
console.log("চেকিং ফলাফল:", result);

ঘ. PHP (পিএইচপি ওয়েবসাইট):
--------------------------------------------------
<?php
$ch = curl_init('https://your-api-domain.com/api/check-batch');
$payload = json_encode(['numbers' => ['+8801712345678', '+8801812345678']]);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Authorization: Bearer YOUR_API_KEY'
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);
$data = json_decode($response, true);
print_r($data);
?>

--------------------------------------------------------------------------------
৭. এইচটিটিপি স্ট্যাটাস ও এরর কোড (HTTP Status & Error Codes)
--------------------------------------------------------------------------------
২০০ OK           : রিকোয়েস্ট সফলভাবে সম্পন্ন হয়েছে।
৪০০ Bad Request  : ভুল ফোন নম্বর ফরম্যাট বা পে-লোড মিসিং।
৪০১ Unauthorized : এপিআই কি সঠিক নয় বা মেয়াদ শেষ।
৪২৯ Too Many Req : আপনার প্যাকেজের নির্ধারিত রিকোয়েস্ট সীমা পার হয়েছে।
৫০৩ Unavailable  : গেটওয়ে নোড পুনরায় কানেক্ট হচ্ছে, কয়েক সেকেন্ড পর আবার চেষ্টা করুন।

--------------------------------------------------------------------------------
৮. সহায়তা ও এন্টারপ্রাইজ লাইসেন্স ক্রয় (Support & License Upgrade)
--------------------------------------------------------------------------------
আনলিমিটেড স্পিড প্যাকেজ, এপিআই কি ক্রয়, কনকারেন্সি বৃদ্ধি বা কাস্টম গেটওয়ে 
সেটআপ করতে সরাসরি সিস্টেম অ্যাডমিনের টেলিগ্রামে যোগাযোগ করুন:
অ্যাডমিন আইডি: 8343010638
টেলিগ্রাম বট: @WhatsappCheckerApi_Bot
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
  const accounts = getSavedAccountsList();
  const { totalUsers, premiumUsers, freeUsers } = getUserStats();
  return (
    `⚙️ <b>ADMIN CONTROL PANEL</b>\n\n` +
    `👑 <b>Admin ID:</b> <code>${ADMIN_CHAT_ID}</code> (Authorized)\n\n` +
    `👥 <b>USER & PACKAGE ANALYTICS:</b>\n` +
    `▫️ <b>Total Users:</b> <code>${totalUsers}</code> registered\n` +
    `▫️ <b>Premium Users:</b> <code>${premiumUsers}</code> with API package 💎\n` +
    `▫️ <b>Free Tier Users:</b> <code>${freeUsers}</code> standard\n\n` +
    `📊 <b>System Status:</b>\n` +
    `▫️ Active Gateway: ${currentActivePhone ? `🟢 +${currentActivePhone}` : "🔴 No active account"}\n` +
    `▫️ Stored Accounts: ${accounts.length}\n` +
    `▫️ Memory Sessions: ${activeSessions.size}\n` +
    `▫️ Telegram Bot: 🟢 Online (@WhatsappCheckerApi_Bot)\n\n` +
    `🛠 <b>Admin Commands:</b>\n` +
    `▫️ <code>/users</code> - View full list of users and active packages\n` +
    `▫️ <code>/setpremium &lt;chat_id&gt;</code> - Upgrade user to Premium API Package\n` +
    `▫️ <code>/removepremium &lt;chat_id&gt;</code> - Revert user to Free tier\n` +
    `▫️ <code>/status</code> - View live status of all linked accounts\n` +
    `▫️ <code>/login &lt;phone&gt;</code> - Generate pairing code for new WhatsApp gateway\n` +
    `▫️ <code>/logout &lt;phone&gt;</code> - Disconnect and remove account\n` +
    `▫️ <code>/check &lt;phone&gt;</code> - Validate single phone number\n` +
    `▫️ Bulk File Upload - Process unlimited numbers via .txt/.csv\n\n` +
    `👇 Click <b>PAYMENT MANAGEMENT</b> or <b>SETTINGS</b> below:`
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
    "deposit_method_menu",
    "dollar_rate_menu"
  ];
  if (adminCallbacks.includes(data)) {
    if (String(fromId) !== ADMIN_CHAT_ID && String(chatId) !== ADMIN_CHAT_ID) {
      await answerTelegramCallbackQuery(callId, "⛔ Access Denied: You are not an administrator of this system!", true);
      return;
    }
  }

  if (data === "system_settings") {
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
    const text = `💎 <b>PREMIUM MANAGEMENT</b>\n\nConfigure premium features and checkers below:`;
    if (msgId) {
      await editTelegramMessage(chatId, msgId, text, "HTML", PREMIUM_MANAGEMENT_KEYBOARD);
    } else {
      await sendTelegramMessage(chatId, text, "HTML", PREMIUM_MANAGEMENT_KEYBOARD);
    }
    await answerTelegramCallbackQuery(callId);
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
    await answerTelegramCallbackQuery(callId, "⚠️ This feature configuration will be available soon (Dummy Alert).", true);
    return;
  }

  await answerTelegramCallbackQuery(callId);
}

export async function sendTelegramMessage(chatId, text, parseMode = "HTML", replyMarkup = null) {
  try {
    const formattedText = formatTelegramHtml(text);
    const finalMarkup = (!replyMarkup || replyMarkup === MAIN_MENU_KB)
      ? getMainMenuKeyboard(chatId)
      : replyMarkup;

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
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text: formattedText,
      parse_mode: "HTML",
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    const res = await fetch(`${TG_API_URL}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn("[Telegram] HTML editMessageText failed, retrying plain:", res.status, errText);
      const fallbackPayload = {
        chat_id: chatId,
        message_id: messageId,
        text,
      };
      if (replyMarkup) fallbackPayload.reply_markup = replyMarkup;
      await fetch(`${TG_API_URL}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
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

    sock.ev.on("creds.update", saveCreds);

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
        saveAccountToDb(phoneNumber, sock.user?.name || "", owner?.chatId, owner?.name);

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

// Check single number on WhatsApp
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
  try {
    const [result] = await resolvedSock.onWhatsApp(clean);
    return {
      phone: clean,
      exists: Boolean(result?.exists),
      jid: result?.jid || null,
    };
  } catch (err) {
    console.error(`[Check Error] ${clean}:`, err.message || err);
    return { phone: clean, exists: false, jid: null };
  }
}

// Bulk check batch handler with Telegram progress & reports
export async function checkAndRespondBatch(chatId, rawNumbers) {
  // Find connected WhatsApp socket for this chat or active gateway
  const saved = getSavedAccountsList();
  const myAccounts = saved.filter((acc) => acc.addedByChatId === chatId);

  let gatewayPhone = null;
  for (const acc of myAccounts) {
    const s = activeSessions.get(acc.phone);
    if (s && s.status === "connected" && s.sock) {
      gatewayPhone = acc.phone;
      break;
    }
  }

  if (!gatewayPhone && currentActivePhone) {
    const s = activeSessions.get(currentActivePhone);
    if (s && s.status === "connected" && s.sock) gatewayPhone = currentActivePhone;
  }

  if (!gatewayPhone) {
    for (const [ph, s] of activeSessions) {
      if (s.status === "connected" && s.sock) {
        gatewayPhone = ph;
        break;
      }
    }
  }

  if (!gatewayPhone) {
    await sendTelegramMessage(
      chatId,
      "⚠️ *No active WhatsApp gateway connected!* \n\n" +
        "Please connect your WhatsApp to the bot first using: `/login <phone_number>`\n" +
        "Example: `/login 8801700000000`"
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
    `🔍 *Checking WhatsApp Database...*\n\n` +
      `Total Unique Numbers: *${normalizedList.length}*\n` +
      `Active Gateway: *+${gatewayPhone}*`
  );

  const activeWa = [];
  const inactiveWa = [];

  for (let i = 0; i < normalizedList.length; i++) {
    const num = normalizedList[i];
    try {
      const res = await checkWhatsAppNumber(num, gatewayPhone);
      if (res.exists) {
        activeWa.push(num);
      } else {
        inactiveWa.push(num);
      }
    } catch (e) {
      inactiveWa.push(num);
    }

    // Update progress in telegram every 5 numbers or when finished
    if (normalizedList.length > 5 && (i % 5 === 0 || i === normalizedList.length - 1)) {
      const pct = Math.round(((i + 1) / normalizedList.length) * 100);
      if (progressMsgId) {
        await editTelegramMessage(
          chatId,
          progressMsgId,
          `🔍 *Checking WhatsApp Database...*\n\n` +
            `⏳ Progress: *${i + 1}/${normalizedList.length}* (${pct}%)\n` +
            `🟢 Active: *${activeWa.length}* | 🔴 Inactive: *${inactiveWa.length}*`
        );
      }
    }
  }

  // Small batch: send full list in message
  if (normalizedList.length <= 30) {
    const activeText = activeWa.length > 0 ? activeWa.map((x) => `+${x}`).join("\n") : "_None_";
    const inactiveText = inactiveWa.length > 0 ? inactiveWa.map((x) => `+${x}`).join("\n") : "_None_";

    const report =
      `🤖 *WhatsApp Checker Report*\n\n` +
      `📊 *Total Checked:* ${normalizedList.length}\n` +
      `✅ *Active WhatsApp Accounts (${activeWa.length}):*\n${activeText}\n\n` +
      `❌ *Not on WhatsApp (${inactiveWa.length}):*\n${inactiveText}`;

    if (progressMsgId) {
      await editTelegramMessage(chatId, progressMsgId, report);
    } else {
      await sendTelegramMessage(chatId, report);
    }
  } else {
    // Large batch: send summary message + downloadable txt document
    const summary =
      `🤖 *Bulk WhatsApp Checker Report*\n\n` +
      `📊 *Total Checked:* ${normalizedList.length}\n` +
      `🟢 *Active WhatsApp Accounts:* *${activeWa.length}*\n` +
      `🔴 *Not on WhatsApp:* *${inactiveWa.length}*\n\n` +
      `📁 Detailed results are attached in the file below:`;

    if (progressMsgId) {
      await editTelegramMessage(chatId, progressMsgId, summary);
    } else {
      await sendTelegramMessage(chatId, summary);
    }

    const fileContent =
      `==== ACTIVE WHATSAPP NUMBERS (${activeWa.length}) ====\n` +
      activeWa.map((x) => `+${x}`).join("\n") +
      `\n\n==== INACTIVE NUMBERS (${inactiveWa.length}) ====\n` +
      inactiveWa.map((x) => `+${x}`).join("\n");

    const timeStr = new Date().toISOString().replace(/[:.]/g, "-");
    await sendTelegramDocument(
      chatId,
      fileContent,
      `whatsapp_checked_${timeStr}.txt`,
      `Active: ${activeWa.length} | Inactive: ${inactiveWa.length}`
    );
  }
}

// Document file handler (.txt/.csv)
export async function handleTelegramDocument(chatId, doc) {
  const fileId = doc.file_id;
  const fileName = doc.file_name || "numbers.txt";

  await sendTelegramMessage(chatId, `⏳ Processing *${fileName}*... Extracting phone numbers.`);

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
    const matches = fileText.match(/(\+?[0-9]{8,15})/g);

    if (matches && matches.length > 0) {
      await checkAndRespondBatch(chatId, matches);
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

  await sendTelegramMessage(
    chatId,
    `⌛ Generating WhatsApp pairing code for *+${clean}*... Please wait 10-15 seconds.`,
    "Markdown",
    BACK_MENU_KB
  );

  linkingOwners.set(clean, { chatId, name: senderName });
  currentActivePhone = clean;

  await initWhatsApp(clean, false);

  let counter = 0;
  const maxWait = 20;
  const checkTimer = setInterval(async () => {
    counter++;
    const sess = activeSessions.get(clean);

    if (sess && sess.status === "pairing-code-ready" && sess.pairingCode) {
      clearInterval(checkTimer);
      const codeMsg =
        `🔑 *Your WhatsApp Pairing Code:* \n\n` +
        `👉 \`${sess.pairingCode}\` 👈\n\n` +
        `*How to use:*\n` +
        `1. Open WhatsApp on your phone.\n` +
        `2. Tap the three-dot menu > *Linked Devices*.\n` +
        `3. Tap *Link a Device* and select *Link with phone number instead* at the bottom.\n` +
        `4. Enter the code above.\n\n` +
        `Your account will sync with the bot automatically! 🚀`;
      await sendTelegramMessage(chatId, codeMsg, "Markdown", BACK_MENU_KB);
    } else if (sess && sess.status === "error") {
      clearInterval(checkTimer);
      await sendTelegramMessage(chatId, `❌ Failed to generate pairing code: ${sess.error || "Server did not respond"}`);
    } else if (counter >= maxWait) {
      clearInterval(checkTimer);
      await sendTelegramMessage(
        chatId,
        `⏳ Code generation is taking a moment. Please check in 30 seconds using \`/status\`.`
      );
    }
  }, 1000);
}

// Telegram Message Dispatcher
export async function handleTelegramMessage(message) {
  const chatId = message.chat?.id;
  if (!chatId) return;
  const chatKey = String(chatId);

  const currentUser = trackBotUser(chatId, message.from || message.chat);

  if (message.document) {
    await handleTelegramDocument(chatId, message.document);
    return;
  }

  const text = (message.text || "").trim();
  if (!text) return;

  // /start
  if (text.startsWith("/start")) {
    userMenuMode.delete(chatKey);
    const isAdmin = String(chatId) === ADMIN_CHAT_ID;
    const adminLine = isAdmin ? `🔘 *ADMIN PANEL* - System Administrator Control Panel\n\n` : `\n`;
    const startMsg =
      `👋 *Welcome to Linkify WhatsApp & Telegram Checker Engine!*\n\n` +
      `Directly connect your WhatsApp gateway and check numbers at lightning speed. Use the buttons below:\n\n` +
      `🔘 *CONNECT WS CHECKER* - Get pairing code to link WhatsApp\n` +
      `🔘 *CHECK WS NUMBER* - Check WhatsApp numbers\n` +
      `🔘 *CHECK TG NUMBER* - Check Telegram numbers\n` +
      `🔘 *BUY WS AND TG API* - Purchase API license keys & access\n` +
      `🔘 *HELP* - User guide and all commands\n` +
      `🔘 *MY PROFILE* - Profile details and linked accounts\n` +
      adminLine +
      `💡 *Quick Tip:* Select any option from the menu below and simply send phone numbers like \`88017XXXXXX\` directly without needing any commands! 🚀`;
    await sendTelegramMessage(chatId, startMsg, "Markdown", getMainMenuKeyboard(chatId));
    return;
  }

  // BACK BUTTON ACTION
  if (text === "BACK" || text.toUpperCase() === "BACK") {
    userMenuMode.delete(chatKey);
    await sendTelegramMessage(
      chatId,
      `🏠 *Main Menu*\n\nSelect an option from the menu buttons below:`,
      "Markdown",
      getMainMenuKeyboard(chatId)
    );
    return;
  }

  // --- MENU BUILDER BUTTON ACTIONS ---
  if (text === "CONNECT WS CHECKER" || text.includes("CONNECT WS CHECKER")) {
    userMenuMode.set(chatKey, "connect_ws");
    const connectMsg = 
      `🔗 *CONNECT WS CHECKER*\n\n` +
      `Send your WhatsApp phone number with country code directly to receive an 8-digit pairing code:\n\n` +
      `*Example:*\n` +
      `\`8801700000000\`\n\n` +
      `ℹ️ You don't need to type any command—just send the number! Once you receive the 8-digit code, open WhatsApp > *Linked Devices* > *Link with phone number instead* and enter the code.\n\n` +
      `_(Tap *BACK* below to return to the Main Menu)_`;
    await sendTelegramMessage(chatId, connectMsg, "Markdown", BACK_MENU_KB);
    return;
  }

  if (text === "CHECK WS NUMBER" || text.includes("CHECK WS NUMBER")) {
    userMenuMode.set(chatKey, "check_ws");
    const checkGuideMsg = 
      `🔍 *CHECK WS NUMBER*\n\n` +
      `Send the phone number(s) with country code directly in the chat to check WhatsApp status:\n\n` +
      `*Example:*\n` +
      `\`8801712345678\`\n\n` +
      `💡 You can send a single number, paste multiple numbers at once, or upload a \`.txt\` / \`.csv\` file!\n\n` +
      `_(Tap *BACK* below to return to the Main Menu)_`;
    await sendTelegramMessage(chatId, checkGuideMsg, "Markdown", BACK_MENU_KB);
    return;
  }

  if (text === "CHECK TG NUMBER" || text.includes("CHECK TG NUMBER")) {
    userMenuMode.set(chatKey, "check_tg");
    const checkTgGuideMsg = 
      `🔍 *CHECK TG NUMBER*\n\n` +
      `Send the phone number(s) with country code directly in the chat to check Telegram status:\n\n` +
      `*Example:*\n` +
      `\`8801712345678\`\n\n` +
      `💡 You can send a single number, paste multiple numbers at once, or upload a \`.txt\` / \`.csv\` file!\n\n` +
      `_(Tap *BACK* below to return to the Main Menu)_`;
    await sendTelegramMessage(chatId, checkTgGuideMsg, "Markdown", BACK_MENU_KB);
    return;
  }

  if (text === "BUY WS AND TG API" || text.includes("BUY WS AND TG API") || text === "BUY WS API" || text.includes("BUY WS API") || text === "BUY PACKAGE" || text.includes("BUY PACKAGE")) {
    userMenuMode.delete(chatKey);
    const buyApiMsg = 
      `⚡ *BUY WS AND TG API (WhatsApp & Telegram Checker API)*\n\n` +
      `Integrate high-speed WhatsApp and Telegram checking into your website, CRM, or software:\n\n` +
      `🔹 *REST API Endpoints:*\n` +
      `▫️ \`GET /api/check-phone?phone=+88017...\` - Single number validation\n` +
      `▫️ \`POST /api/check-batch\` - Multi-threaded bulk batch checker\n` +
      `▫️ \`POST /api/send-message\` - Automated messaging gateway\n\n` +
      `💎 *API Highlights:*\n` +
      `▫️ Full WhatsApp & Telegram support\n` +
      `▫️ High concurrency & multi-threaded throughput\n` +
      `▫️ 99.9% uptime with multi-gateway failover\n` +
      `▫️ Complete webhook event notifications\n\n` +
      `📞 *To purchase API license keys:* Click the button below to download the documentation guide or contact Admin directly.`;
    await sendTelegramMessage(chatId, buyApiMsg, "Markdown", BUY_API_INLINE_KEYBOARD);
    return;
  }

  if (text === "HELP" || text.includes("HELP")) {
    userMenuMode.delete(chatKey);
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
    userMenuMode.delete(chatKey);
    const accounts = getSavedAccountsList();
    const userFirstName = message.from?.first_name || message.chat?.first_name || "Telegram User";
    const userLastName = message.from?.last_name || "";
    const fullName = `${userFirstName} ${userLastName}`.trim();
    const username = message.from?.username ? `@${message.from.username}` : "Not Set";
    const userAccounts = accounts.filter((a) => a.addedByChatId === chatId);

    const profileMsg = 
      `👤 *MY PROFILE*\n\n` +
      `▫️ *Name:* ${fullName}\n` +
      `▫️ *Username:* ${username}\n` +
      `▫️ *Telegram ID:* \`${chatId}\`\n` +
      `▫️ *Linked WhatsApp Accounts:* ${userAccounts.length > 0 ? userAccounts.length : accounts.length + " (System Shared)"}\n` +
      `▫️ *Active Gateway:* ${currentActivePhone ? `🟢 +${currentActivePhone}` : "🔴 No active gateway"}\n` +
      `▫️ *Account Tier:* ${currentUser.isPremium ? "💎 Premium API User" : "⚪ Free Standard User"}\n` +
      `▫️ *Server Cluster:* ⚡ Online Multi-Node`;
    await sendTelegramMessage(chatId, profileMsg, "Markdown", getMainMenuKeyboard(chatId));
    return;
  }

  if (text === "MY PACKAGE" || text.includes("MY PACKAGE")) {
    userMenuMode.delete(chatKey);
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
    userMenuMode.delete(chatKey);
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
    if (saved.length === 0) {
      await sendTelegramMessage(chatId, "ℹ️ No WhatsApp accounts linked yet. Tap *CONNECT WS CHECKER* and send your phone number to connect.");
      return;
    }

    let statusMsg = `📊 *WhatsApp Connection Status:*\n\n`;
    saved.forEach((acc, idx) => {
      const s = activeSessions.get(acc.phone);
      const isOnline = s?.status === "connected";
      const icon = isOnline ? "🟢 Connected" : "🔴 Offline";
      statusMsg += `${idx + 1}. *+${acc.phone}* (${acc.name || "WhatsApp User"})\n   Status: ${icon}\n`;
    });

    if (currentActivePhone) {
      statusMsg += `\n🎯 *Default Runtime Gateway:* \`+${currentActivePhone}\``;
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
    const deleted = deleteAccountFromDb(clean);
    if (deleted) {
      await sendTelegramMessage(chatId, `✅ *+${clean}* has been disconnected and removed from the database.`);
    } else {
      await sendTelegramMessage(chatId, `⚠️ *+${clean}* was not found in the database.`);
    }
    return;
  }

  // /check <phone>
  if (text.startsWith("/check")) {
    const raw = text.substring(6).trim();
    if (!raw) {
      await sendTelegramMessage(chatId, "⚠️ Please provide a phone number to check. Example: `8801712345678`");
      return;
    }
    await checkAndRespondBatch(chatId, [raw]);
    return;
  }

  // HANDLE DIRECT PHONE NUMBER INPUT BASED ON ACTIVE MENU MODE
  const activeMode = userMenuMode.get(chatKey);
  const numMatches = text.match(/(\+?[0-9]{8,15})/g);

  if (activeMode === "connect_ws") {
    if (numMatches && numMatches.length > 0) {
      const senderName = message.from?.first_name || message.chat?.first_name || "Telegram User";
      await startWhatsAppPairingForChat(chatId, numMatches[0].trim(), senderName);
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

  if (numMatches && numMatches.length > 0) {
    await checkAndRespondBatch(chatId, numMatches);
  } else {
    if (activeMode === "check_ws" || activeMode === "check_tg") {
      await sendTelegramMessage(
        chatId,
        "⚠️ Please send valid phone number(s) with country code (e.g. `8801712345678`) or tap *BACK* to return to the Main Menu.",
        "Markdown",
        BACK_MENU_KB
      );
    } else {
      await sendTelegramMessage(
        chatId,
        "ℹ️ Please select an option from the menu or send phone numbers (e.g. `8801712345678`) to check.",
        "Markdown",
        getMainMenuKeyboard(chatId)
      );
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

  // Start Telegram bot listener
  startTelegramPolling();
}

// Execute directly if run as standalone script
if (process.argv[1] && process.argv[1].endsWith("bot.js")) {
  main();
}
