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
export const TG_TOKEN = process.env.TG_TOKEN || "8887360085:AAGFnQjUY1lnmDwHJTFo3T7O56xFEW9poGU";
export const TG_API_URL = `https://api.telegram.org/bot${TG_TOKEN}`;
export const DB_FILE = path.join(process.cwd(), "db_accounts.json");

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
export const MAIN_MENU_KB = {
  keyboard: [
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
        text: "BUY PACKAGE",
        icon_custom_emoji_id: "5170692113834181832",
        style: "success"
      },
      {
        text: "HELP",
        icon_custom_emoji_id: "5832352677849205948",
        style: "primary"
      }
    ],
    [
      {
        text: "ADMIN PANEL",
        icon_custom_emoji_id: "5764869872521581153",
        style: "danger"
      }
    ]
  ],
  resize_keyboard: true
};

export async function sendTelegramMessage(chatId, text, parseMode = "Markdown", replyMarkup = MAIN_MENU_KB) {
  try {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: parseMode
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
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
      console.error("[Telegram] sendMessage failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[Telegram] Error sending message:", err);
  }
  return null;
}

export async function editTelegramMessage(chatId, messageId, text, parseMode = "Markdown") {
  try {
    const res = await fetch(`${TG_API_URL}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: parseMode }),
    });
    if (!res.ok) {
      console.error("[Telegram] editMessageText failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[Telegram] Error editing message:", err);
  }
}

export async function sendTelegramDocument(chatId, fileContent, fileName, caption) {
  try {
    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append("caption", caption);
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
    const startMsg =
      `👋 *স্বাগতম! আমি আপনার লিঙ্কফাই হোয়াটসঅ্যাপ চেকার বট।*\n\n` +
      `আপনার টেলিগ্রাম বট থেকে সরাসরি হোয়াটসঅ্যাপ লগইন এবং নম্বর চেক করতে পারবেন। নিচের মেনু বাটনগুলো ব্যবহার করুন:\n\n` +
      `🔘 *CONNECT WS CHECKER* - হোয়াটসঅ্যাপ লিঙ্ক করার পেয়ারিং কোড নিন\n` +
      `🔘 *CHECK WS NUMBER* - হোয়াটসঅ্যাপ নম্বর চেক নির্দেশিকা\n` +
      `🔘 *BUY PACKAGE* - প্রিমিয়াম প্যাকেজ ও ক্রেডিট\n` +
      `🔘 *HELP* - সহায়তা এবং সকল কমান্ড\n` +
      `🔘 *ADMIN PANEL* - সিস্টেম অ্যাডমিন কন্ট্রোল প্যানেল\n\n` +
      `📌 *সরাসরি কমান্ডসমূহ:*\n` +
      `▫️ \`/login <ফোন নম্বর>\` - হোয়াটসঅ্যাপ লিঙ্ক করার জন্য ৮ সংখ্যার পেয়ারিং কোড পান। (যেমন: \`/login 8801700000000\`)\n` +
      `▫️ \`/check <ফোন নম্বর>\` - নম্বরটিতে হোয়াটসঅ্যাপ আছে কিনা ইনস্ট্যান্ট চেক করুন। (যেমন: \`/check 8801712345678\`)\n` +
      `▫️ \`/status\` - লিঙ্ককৃত অ্যাকাউন্ট ও কানেকশন অবস্থা দেখুন।\n` +
      `▫️ \`/logout <ফোন নম্বর>\` - অ্যাকাউন্ট মুছে ফেলুন বা ডিসকানেক্ট করুন।\n\n` +
      `💡 *বাল্ক চেক:* মেসেজে একসাথে একাধিক নম্বর লিখুন অথবা কোনো \`.txt\` বা \`.csv\` ফাইল সেন্ড করুন, বট অটোমেটিক চেক করে রিপোর্ট পাঠাবে! 🚀`;
    await sendTelegramMessage(chatId, startMsg, "Markdown", MAIN_MENU_KB);
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
    await sendTelegramMessage(chatId, connectMsg, "Markdown", MAIN_MENU_KB);
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
    await sendTelegramMessage(chatId, checkGuideMsg, "Markdown", MAIN_MENU_KB);
    return;
  }

  if (text === "BUY PACKAGE" || text.includes("BUY PACKAGE")) {
    const buyPkgMsg = 
      `💎 *BUY PACKAGE*\n\n` +
      `আমাদের প্রিমিয়াম প্যাকেজ ও ক্রেডিট প্ল্যান শীঘ্রই যুক্ত হচ্ছে।\n` +
      `বিস্তারিত তথ্য ও কাস্টম প্ল্যানের জন্য অ্যাডমিনের সাথে যোগাযোগ রাখুন।`;
    await sendTelegramMessage(chatId, buyPkgMsg, "Markdown", MAIN_MENU_KB);
    return;
  }

  if (text === "HELP" || text.includes("HELP")) {
    const helpMsg = 
      `📖 *HELP & GUIDELINES*\n\n` +
      `*কিভাবে ব্যবহার করবেন:*\n` +
      `▫️ \`CONNECT WS CHECKER\` - হোয়াটসঅ্যাপ অ্যাকাউন্ট যুক্ত করার নিয়মাবলী\n` +
      `▫️ \`CHECK WS NUMBER\` - নম্বর ফিল্টার ও ভেরিফিকেশন করার গাইড\n` +
      `▫️ \`/login <ফোন নম্বর>\` - পেয়ারিং কোড দিয়ে হোয়াটসঅ্যাপ লিঙ্ক করুন\n` +
      `▫️ \`/check <ফোন নম্বর>\` - নম্বর চেক করুন\n` +
      `▫️ \`/status\` - লিঙ্ককৃত অ্যাকাউন্টের বর্তমান অবস্থা দেখুন\n` +
      `▫️ \`/logout <ফোন নম্বর>\` - অ্যাকাউন্ট মুছে ফেলুন\n` +
      `▫️ ফাইল সেন্ড করুন - আনলিমিটেড বাল্ক নম্বর একসাথে চেক করার জন্য`;
    await sendTelegramMessage(chatId, helpMsg, "Markdown", MAIN_MENU_KB);
    return;
  }

  if (text === "ADMIN PANEL" || text.includes("ADMIN PANEL")) {
    const accounts = getSavedAccountsList();
    const adminMsg = 
      `⚙️ *ADMIN PANEL*\n\n` +
      `স্বাগতম অ্যাডমিন প্যানেলে।\n\n` +
      `📊 *বর্তমান সিস্টেম অবস্থা:*\n` +
      `▫️ একটিভ গেটওয়ে: ${currentActivePhone ? `🟢 +${currentActivePhone}` : "🔴 কোনো সক্রিয় অ্যাকাউন্ট নেই"}\n` +
      `▫️ মোট সংরক্ষিত অ্যাকাউন্ট: ${accounts.length} টি\n` +
      `▫️ টেলিগ্রাম বট: 🟢 অনলাইন (@LinkViral_Xbot)\n\n` +
      `বিস্তারিত অ্যাডমিন কনফিগারেশন শীঘ্রই যোগ করা হচ্ছে।`;
    await sendTelegramMessage(chatId, adminMsg, "Markdown", MAIN_MENU_KB);
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
