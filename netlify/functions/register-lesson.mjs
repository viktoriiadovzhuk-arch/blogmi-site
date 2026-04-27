import { getStore } from "@netlify/blobs";
import { addToAddressBook } from "./_sendpulse.mjs";

const TARGET_PRICES = { start: 3799, vip: 4599 };
const TTL_MS = 24 * 60 * 60 * 1000;
const SP_BOOK_ID = "654867";

function genCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "EARLY-" + s;
}

// Формат "28 квітня о 14:32" у Київському часі
function formatPretty(isoDate) {
  const months = [
    "січня","лютого","березня","квітня","травня","червня",
    "липня","серпня","вересня","жовтня","листопада","грудня"
  ];
  const d = new Date(isoDate);
  // Київський час (UTC+3)
  const kyiv = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const day = kyiv.getUTCDate();
  const month = months[kyiv.getUTCMonth()];
  const hh = String(kyiv.getUTCHours()).padStart(2, "0");
  const mm = String(kyiv.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} о ${hh}:${mm}`;
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { email } = await req.json();
    const emailKey = (email || "").toLowerCase().trim();

    if (!emailKey || !emailKey.includes("@") || emailKey.length > 200) {
      return new Response(JSON.stringify({ error: "Введи коректний email" }), { status: 400 });
    }

    const store = getStore("dynamic_promos");

    // ===== ПЕРЕВІРКА ІСНУЮЧОГО =====
    const existingRaw = await store.get("email_" + emailKey);
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        const isExpired = !existing.expiresAt || new Date(existing.expiresAt) <= new Date();
        const isUsed = !!existing.used;

        if (!isExpired && !isUsed) {
          // Активний код — повертаємо його. У SendPulse повторно не шлемо
          // (юзерка вже там, не треба смітити).
          return new Response(JSON.stringify({
            code: existing.code,
            expiresAt: existing.expiresAt,
            duplicate: true
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        // Старий невалідний — на сторінці уроку показуємо код,
        // але він не дасть знижки. Це окей: юзерка все одно дивиться відео.
        // У SendPulse теж повторно не додаємо.
        return new Response(JSON.stringify({
          code: existing.code,
          expiresAt: existing.expiresAt,
          duplicate: true,
          expired: isExpired,
          used: isUsed
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      } catch {}
    }

    // ===== ГЕНЕРУЄМО НОВИЙ =====
    let code = null;
    for (let i = 0; i < 5; i++) {
      const candidate = genCode();
      const collision = await store.get("code_" + candidate);
      if (!collision) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      return new Response(JSON.stringify({ error: "Не вдалося згенерувати код" }), { status: 500 });
    }

    const now = Date.now();
    const expiresAt = new Date(now + TTL_MS).toISOString();

    const promoData = {
      code,
      email: emailKey,
      type: "fixed_per_plan",
      prices: TARGET_PRICES,
      source: "lesson",   // помітка що цей код з промо-уроку
      createdAt: new Date(now).toISOString(),
      expiresAt,
      used: false
    };

    await store.set("code_" + code, JSON.stringify(promoData));
    await store.set("email_" + emailKey, JSON.stringify(promoData));

    // ===== SENDPULSE =====
    // Шлемо асинхронно. Якщо SendPulse падає — все одно повертаємо код юзерці.
    addToAddressBook(SP_BOOK_ID, emailKey, {
      promo_code: code,
      expires_at: expiresAt,
      expires_at_pretty: formatPretty(expiresAt),
      lesson_watched_at: new Date(now).toISOString(),
      tariff_start_price: TARGET_PRICES.start,
      tariff_vip_price: TARGET_PRICES.vip,
      is_fully_paid: "false"
    }).catch(err => console.error("SP add failed:", err));

    return new Response(JSON.stringify({
      code,
      expiresAt,
      duplicate: false
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("register-lesson error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
};
