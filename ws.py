import os
import re
import json
import asyncio
from datetime import datetime
from typing import Dict, List, Optional
from pydantic import BaseModel
from fastapi import FastAPI, Query, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import httpx

# Playwright Helper
try:
    from playwright.async_api import async_playwright
except ImportError:
    pass

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- GLOBAL STATES ---
active_wa_sessions: Dict[str, dict] = {}
current_active_wa_phone: Optional[str] = None
pw_instance = None
browser_instance = None

DB_FILE = "db_accounts.json"

# --- TELEGRAM BOT CONSTANTS & STATE ---
TG_TOKEN = "8887360085:AAGFnQjUY1lnmDwHJTFo3T7O56xFEW9poGU"
TG_API_URL = f"https://api.telegram.org/bot{TG_TOKEN}"
linking_owners: Dict[str, dict] = {}

# --- UTILS & NORMALIZE ---
def normalize_phone(raw: str) -> str:
    clean = re.sub(r'\D', '', raw)
    if not clean:
        return ""
    if clean.startswith("0") and len(clean) == 11:
        clean = "88" + clean
    elif clean.startswith("1") and len(clean) == 10:
        clean = "880" + clean
    common_codes = [
        "880", "91", "92", "977", "94", "960", "93", "966", "971", "1", "44", "968", "974", "965", "964",
        "962", "961", "967", "60", "65", "81", "82", "62", "63", "66", "84", "95", "855", "52", "55", "54",
        "57", "51", "56", "39", "34", "33", "49", "90", "31", "32", "41", "46", "351", "30", "43", "48", "7",
        "61", "64", "27", "20", "234", "254", "212"
    ]
    common_codes.sort(key=len, reverse=True)
    for cc in common_codes:
        if clean.startswith(cc):
            national = clean[len(cc):]
            while national.startswith("0"):
                national = national[1:]
            clean = f"{cc}{national}"
            break
    return clean

# --- DATABASES ---
def get_saved_accounts_list() -> List[dict]:
    if not os.path.exists(DB_FILE): return []
    try:
        with open(DB_FILE, "r", encoding="utf-8") as f: return json.load(f)
    except: return []

def save_account_to_db(phone: str, name: str, added_by_chat_id: Optional[int] = None, added_by_name: Optional[str] = None):
    accounts = get_saved_accounts_list()
    idx = next((i for i, acc in enumerate(accounts) if acc.get("phone") == phone), -1)
    clean_name = name or "WhatsApp User"
    data = {
        "phone": phone, "name": clean_name, "linkedAt": datetime.now().isoformat()
    }
    if added_by_chat_id is not None:
        data["addedByChatId"] = added_by_chat_id
    if added_by_name is not None:
        data["addedByName"] = added_by_name

    if idx > -1:
        for k, v in data.items():
            if v is not None or k not in accounts[idx]: accounts[idx][k] = v
    else:
        accounts.append(data)
    try:
        with open(DB_FILE, "w", encoding="utf-8") as f: json.dump(accounts, f, indent=2, ensure_ascii=False)
    except Exception as e: print("[DB Log] Error:", e)

def delete_account_from_db(phone: str) -> bool:
    accounts = get_saved_accounts_list()
    filtered = [acc for acc in accounts if acc.get("phone") != phone]
    existed = len(accounts) != len(filtered)
    if existed:
        try:
            with open(DB_FILE, "w", encoding="utf-8") as f: json.dump(filtered, f, indent=2)
        except Exception as e: print("[DB Error]", e)
    return existed

# --- PLAYWRIGHT & WHATSAPP ENGINE ---
async def init_playwright():
    global pw_instance, browser_instance
    if pw_instance is None:
        pw_instance = await async_playwright().start()
        browser_instance = await pw_instance.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        )

async def start_wa_browser(phone: str, is_restore: bool = False):
    auth_dir = f"whatsapp_auth_session_{phone}"
    os.makedirs(auth_dir, exist_ok=True)
    state_file = os.path.join(auth_dir, "storage_state.json")
    await init_playwright()
    
    if os.path.exists(state_file):
        context = await browser_instance.new_context(storage_state=state_file, user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    else:
        context = await browser_instance.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        
    page = await context.new_page()
    active_wa_sessions[phone] = {
        "phoneNumber": phone, "status": "connecting", "pairingCode": "",
        "profile": None, "error": None, "context": context, "page": page
    }
    await page.goto("https://web.whatsapp.com")
    
    try:
        await page.wait_for_selector('div[contenteditable="true"]', timeout=30000)
        active_wa_sessions[phone]["status"] = "connected"
        active_wa_sessions[phone]["profile"] = {"name": "WhatsApp User", "phone": phone}
        await context.storage_state(path=state_file)
        
        owner = linking_owners.get(phone, {})
        save_account_to_db(phone, "WhatsApp User", owner.get("chatId"), owner.get("name"))
        if owner.get("chatId"):
            asyncio.create_task(send_telegram_message(
                owner["chatId"],
                f"🎉 *হোয়াটসঅ্যাপ লিঙ্ক সম্পন্ন!* \n\nআপনার হোয়াটসঅ্যাপ অ্যাকাউন্ট (+{phone}) সফলভাবে যুক্ত করা হয়েছে এবং আপনার টেলিগ্রাম আইডি ও অ্যাকাউন্টের সাথে লিঙ্ক করা হয়েছে।"
            ))
    except:
        if not is_restore:
            asyncio.create_task(run_pairing_flow(phone, page, context, state_file))
        else:
            active_wa_sessions[phone]["status"] = "disconnected"

async def run_pairing_flow(phone: str, page, context, state_file: str):
    try:
        btn = await page.wait_for_selector('text="Link with phone number"', timeout=20000)
        await btn.click()
        await page.wait_for_selector('input[type="text"]', timeout=5000)
        await page.locator('input[type="text"]').fill("")
        await page.locator('input[type="text"]').type(phone, delay=50)
        next_btn = await page.wait_for_selector('text="Next"', timeout=5000)
        await next_btn.click()
        
        active_wa_sessions[phone]["status"] = "pairing-code-ready"
        code = ""
        for _ in range(30):
            content = await page.content()
            m = re.search(r'\b([A-Z0-9]{4}-[A-Z0-9]{4})\b', content)
            if m:
                code = m.group(1)
                break
            await asyncio.sleep(1)
            
        if code:
            active_wa_sessions[phone]["pairingCode"] = code
            print(f"[WA Pairing] Generated code for +{phone} is: {code}")
            # Poll linking success
            for _ in range(90): # 3 minutes poll timeout
                if phone not in active_wa_sessions: break
                if await page.locator('div[contenteditable="true"]').count() > 0:
                    active_wa_sessions[phone]["status"] = "connected"
                    active_wa_sessions[phone]["profile"] = {"name": "WhatsApp User", "phone": phone}
                    await context.storage_state(path=state_file)
                    
                    owner = linking_owners.get(phone, {})
                    save_account_to_db(phone, "WhatsApp User", owner.get("chatId"), owner.get("name"))
                    if owner.get("chatId"):
                        asyncio.create_task(send_telegram_message(
                            owner["chatId"],
                            f"🎉 *হোয়াটসঅ্যাপ লিঙ্ক সম্পন্ন!* \n\nআপনার হোয়াটসঅ্যাপ অ্যাকাউন্ট (+{phone}) সফলভাবে যুক্ত করা হয়েছে এবং আপনার টেলিগ্রাম আইডি ও অ্যাকাউন্টের সাথে লিঙ্ক করা হয়েছে।"
                        ))
                    break
                await asyncio.sleep(2)
        else:
            active_wa_sessions[phone]["status"] = "error"
            active_wa_sessions[phone]["error"] = "Code scraping timeout"
    except Exception as e:
        active_wa_sessions[phone]["status"] = "error"
        active_wa_sessions[phone]["error"] = str(e)

async def check_wa_num(phone: str, target: str) -> bool:
    sess = active_wa_sessions.get(phone)
    if not sess or sess.get("status") != "connected": return False
    page = await sess["context"].new_page()
    try:
        clean = re.sub(r'\D', '', target)
        await page.goto(f"https://web.whatsapp.com/send?phone={clean}")
        for _ in range(25):
            if await page.locator('div[contenteditable="true"]').count() > 0: return True
            if await page.locator('text="invalid"').count() > 0 or await page.locator('text="OK"').count() > 0: return False
            await asyncio.sleep(0.5)
        return False
    except: return False
    finally: await page.close()

async def send_wa_msg(phone: str, target: str, text: str) -> bool:
    sess = active_wa_sessions.get(phone)
    if not sess or sess.get("status") != "connected": return False
    page = sess["page"]
    try:
        clean = re.sub(r'\D', '', target)
        await page.goto(f"https://web.whatsapp.com/send?phone={clean}")
        for _ in range(30):
            if await page.locator('div[contenteditable="true"]').count() > 0:
                box = page.locator('div[contenteditable="true"]').first
                await box.click()
                await box.type(text, delay=10)
                await page.keyboard.press("Enter")
                await asyncio.sleep(1.5)
                return True
            if await page.locator('text="invalid"').count() > 0 or await page.locator('text="OK"').count() > 0: return False
            await asyncio.sleep(0.5)
        return False
    except: return False

# --- FASTAPI ENDPOINTS ---
@app.get("/api/request-code")
async def api_request_code(phone: str = Query(...)):
    cleaned = normalize_phone(phone)
    if len(cleaned) < 8: raise HTTPException(status_code=400, detail="Invalid phone format")
    global current_active_wa_phone
    current_active_wa_phone = cleaned
    asyncio.create_task(start_wa_browser(cleaned))
    return {"status": "processing", "phone": cleaned}

@app.get("/api/status")
async def api_status():
    if not current_active_wa_phone: return {"status": "disconnected", "phone": "", "pairingCode": "", "profile": None, "error": None}
    s = active_wa_sessions.get(current_active_wa_phone, {"status": "disconnected", "phoneNumber": current_active_wa_phone, "pairingCode": "", "profile": None, "error": None})
    return {"status": s.get("status"), "phone": s.get("phoneNumber"), "pairingCode": s.get("pairingCode"), "profile": s.get("profile"), "error": s.get("error")}

@app.get("/api/reset-session")
async def api_reset_session():
    global current_active_wa_phone
    if current_active_wa_phone:
        delete_account_from_db(current_active_wa_phone)
        s = active_wa_sessions.pop(current_active_wa_phone, None)
        if s:
            try: await s["context"].close()
            except: pass
        saved = get_saved_accounts_list()
        current_active_wa_phone = saved[0]["phone"] if saved else None
    return {"status": "ok"}

class SendMsgBody(BaseModel):
    to: str
    text: str

@app.post("/api/send-message")
async def api_send_message(body: SendMsgBody):
    if not current_active_wa_phone or active_wa_sessions.get(current_active_wa_phone, {}).get("status") != "connected":
        raise HTTPException(status_code=400, detail="WhatsApp is not connected.")
    success = await send_wa_msg(current_active_wa_phone, body.to, body.text)
    if success: return {"success": True}
    raise HTTPException(status_code=500, detail="Failed to send")

@app.get("/api/check-phone")
async def api_check_phone(phone: str = Query(...)):
    if not current_active_wa_phone or active_wa_sessions.get(current_active_wa_phone, {}).get("status") != "connected":
        raise HTTPException(status_code=400, detail="WhatsApp is not connected.")
    res = await check_wa_num(current_active_wa_phone, phone)
    cl = normalize_phone(phone)
    return {"exists": res, "phone": cl, "jid": f"{cl}@s.whatsapp.net" if res else None}

class BulkCheckBody(BaseModel):
    phones: List[str]

@app.post("/api/check-phone-bulk")
async def api_check_phone_bulk(body: BulkCheckBody):
    if not current_active_wa_phone or active_wa_sessions.get(current_active_wa_phone, {}).get("status") != "connected":
        raise HTTPException(status_code=400, detail="WhatsApp is not connected.")
    exists, not_exists = [], []
    for p in body.phones:
        res = await check_wa_num(current_active_wa_phone, p)
        cl = normalize_phone(p)
        if res: exists.append({"phone": cl, "jid": f"{cl}@s.whatsapp.net", "original": p})
        else: not_exists.append({"phone": cl, "original": p})
    return {"exists": exists, "notExists": not_exists, "total": len(body.phones)}

@app.get("/api/accounts")
async def api_accounts_list():
    saved = get_saved_accounts_list()
    res = []
    for acc in saved:
        ph = acc["phone"]
        sess = active_wa_sessions.get(ph)
        res.append({**acc, "status": sess.get("status") if sess else "disconnected", "error": sess.get("error") if sess else None})
    return {"accounts": res, "currentActivePhone": current_active_wa_phone}

class SwitchAccountBody(BaseModel):
    phone: str

@app.post("/api/switch-account")
async def api_switch_wa(body: SwitchAccountBody):
    global current_active_wa_phone
    current_active_wa_phone = body.phone
    return {"success": True, "currentActivePhone": current_active_wa_phone}

class DeleteAccountBody(BaseModel):
    phone: str

@app.post("/api/delete-account")
async def api_delete_account(body: DeleteAccountBody):
    success = delete_account_from_db(body.phone)
    sess = active_wa_sessions.pop(body.phone, None)
    if sess:
        try: await sess["context"].close()
        except: pass
    global current_active_wa_phone
    if current_active_wa_phone == body.phone:
        saved = get_saved_accounts_list()
        current_active_wa_phone = saved[0]["phone"] if saved else None
    return {"success": success}

# --- TELEGRAM BOT SERVICES ---

_MAIN_MENU_KB = {
    "keyboard": [
        [
            {
                "text": "CONNECT WS CHECKER",
                "icon_custom_emoji_id": "5429612632430654504",
                "style": "primary"
            },
        ],
        [
            {
                "text": "CHECK WS NUMBER",
                "icon_custom_emoji_id": "5429612632430654504",
                "style": "success"
            },
        ],
        [
            {
                "text": "BUY PACKAGE",
                "icon_custom_emoji_id": "5170692113834181832",
                "style": "success"
            },
            {
                "text": "HELP",
                "icon_custom_emoji_id": "5832352677849205948",
                "style": "primary"
            },
        ],
        [
            {
                "text": "ADMIN PANEL",
                "icon_custom_emoji_id": "5764869872521581153",
                "style": "danger"
            },
        ],
    ],
    "resize_keyboard": True
}

async def send_telegram_message(chat_id: int, text: str, parse_mode: str = "Markdown", reply_markup: Optional[dict] = None) -> Optional[int]:
    try:
        async with httpx.AsyncClient() as client:
            payload = {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": parse_mode
            }
            markup = reply_markup if reply_markup is not None else _MAIN_MENU_KB
            if markup:
                payload["reply_markup"] = markup

            resp = await client.post(
                f"{TG_API_URL}/sendMessage",
                json=payload,
                timeout=10.0
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("result", {}).get("message_id")
            else:
                print(f"[Telegram Bot] sendMessage status: {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"[Telegram Bot] Error sending message: {e}")
    return None

async def edit_telegram_message(chat_id: int, message_id: int, text: str, parse_mode: str = "Markdown"):
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{TG_API_URL}/editMessageText",
                json={
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "text": text,
                    "parse_mode": parse_mode
                },
                timeout=10.0
            )
            if resp.status_code != 200:
                print(f"[Telegram Bot] editMessageText status: {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"[Telegram Bot] Error editing message: {e}")

async def send_telegram_document(chat_id: int, file_content: str, file_name: str, caption: str):
    try:
        async with httpx.AsyncClient() as client:
            files = {'document': (file_name, file_content.encode('utf-8'), 'text/plain')}
            data = {'chat_id': str(chat_id), 'caption': caption}
            resp = await client.post(
                f"{TG_API_URL}/sendDocument",
                data=data,
                files=files,
                timeout=20.0
            )
            if resp.status_code != 200:
                print(f"[Telegram Bot] sendDocument status: {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"[Telegram Bot] Error sending document: {e}")

async def check_and_respond_batch(chat_id: int, raw_numbers: List[str]):
    global current_active_wa_phone
    resolved_phone = None
    saved = get_saved_accounts_list()
    my_accounts = [acc for acc in saved if acc.get("addedByChatId") == chat_id]
    
    for acc in my_accounts:
        ph = acc.get("phone")
        sess = active_wa_sessions.get(ph)
        if sess and sess.get("status") == "connected":
            resolved_phone = ph
            break
            
    if not resolved_phone and current_active_wa_phone:
        sess = active_wa_sessions.get(current_active_wa_phone)
        if sess and sess.get("status") == "connected":
            resolved_phone = current_active_wa_phone
            
    if not resolved_phone:
        for ph, sess in active_wa_sessions.items():
            if sess.get("status") == "connected":
                resolved_phone = ph
                break
                
    if not resolved_phone:
        await send_telegram_message(
            chat_id,
            "⚠️ *দুঃখিত, কোনো সক্রিয় হোয়াটসঅ্যাপ অ্যাকাউন্ট সংযুক্ত নেই!* \n\n"
            "অনুগ্রহ করে প্রথমে বটের সাথে নতুন অ্যাকাউন্ট লিঙ্ক করতে টাইপ করুন: \`/login <ফোন নম্বর>\`।"
        )
        return

    normalized_list = []
    seen = set()
    for num in raw_numbers:
        clean = normalize_phone(num)
        if not clean or len(clean) < 6:
            continue
        if clean in seen:
            continue
        seen.add(clean)
        normalized_list.append((clean, num))

    if not normalized_list:
        await send_telegram_message(chat_id, "⚠️ কোনো সঠিক মোবাইল নম্বর খুঁজে পাওয়া যায়নি। দয়া করে সঠিক নম্বর ইনপুট দিন।")
        return

    progress_msg_id = await send_telegram_message(
        chat_id,
        f"🔍 *হোয়াটসঅ্যাপ ডেটাবেজ চেক করা হচ্ছে...* \n\n"
        f"মোট ইউনিক নম্বর: *{len(normalized_list)}* টি।\n"
        f"সক্রিয় গেটওয়ে: *+{resolved_phone}*"
    )

    active_wa = []
    inactive_wa = []

    for i, (clean, orig) in enumerate(normalized_list):
        res = await check_wa_num(resolved_phone, clean)
        if res:
            active_wa.append(clean)
        else:
            inactive_wa.append(clean)

        if len(normalized_list) > 3 and (i % 3 == 0 or i == len(normalized_list) - 1):
            percentage = round(((i + 1) / len(normalized_list)) * 100)
            await edit_telegram_message(
                chat_id,
                progress_msg_id,
                f"🔍 *হোয়াটসঅ্যাপ ডেটাবেজ চেক করা হচ্ছে...* \n\n"
                f"⏳ অগ্রগতি: *{i + 1}/{len(normalized_list)}* টি নম্বর চেক সম্পন্ন হয়েছে (*{percentage}%*)।\n"
                f"🟢 সক্রিয়: *{len(active_wa)}* | 🔴 নিষ্ক্রিয়: *{len(inactive_wa)}*"
            )

    if len(normalized_list) <= 30:
        active_list_str = "\n".join([f"+{x}" for x in active_wa]) if active_wa else "_কোনোটিই নয়_"
        inactive_list_str = "\n".join([f"+{x}" for x in inactive_wa]) if inactive_wa else "_কোনোটিই নয়_"
        
        result_report = (
            f"🤖 *বাল্ক নম্বর চেকার রিপোর্ট (Bulk Report)*\n\n"
            f"📊 *মোট ইউনিক নম্বর:* {len(normalized_list)} টি\n"
            f"✅ *হোয়াটসঅ্যাপ রয়েছে ({len(active_wa)} টি):*\n"
            f"{active_list_str}\n\n"
            f"❌ *হোয়াটসঅ্যাপ খোলা নেই ({len(inactive_wa)} টি):*\n"
            f"{inactive_list_str}"
        )
        await edit_telegram_message(chat_id, progress_msg_id, result_report)
    else:
        active_text = "\n".join([f"+{x}" for x in active_wa])
        inactive_text = "\n".join([f"+{x}" for x in inactive_wa])
        
        summary_report = (
            f"🤖 *বাল্ক নম্বর চেকার রিপোর্ট (Bulk Report)*\n\n"
            f"📊 *মোট ইউনিক নম্বর:* {len(normalized_list)} টি\n"
            f"🟢 হোয়াটসঅ্যাপ রয়েছে (সক্রিয়): *{len(active_wa)}* টি\n"
            f"🔴 হোয়াটসঅ্যাপ খোলা নেই: *{len(inactive_wa)}* টি\n\n"
            f"💡 সম্পূর্ণ টেক্সট ফাইল তালিকা নিচে আপলোড করা হলো।"
        )
        await edit_telegram_message(chat_id, progress_msg_id, summary_report)
        
        file_content = (
            f"==== ACTIVE WHATSAPP NUMBERS ({len(active_wa)}) ====\n"
            f"{active_text}\n\n"
            f"==== INACTIVE WHATSAPP NUMBERS ({len(inactive_wa)}) ====\n"
            f"{inactive_text}"
        )
        await send_telegram_document(
            chat_id,
            file_content,
            f"wa_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt",
            f"📂 Active: {len(active_wa)} | Inactive: {len(inactive_wa)}"
        )

async def handle_telegram_document_message(chat_id: int, document: dict):
    file_id = document.get("file_id")
    file_name = document.get("file_name", "numbers.txt")
    await send_telegram_message(chat_id, f"⏳ *{file_name}* ফাইলটি প্রসেস করা হচ্ছে... নম্বরগুলো নিষ্কাশন করা হচ্ছে।")
    
    try:
        async with httpx.AsyncClient() as client:
            file_info_res = await client.get(f"{TG_API_URL}/getFile", params={"file_id": file_id}, timeout=10.0)
            if file_info_res.status_code != 200:
                raise Exception(f"Telegram getFile API failed with status {file_info_res.status_code}")
                
            file_info_data = file_info_res.json()
            if not file_info_data.get("ok") or not file_info_data.get("result", {}).get("file_path"):
                raise Exception("Failed to resolve file path from Telegram API response.")
                
            file_path = file_info_data["result"]["file_path"]
            file_download_url = f"https://api.telegram.org/file/bot{TG_TOKEN}/{file_path}"
            file_download_res = await client.get(file_download_url, timeout=20.0)
            if file_download_res.status_code != 200:
                raise Exception(f"Failed to download file from Telegram storage: {file_download_res.reason_phrase}")
                
            file_text = file_download_res.text
            matches = re.findall(r'(\+?[0-9]{8,15})', file_text)
            if matches:
                await check_and_respond_batch(chat_id, matches)
            else:
                await send_telegram_message(
                    chat_id,
                    "⚠️ ফাইলটিতে কোনো সঠিক ৮ থেকে ১৫ ডিজিটের মোবাইল নম্বর পাওয়া যায়নি। অনুগ্রহ করে সঠিক টেক্সট বা সিএসভি ফাইল আপলোড দিন।"
                )
    except Exception as e:
        print(f"[Telegram Bot] Error processing document: {e}")
        await send_telegram_message(chat_id, f"❌ ফাইল প্রসেস করার সময় ভুল হয়েছে: {str(e)}")

async def handle_telegram_message(message: dict):
    global current_active_wa_phone
    chat_id = message.get("chat", {}).get("id")
    if not chat_id:
        return
        
    if "document" in message:
        await handle_telegram_document_message(chat_id, message["document"])
        return
        
    text = message.get("text", "").strip() if "text" in message else ""
    if not text:
        return
        
    if text.startswith("/start"):
        start_msg = (
            f"👋 *স্বাগতম! আমি আপনার লিঙ্কফাই হোয়াটসঅ্যাপ রোবট (Linkify Bot)।*\n\n"
            f"আপনার টেলিগ্রাম বট থেকে সরাসরি হোয়াটসঅ্যাপ লগইন এবং নম্বর চেক করতে পারবেন। নিচের মেনু বাটনগুলো ব্যবহার করুন:\n\n"
            f"🔘 *CONNECT WS CHECKER* - হোয়াটসঅ্যাপ লিঙ্ক করার পেয়ারিং কোড নিন\n"
            f"🔘 *CHECK WS NUMBER* - হোয়াটসঅ্যাপ নম্বর চেক নির্দেশিকা\n"
            f"🔘 *BUY PACKAGE* - প্রিমিয়াম প্যাকেজ ও ক্রেডিট\n"
            f"🔘 *HELP* - সহায়তা এবং সকল কমান্ড\n"
            f"🔘 *ADMIN PANEL* - সিস্টেম অ্যাডমিন কন্ট্রোল প্যানেল\n\n"
            f"📌 *সরাসরি কমান্ডসমূহ (Commands):*\n"
            f"▫️ \`/login <ফোন নম্বর>\` - হোয়াটসঅ্যাপ লিঙ্ক করার জন্য কোড পান। (যেমন: \`/login 8801700000000\`)\n"
            f"▫️ \`/check <ফোন নম্বর>\` - কোনো একটি নাম্বারের হোয়াটসঅ্যাপ আইডি আছে কিনা চেক করুন। (যেমন: \`/check 8801712345678\`)\n"
            f"▫️ \`/status\` - লিঙ্ককৃত হোয়াটসঅ্যাপ এ্যাকাউন্ট এবং কানেকশন স্ট্যাটাস দেখার জন্য।\n"
            f"▫️ \`/logout <ফোন নম্বর>\` - কোনো অ্যাকাউন্ট মুছে ফেলার জন্য। (যেমন: \`/logout 8801700000000\`)\n\n"
            f"💡 *বাল্ক হোয়াটসঅ্যাপ চেক:* যেকোনো সাধারণ মেসেজে এক বা একাধিক মোবাইল নম্বর একসাথে পাঠালে অথবা কোনো টেক্সট/সিএসভি ফাইল আপলোড করলে আমি অটো চেক করে একটি চমৎকার রিপোর্ট পাঠিয়ে দেবো!"
        )
        await send_telegram_message(chat_id, start_msg, "Markdown", _MAIN_MENU_KB)
        return

    # --- MENU BUILDER BUTTON ACTIONS ---
    if text == "CONNECT WS CHECKER" or "CONNECT WS CHECKER" in text:
        connect_msg = (
            f"🔗 *CONNECT WS CHECKER*\n\n"
            f"আপনার হোয়াটসঅ্যাপ অ্যাকাউন্ট বটের সাথে কানেক্ট করতে নিচের নিয়মে কমান্ড দিন:\n"
            f"👉 \`/login <ফোন নম্বর>\`\n\n"
            f"*উদাহরণ:*\n"
            f"\`/login 8801700000000\`\n\n"
            f"ℹ️ কমান্ড পাঠালে আপনি একটি ৮-ডিজিটের পেয়ারিং কোড পাবেন যা দিয়ে মোবাইলের WhatsApp অ্যাপ থেকে *Linked Devices* এ গিয়ে লিঙ্ক করতে পারবেন।"
        )
        await send_telegram_message(chat_id, connect_msg, "Markdown", _MAIN_MENU_KB)
        return

    if text == "CHECK WS NUMBER" or "CHECK WS NUMBER" in text:
        check_guide_msg = (
            f"🔍 *CHECK WS NUMBER*\n\n"
            f"হোয়াটসঅ্যাপ নম্বর চেক করার বিভিন্ন সহজ উপায়:\n\n"
            f"১️⃣ *সিঙ্গেল নম্বর:* কমান্ড দিন \`/check <ফোন নম্বর>\` (যেমন: \`/check 8801712345678\`)\n"
            f"২️⃣ *দ্রুত চেক:* এক বা একাধিক নম্বর সরাসরি মেসেজে লিখে পাঠিয়ে দিন\n"
            f"৩️⃣ *বাল্ক ফাইল চেক:* নম্বরগুলোর একটি \`.txt\` বা \`.csv\` ফাইল এখানে আপলোড দিন\n\n"
            f"বট সাথে সাথে ফিল্টার করে সক্রিয় ও নিষ্ক্রিয় তালিকা জানিয়ে দেবে! ⚡"
        )
        await send_telegram_message(chat_id, check_guide_msg, "Markdown", _MAIN_MENU_KB)
        return

    if text == "BUY PACKAGE" or "BUY PACKAGE" in text:
        buy_pkg_msg = (
            f"💎 *BUY PACKAGE*\n\n"
            f"আমাদের প্রিমিয়াম প্যাকেজ ও ক্রেডিট প্ল্যান শীঘ্রই যুক্ত হচ্ছে।\n"
            f"বিস্তারিত তথ্য ও কাস্টম প্ল্যানের জন্য অ্যাডমিনের সাথে যোগাযোগ রাখুন।"
        )
        await send_telegram_message(chat_id, buy_pkg_msg, "Markdown", _MAIN_MENU_KB)
        return

    if text == "HELP" or "HELP" in text:
        help_msg = (
            f"📖 *HELP & GUIDELINES*\n\n"
            f"*কিভাবে ব্যবহার করবেন:*\n"
            f"▫️ \`CONNECT WS CHECKER\` - হোয়াটসঅ্যাপ অ্যাকাউন্ট যুক্ত করার নিয়মাবলী\n"
            f"▫️ \`CHECK WS NUMBER\` - নম্বর ফিল্টার ও ভেরিফিকেশন করার গাইড\n"
            f"▫️ \`/login <ফোন নম্বর>\` - পেয়ারিং কোড দিয়ে হোয়াটসঅ্যাপ লিঙ্ক করুন\n"
            f"▫️ \`/check <ফোন নম্বর>\` - নম্বর চেক করুন\n"
            f"▫️ \`/status\` - লিঙ্ককৃত অ্যাকাউন্টের বর্তমান অবস্থা দেখুন\n"
            f"▫️ \`/logout <ফোন নম্বর>\` - অ্যাকাউন্ট মুছে ফেলুন\n"
            f"▫️ ফাইল সেন্ড করুন - আনলিমিটেড বাল্ক নম্বর একসাথে চেক করার জন্য"
        )
        await send_telegram_message(chat_id, help_msg, "Markdown", _MAIN_MENU_KB)
        return

    if text == "ADMIN PANEL" or "ADMIN PANEL" in text:
        accounts = get_saved_accounts_list()
        admin_msg = (
            f"⚙️ *ADMIN PANEL*\n\n"
            f"স্বাগতম অ্যাডমিন প্যানেলে।\n\n"
            f"📊 *বর্তমান সিস্টেম অবস্থা:*\n"
            f"▫️ একটিভ গেটওয়ে: {f'🟢 +{current_active_wa_phone}' if current_active_wa_phone else '🔴 কোনো সক্রিয় অ্যাকাউন্ট নেই'}\n"
            f"▫️ মোট সংরক্ষিত অ্যাকাউন্ট: {len(accounts)} টি\n"
            f"▫️ টেলিগ্রাম বট: 🟢 অনলাইন (@LinkViral_Xbot)\n\n"
            f"বিস্তারিত অ্যাডমিন কনফিগারেশন শীঘ্রই যোগ করা হচ্ছে।"
        )
        await send_telegram_message(chat_id, admin_msg, "Markdown", _MAIN_MENU_KB)
        return

    if text.startswith("/login"):
        raw_phone_input = text[6:].strip()
        if not raw_phone_input:
            await send_telegram_message(chat_id, "⚠️ অনুগ্রহ করে ফোন নম্বরটি লিখুন। যেমন: `/login 8801700000000` ")
            return
            
        phone_cleaned = normalize_phone(raw_phone_input)
        if len(phone_cleaned) < 8:
            await send_telegram_message(chat_id, "⚠️ অনুগ্রহ করে সঠিক ফোন নম্বরটি লিখুন। যেমন: `/login 8801700000000` ")
            return
            
        await send_telegram_message(chat_id, f"⌛ *+{phone_cleaned}* নম্বরের জন্য হোয়াটসঅ্যাপ সার্ভার থেকে কানেকশন কোড জেনারেট হচ্ছে... দয়া করে অপেক্ষা করুন।")
        
        sender_name = message.get("from", {}).get("first_name") or message.get("chat", {}).get("first_name") or "Telegram User"
        linking_owners[phone_cleaned] = {"chatId": chat_id, "name": sender_name}
        
        current_active_wa_phone = phone_cleaned
        
        asyncio.create_task(start_wa_browser(phone_cleaned))
        
        counter = 0
        max_retries = 15
        while counter < max_retries:
            await asyncio.sleep(1.0)
            counter += 1
            current_session = active_wa_sessions.get(phone_cleaned)
            if current_session and current_session.get("status") == "pairing-code-ready" and current_session.get("pairingCode"):
                code = current_session.get("pairingCode")
                code_msg = (
                    f"🔑 *আপনার হোয়াটসঅ্যাপ পেয়ারিং কোড:* \n\n"
                    f"👉 `{code}` 👈\n\n"
                    f"*কিভাবে ব্যবহার করবেন:*\n"
                    f"১. আপনার মোবাইলের WhatsApp অ্যাপ ওপেন করুন।\n"
                    f"২. ডান কোণের থ্রি-ডট মেনু থেকে *Linked Devices* এ ক্লিক করুন।\n"
                    f"৩. *Link a Device* বাটনে ট্যাপ করে নিচে *Link with phone number instead* অপশনটি সিলেক্ট করুন।\n"
                    f"৪. স্ক্রিনে কোডটি ইনপুট দিন।\n\n"
                    f"বটের সাথে একাউন্ট সফলভাবে সিঙ্ক হয়ে যাবে! 🚀"
                )
                await send_telegram_message(chat_id, code_msg)
                break
            elif current_session and current_session.get("status") == "error":
                err = current_session.get("error", "WhatsApp Server Refusal")
                await send_telegram_message(chat_id, f"❌ কোড জেনারেট করতে ব্যর্থ হয়েছে।\nকারণ: {err}")
                break
            elif counter >= max_retries:
                await send_telegram_message(chat_id, f"⏳ কোড সিস্টেমে জেনারেট হতে একটু সময় নিচ্ছে। অনুগ্রহ করে ১ মিনিট পর \`/status\` কমান্ড দিয়ে চেক করুন।")
        return

    if text.startswith("/status"):
        saved = get_saved_accounts_list()
        if not saved:
            await send_telegram_message(
                chat_id,
                "ℹ️ লোকাল ডাটাবেজে কোনো হোয়াটসঅ্যাপ অ্যাকাউন্ট লিঙ্ক করা নেই। লিঙ্ক করতে অনুগ্রহ করে `/login <ফোন নম্বর>` লিখুন।"
            )
            return
            
        my_accounts = [acc for acc in saved if acc.get("addedByChatId") == chat_id]
        other_accounts = [acc for acc in saved if acc.get("addedByChatId") and acc.get("addedByChatId") != chat_id]
        
        status_msg = "📊 *হোয়াটসঅ্যাপ কানেকশন স্ট্যাটাস:* \n\n"
        
        if my_accounts:
            status_msg += f"👤 *আপনার নিজস্ব লিঙ্ককৃত অ্যাকাউন্টসমূহ ({len(my_accounts)} টি):*\n"
            for idx, acc in enumerate(my_accounts):
                ph = acc.get("phone")
                active_s = active_wa_sessions.get(ph)
                online_status = active_s.get("status") if active_s else "disconnected"
                status_emoji = "🟢 Connected" if online_status == "connected" else "🟡 Connecting" if online_status == "connecting" else "🔴 Offline"
                status_msg += f"{idx + 1}. *+{ph}* ({acc.get('name') or 'WhatsApp User'})\n   স্ট্যাটাস: ${status_emoji}\n"
            status_msg += "\n"
        else:
            status_msg += "⚠️ *আপনার নিজস্ব কোনো লিঙ্ককৃত অ্যাকাউন্ট নেই!*\nনতুন অ্যাকাউন্ট লিঙ্ক করতে টাইপ করুন: \`/login <ফোন নম্বর>\`।\n\n"
            
        if other_accounts:
            status_msg += f"👥 *অন্যান্য ব্যবহারকারীদের অ্যাকাউন্টসমূহ ({len(other_accounts)} টি):*\n"
            for idx, acc in enumerate(other_accounts):
                ph = acc.get("phone")
                active_s = active_wa_sessions.get(ph)
                online_status = active_s.get("status") if active_s else "disconnected"
                status_emoji = "🟢 Online" if online_status == "connected" else "🔴 Offline"
                masked_phone = ph[:5] + "****" + ph[-3:]
                status_msg += f"{idx + 1}. *+{masked_phone}* (যোগ করেছেন: {acc.get('addedByName') or 'ব্যবহারকারী'})\n   স্ট্যাটাস: {status_emoji}\n"
            status_msg += "\n"
            
        if current_active_wa_phone:
            is_my_choice = any(acc.get("phone") == current_active_wa_phone for acc in my_accounts)
            tag = "(আপনার অ্যাকাউন্ট)" if is_my_choice else "(অন্য ব্যবহারকারী/সিস্টেম)"
            status_msg += f"🎯 *ডিফল্ট রানটাইম গেটওয়ে:* `+{current_active_wa_phone}` {tag}"
            
        await send_telegram_message(chat_id, status_msg)
        return

    if text.startswith("/logout"):
        raw_phone_input = text[7:].strip()
        if not raw_phone_input:
            await send_telegram_message(chat_id, "⚠️ অনুগ্রহ করে ফোন নম্বরটি লিখুন। যেমন: `/logout 8801700000000` ")
            return
            
        phone_cleaned = normalize_phone(raw_phone_input)
        existed = delete_account_from_db(phone_cleaned)
        
        sess = active_wa_sessions.pop(phone_cleaned, None)
        if sess:
            try:
                await sess["context"].close()
            except:
                pass
                
        if current_active_wa_phone == phone_cleaned:
            saved = get_saved_accounts_list()
            current_active_wa_phone = saved[0]["phone"] if saved else None
            
        if existed:
            await send_telegram_message(chat_id, f"✅ *+{phone_cleaned}* অ্যাকাউন্টটি লোকাল ডাটাবেজ থেকে মুছে ফেলা এবং সেশন ডিসকানেক্ট করা হয়েছে।")
        else:
            await send_telegram_message(chat_id, f"⚠️ *+{phone_cleaned}* অ্যাকাউন্টটি লোকাল ডাটাবেজে পাওয়া যায়নি।")
        return

    if text.startswith("/check"):
        raw_phone_input = text[6:].strip()
        if not raw_phone_input:
            await send_telegram_message(chat_id, "⚠️ অনুগ্রহ করে ফোন নম্বরটি লিখুন। যেমন: `/check 8801712345678` ")
            return
        await check_and_respond_batch(chat_id, [raw_phone_input])
        return

    matches = re.findall(r'(\+?[0-9]{8,15})', text)
    if matches:
        await check_and_respond_batch(chat_id, matches)
    else:
        await send_telegram_message(
            chat_id,
            "ℹ️ অনুগ্রহ করে হোয়াটসঅ্যাপ চেক করার জন্য কোনো নম্বর প্রেরণ করুন অথবা বটের বিস্তারিত তালিকা নিয়ে স্টার্ট দিতে `/start` লিখুন।"
        )

async def start_telegram_bot():
    print(f"[Telegram Bot] Starting custom long-polling thread for token: {TG_TOKEN[:8]}...")
    
    # Reset any existing Telegram webhook to make sure we can poll via getUpdates
    try:
        async with httpx.AsyncClient() as client:
            del_resp = await client.post(f"{TG_API_URL}/deleteWebhook", timeout=10.0)
            print(f"[Telegram Bot] deleteWebhook on startup: {del_resp.status_code} - {del_resp.text}")
            
            # Check bot profile details
            me_resp = await client.get(f"{TG_API_URL}/getMe", timeout=10.0)
            if me_resp.status_code == 200:
                me_data = me_resp.json()
                bot_user = me_data.get("result", {}).get("username", "Unknown")
                print(f"[Telegram Bot] Connected successfully to bot: @{bot_user} (ID: {me_data.get('result', {}).get('id')})")
            else:
                print(f"[Telegram Bot] WARNING: getMe returned status {me_resp.status_code} - {me_resp.text}")
    except Exception as e:
        print(f"[Telegram Bot] Exception during webhook reset / getMe: {e}")

    offset = 0
    while True:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{TG_API_URL}/getUpdates",
                    params={"offset": offset, "timeout": 30},
                    timeout=45.0
                )
                if resp.status_code != 200:
                    print(f"[Telegram Bot] HTTP error polling updates, re-trying in 5s... Status: {resp.status_code}")
                    await asyncio.sleep(5.0)
                    continue
                    
                data = resp.json()
                if data.get("ok") and isinstance(data.get("result"), list):
                    for update in data["result"]:
                        offset = max(offset, update["update_id"] + 1)
                        if "message" in update:
                            try:
                                await handle_telegram_message(update["message"])
                            except Exception as msg_err:
                                print(f"[Telegram Bot] Error handling message update: {msg_err}")
        except Exception as e:
            print(f"[Telegram Bot] Polling handshake issue, retrying in 5 seconds: {e}")
            await asyncio.sleep(5.0)


# For startup automatic reconnects
@app.on_event("startup")
async def startup_event():
    saved = get_saved_accounts_list()
    global current_active_wa_phone
    if saved:
        current_active_wa_phone = saved[0]["phone"]
        for acc in saved:
            asyncio.create_task(start_wa_browser(acc["phone"], is_restore=True))
    # Start Telegram Bot Polling thread background
    asyncio.create_task(start_telegram_bot())

if __name__ == "__main__":
    uvicorn.run("ws:app", host="0.0.0.0", port=3000, reload=False)
