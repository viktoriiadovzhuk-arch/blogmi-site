// =====================================================================
// ПРОМОКОДИ Потоку 2
// ---------------------------------------------------------------------
// Модель проста: будь-який валідний промокод дає −1000 ₴ від САЙТОВОЇ
// ціни поточної сходинки (тобто опускає до «промо»-колонки драбини).
// Ціни завжди рахуються з _pricing.mjs (getPlanPrice) — драбина за
// проданими місцями. Промокод НЕ фіксує старе число: якщо ціна зросла,
// знижка −1000 застосовується вже до нової сайтової ціни.
//
// Типи кодів:
//   СТАТИЧНІ  — у PROMOS нижче, працюють завжди (напр. універсальний).
//   ДИНАМІЧНІ — генеруються після лідмагніт-уроку (register-lesson),
//               лежать у Blobs, прив'язані до email + TTL (24 год).
// =====================================================================

import { getStore } from "@netlify/blobs";
import { getPlanPrice, PROMO_DISCOUNT } from "./_pricing.mjs";

const PLANS = ["start", "pro", "vip"];

// ===== СТАТИЧНІ КОДИ =====
// Універсальний код −1000 на будь-який тариф (роздавати в блозі/сторіс).
const PROMOS = {
  BLOGME1000: { type: "minus", amount: PROMO_DISCOUNT },
  FRIEND1000: { type: "minus", amount: PROMO_DISCOUNT }
};

function formatResult(sitePrice, finalPrice, code) {
  const savings = Math.max(0, sitePrice - finalPrice);
  const discountLabel = savings > 0
    ? `−${savings.toLocaleString("uk-UA")} ₴`
    : null;
  return { ok: true, price: finalPrice, basePrice: sitePrice, discountLabel, code };
}

// ===== Головна валідація (async) =====
export async function applyPromoAsync(rawCode, plan, email) {
  if (!PLANS.includes(plan)) {
    return { ok: false, error: "Невідомий тариф" };
  }

  const pricing = await getPlanPrice(plan);
  if (!pricing) return { ok: false, error: "Невідомий тариф" };

  if (pricing.isClosed) {
    return { ok: false, error: "Місця на цей тариф уже заповнено" };
  }

  const sitePrice = pricing.siteBase;

  // Без коду — сайтова ціна
  if (!rawCode || !String(rawCode).trim()) {
    return { ok: true, price: sitePrice, basePrice: sitePrice, discountLabel: null, code: null };
  }

  const code = String(rawCode).trim().toUpperCase();

  // 1) Статичний код
  const staticPromo = PROMOS[code];
  if (staticPromo) {
    const final = Math.max(1, sitePrice - staticPromo.amount);
    return formatResult(sitePrice, final, code);
  }

  // 2) Динамічний код (Blobs)
  try {
    const store = getStore("dynamic_promos");
    const raw = await store.get("code_" + code);
    if (!raw) {
      return { ok: false, error: "Промокод не знайдено" };
    }
    const data = JSON.parse(raw);

    if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
      return { ok: false, error: "Термін дії промокоду минув" };
    }
    if (data.used) {
      return { ok: false, error: "Промокод уже використано" };
    }
    if (email && data.email) {
      const emailKey = String(email).toLowerCase().trim();
      if (emailKey !== data.email) {
        return { ok: false, error: "Цей промокод прив'язаний до іншого email" };
      }
    }

    const amount = data.amount || PROMO_DISCOUNT;
    const final = Math.max(1, sitePrice - amount);
    return formatResult(sitePrice, final, code);

  } catch (err) {
    console.error("applyPromoAsync error:", err);
    return { ok: false, error: "Помилка валідації промокоду" };
  }
}

// Синхронна обгортка лишена для сумісності — тепер прайс завжди async
export function applyPromo() {
  return { ok: false, error: "USE_ASYNC" };
}

// ===== Позначити динамічний код використаним =====
export async function markDynamicPromoUsed(code) {
  if (!code) return;
  try {
    const store = getStore("dynamic_promos");
    const raw = await store.get("code_" + code);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.used) return;
    data.used = true;
    data.usedAt = new Date().toISOString();
    await store.set("code_" + code, JSON.stringify(data));
    if (data.email) {
      await store.set("email_" + data.email, JSON.stringify(data));
    }
  } catch (err) {
    console.error("markDynamicPromoUsed error:", err);
  }
}
