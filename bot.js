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

export function getAdminPanelDashboardText() {
  const accounts = getSavedAccountsList();
  return (
    `⚙️ <b>ADMIN PANEL (অ্যাডমিন কন্ট্রোল সেন্টার)</b>\n\n` +
    `👑 <b>অ্যাডমিন আইডি:</b> <code>${ADMIN_CHAT_ID}</code> (অথরাইজড)\n\n` +
    `📊 <b>বর্তমান সিস্টেম অবস্থা:</b>\n` +
    `▫️ একটিভ গেটওয়ে: ${currentActivePhone ? `🟢 +${currentActivePhone}` : "🔴 কোনো সক্রিয় অ্যাকাউন্ট নেই"}\n` +
    `▫️ মোট সংরক্ষিত অ্যাকাউন্ট: ${accounts.length} টি\n` +
    `▫️ মেমরি সেশন: ${activeSessions.size} টি\n` +
    `▫️ টেলিগ্রাম বট: 🟢 অনলাইন (@WhatsappCheckerApi_Bot)\n\n` +
    `🛠 <b>অ্যাডমিন কমান্ডসমূহ:</b>\n` +
    `▫️ <code>/status</code> - সকল ইউজারের লিঙ্ককৃত অ্যাকাউন্টের লাইভ স্ট্যাটাস দেখুন\n` +
    `▫️ <code>/login &lt;ফোন নম্বর&gt;</code> - নতুন হোয়াটসঅ্যাপ গেটওয়ে পেয়ারিং কোড নিন\n` +
    `▫️ <code>/logout &lt;ফোন নম্বর&gt;</code> - যেকোনো অ্যাকাউন্ট বা সেশন ডিলিট করুন\n` +
    `▫️ <code>/check &lt;ফোন নম্বর&gt;</code> - সরাসরি নম্বর ভ্যালিডেশন করুন\n` +
    `▫️ বাল্ক ফাইল আপলোড - আনলিমিটেড নম্বর প্রসেসিং\n\n` +
    `👇 সিস্টেম সেটিংস ম্যানেজ করতে নিচের <b>SETTINGS</b> বাটনে ক্লিক করুন:`
  );
}

export async function handleTelegramCallbackQuery(call) {
  const callId = call.id;
  const data = call.data || "";
  const fromId = call.from?.id;
  const chatId = call.message?.chat?.id || fromId;
  const msgId = call.message?.message_id;

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
            `🎉 *হোয়াটসঅ্যাপ লিঙ্ক সম্পন্ন!* \n\nআপনার হোয়াটসঅ্যাপ অ্যাকাউন্ট (+${phoneNumber}) সফলভাবে যুক্ত হয়েছে এবং আপনার টেলিগ্রাম অ্যাকাউন্টের সাথে লিঙ্ক করা হয়েছে।`
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
      "⚠️ *দুঃখিত, কোনো সক্রিয় হোয়াটসঅ্যাপ অ্যাকাউন্ট সংযুক্ত নেই!* \n\n" +
        "অনুগ্রহ করে প্রথমে বটের সাথে আপনার হোয়াটসঅ্যাপ লিঙ্ক করতে লিখুন: `/login <ফোন নম্বর>`\n" +
        "যেমন: `/login 8801700000000`"
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
    await sendTelegramMessage(chatId, "⚠️ কোনো সঠিক মোবাইল নম্বর পাওয়া যায়নি। অনুগ্রহ করে সঠিক নম্বর ইনপুট দিন।");
    return;
  }

  const progressMsgId = await sendTelegramMessage(
    chatId,
    `🔍 *হোয়াটসঅ্যাপ ডেটাবেজ চেক করা হচ্ছে...*\n\n` +
      `মোট ইউনিক নম্বর: *${normalizedList.length}* টি\n` +
      `সক্রিয় গেটওয়ে: *+${gatewayPhone}*`
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
          `🔍 *হোয়াটসঅ্যাপ ডেটাবেজ চেক করা হচ্ছে...*\n\n` +
            `⏳ অগ্রগতি: *${i + 1}/${normalizedList.length}* (${pct}%)\n` +
            `🟢 সক্রিয়: *${activeWa.length}* | 🔴 নিষ্ক্রিয়: *${inactiveWa.length}*`
        );
      }
    }
  }

  // Small batch: send full list in message
  if (normalizedList.length <= 30) {
    const activeText = activeWa.length > 0 ? activeWa.map((x) => `+${x}`).join("\n") : "_কোনোটিই নয়_";
    const inactiveText = inactiveWa.length > 0 ? inactiveWa.map((x) => `+${x}`).join("\n") : "_কোনোটিই নয়_";

    const report =
      `🤖 *হোয়াটসঅ্যাপ নম্বর চেকার রিপোর্ট*\n\n` +
      `📊 *মোট নম্বর:* ${normalizedList.length} টি\n` +
      `✅ *হোয়াটসঅ্যাপ সক্রিয় (${activeWa.length} টি):*\n${activeText}\n\n` +
      `❌ *হোয়াটসঅ্যাপ খোলা নেই (${inactiveWa.length} টি):*\n${inactiveText}`;

    if (progressMsgId) {
      await editTelegramMessage(chatId, progressMsgId, report);
    } else {
      await sendTelegramMessage(chatId, report);
    }
  } else {
    // Large batch: send summary message + downloadable txt document
    const summary =
      `🤖 *বাল্ক নম্বর চেকার রিপোর্ট (Bulk Summary)*\n\n` +
      `📊 *মোট ইউনিক নম্বর:* ${normalizedList.length} টি\n` +
      `🟢 হোয়াটসঅ্যাপ সক্রিয়: *${activeWa.length}* টি\n` +
      `🔴 হোয়াটসঅ্যাপ নেই: *${inactiveWa.length}* টি\n\n` +
      `📁 নিচে সম্পূর্ণ রেজাল্ট ফাইল আকারে পাঠানো হলো:`;

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

  await sendTelegramMessage(chatId, `⏳ *${fileName}* ফাইলটি প্রসেস করা হচ্ছে... নম্বরগুলো বের করা হচ্ছে।`);

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
      await sendTelegramMessage(chatId, "⚠️ ফাইলটিতে কোনো সঠিক ৮ থেকে ১৫ ডিজিটের মোবাইল নম্বর পাওয়া যায়নি।");
    }
  } catch (err) {
    console.error("[Telegram Doc Error]:", err);
    await sendTelegramMessage(chatId, `❌ ফাইল প্রসেস করতে ব্যর্থ হয়েছে: ${err.message || err}`);
  }
}

// Telegram Message Dispatcher
export async function handleTelegramMessage(message) {
  const chatId = message.chat?.id;
  if (!chatId) return;

  if (message.document) {
    await handleTelegramDocument(chatId, message.document);
    return;
  }

  const text = (message.text || "").trim();
  if (!text) return;

  // /start
  if (text.startsWith("/start")) {
    const isAdmin = String(chatId) === ADMIN_CHAT_ID;
    const adminLine = isAdmin ? `🔘 *ADMIN PANEL* - সিস্টেম অ্যাডমিন কন্ট্রোল প্যানেল\n\n` : `\n`;
    const startMsg =
      `👋 *স্বাগতম! আমি আপনার লিঙ্কফাই হোয়াটসঅ্যাপ চেকার বট।*\n\n` +
      `আপনার টেলিগ্রাম বট থেকে সরাসরি হোয়াটসঅ্যাপ লগইন এবং নম্বর চেক করতে পারবেন। নিচের মেনু বাটনগুলো ব্যবহার করুন:\n\n` +
      `🔘 *CONNECT WS CHECKER* - হোয়াটসঅ্যাপ লিঙ্ক করার পেয়ারিং কোড নিন\n` +
      `🔘 *CHECK WS NUMBER* - হোয়াটসঅ্যাপ নম্বর চেক নির্দেশিকা\n` +
      `🔘 *BUY WS AND TG API* - হোয়াটসঅ্যাপ ও টেলিগ্রাম এপিআই প্যাকেজ ও কি\n` +
      `🔘 *HELP* - সহায়তা এবং সকল কমান্ড\n` +
      `🔘 *MY PROFILE* - আপনার প্রোফাইল ও সংরক্ষিত অ্যাকাউন্টের বিবরণ\n` +
      `🔘 *MY PACKAGE* - বর্তমান প্যাকেজ ও লিমিট স্ট্যাটাস\n` +
      adminLine +
      `📌 *সরাসরি কমান্ডসমূহ:*\n` +
      `▫️ \`/login <ফোন নম্বর>\` - হোয়াটসঅ্যাপ লিঙ্ক করার জন্য ৮ সংখ্যার পেয়ারিং কোড পান। (যেমন: \`/login 8801700000000\`)\n` +
      `▫️ \`/check <ফোন নম্বর>\` - নম্বরটিতে হোয়াটসঅ্যাপ আছে কিনা ইনস্ট্যান্ট চেক করুন। (যেমন: \`/check 8801712345678\`)\n` +
      `▫️ \`/status\` - লিঙ্ককৃত অ্যাকাউন্ট ও কানেকশন অবস্থা দেখুন।\n` +
      `▫️ \`/logout <ফোন নম্বর>\` - অ্যাকাউন্ট মুছে ফেলুন বা ডিসকানেক্ট করুন।\n\n` +
      `💡 *বাল্ক চেক:* মেসেজে একসাথে একাধিক নম্বর লিখুন অথবা কোনো \`.txt\` বা \`.csv\` ফাইল সেন্ড করুন, বট অটোমেটিক চেক করে রিপোর্ট পাঠাবে! 🚀`;
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
    const userAccounts = accounts.filter((a) => a.addedByChatId === chatId);

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

  // /login <phone>
  if (text.startsWith("/login")) {
    const raw = text.substring(6).trim();
    if (!raw) {
      await sendTelegramMessage(chatId, "⚠️ অনুগ্রহ করে ফোন নম্বর লিখুন। যেমন: `/login 8801700000000`");
      return;
    }

    const clean = normalizePhone(raw);
    if (clean.length < 8) {
      await sendTelegramMessage(chatId, "⚠️ সঠিক আন্তর্জাতিক ফোন নম্বর লিখুন (৮-১৫ ডিজিট)।");
      return;
    }

    await sendTelegramMessage(
      chatId,
      `⌛ *+${clean}* নম্বরের জন্য হোয়াটসঅ্যাপ পেয়ারিং কোড জেনারেট হচ্ছে... দয়া করে ১০-১৫ সেকেন্ড অপেক্ষা করুন।`
    );

    const senderName = message.from?.first_name || message.chat?.first_name || "Telegram User";
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
          `🔑 *আপনার হোয়াটসঅ্যাপ পেয়ারিং কোড:* \n\n` +
          `👉 \`${sess.pairingCode}\` 👈\n\n` +
          `*কিভাবে ব্যবহার করবেন:*\n` +
          `১. মোবাইলের WhatsApp অ্যাপ ওপেন করুন।\n` +
          `২. ডান কোণের ৩-ডট মেনু > *Linked Devices* এ যান।\n` +
          `৩. *Link a Device* এ ক্লিক করে নিচে *Link with phone number instead* চাপুন।\n` +
          `৪. স্ক্রিনে কোডটি ইনপুট দিন।\n\n` +
          `বটের সাথে একাউন্ট সফলভাবে সিঙ্ক হয়ে যাবে! 🚀`;
        await sendTelegramMessage(chatId, codeMsg);
      } else if (sess && sess.status === "error") {
        clearInterval(checkTimer);
        await sendTelegramMessage(chatId, `❌ কোড জেনারেট করতে ব্যর্থ হয়েছে: ${sess.error || "সার্ভার রেসপন্স দেয়নি"}`);
      } else if (counter >= maxWait) {
        clearInterval(checkTimer);
        await sendTelegramMessage(
          chatId,
          `⏳ কোড আসতে দেরি হচ্ছে। অনুগ্রহ করে ৩০ সেকেন্ড পর \`/status\` কমান্ড দিয়ে চেক করুন।`
        );
      }
    }, 1000);
    return;
  }

  // /status
  if (text.startsWith("/status")) {
    const saved = getSavedAccountsList();
    if (saved.length === 0) {
      await sendTelegramMessage(chatId, "ℹ️ কোনো হোয়াটসঅ্যাপ অ্যাকাউন্ট লিঙ্ক করা নেই। লিঙ্ক করতে লিখুন: `/login <ফোন নম্বর>`");
      return;
    }

    let statusMsg = `📊 *হোয়াটসঅ্যাপ কানেকশন স্ট্যাটাস:*\n\n`;
    saved.forEach((acc, idx) => {
      const s = activeSessions.get(acc.phone);
      const isOnline = s?.status === "connected";
      const icon = isOnline ? "🟢 Connected" : "🔴 Offline";
      statusMsg += `${idx + 1}. *+${acc.phone}* (${acc.name || "WhatsApp User"})\n   স্ট্যাটাস: ${icon}\n`;
    });

    if (currentActivePhone) {
      statusMsg += `\n🎯 *ডিফল্ট চেকার গেটওয়ে:* \`+${currentActivePhone}\``;
    }

    await sendTelegramMessage(chatId, statusMsg);
    return;
  }

  // /logout <phone>
  if (text.startsWith("/logout")) {
    const raw = text.substring(7).trim();
    if (!raw) {
      await sendTelegramMessage(chatId, "⚠️ ফোন নম্বরটি লিখুন। যেমন: `/logout 8801700000000`");
      return;
    }

    const clean = normalizePhone(raw);
    const deleted = deleteAccountFromDb(clean);
    if (deleted) {
      await sendTelegramMessage(chatId, `✅ *+${clean}* একাউন্টটি সফলভাবে মুছে ফেলা এবং ডিসকানেক্ট করা হয়েছে।`);
    } else {
      await sendTelegramMessage(chatId, `⚠️ *+${clean}* একাউন্টটি তালিকায় খুঁজে পাওয়া যায়নি।`);
    }
    return;
  }

  // /check <phone>
  if (text.startsWith("/check")) {
    const raw = text.substring(6).trim();
    if (!raw) {
      await sendTelegramMessage(chatId, "⚠️ ফোন নম্বর লিখুন। যেমন: `/check 8801712345678`");
      return;
    }
    await checkAndRespondBatch(chatId, [raw]);
    return;
  }

  // Raw text with phone numbers
  const numMatches = text.match(/(\+?[0-9]{8,15})/g);
  if (numMatches && numMatches.length > 0) {
    await checkAndRespondBatch(chatId, numMatches);
  } else {
    await sendTelegramMessage(
      chatId,
      "ℹ️ হোয়াটসঅ্যাপ নম্বর চেক করতে নম্বরটি মেসেজে লিখুন অথবা বিস্তারিত জানতে `/start` লিখুন।"
    );
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
