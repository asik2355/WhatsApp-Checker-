import { fetchLatestBaileysVersion } from "@whiskeysockets/baileys";

async function main() {
  console.log("Starting Baileys Diagnostic Test...");
  try {
    const fetched = await fetchLatestBaileysVersion();
    console.log("Successfully fetched latest Baileys WhatsApp Web version:", fetched);
  } catch (err: any) {
    console.error("Error fetching Baileys version:", err);
  }
}

main();
