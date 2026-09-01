// =====================================================================
// CURRENT PRICING — прайс-драбина Потоку 2 (єдине джерело правди — код)
// ---------------------------------------------------------------------
// Ціна залежить від кількості ПРОДАНИХ місць, а не від дати.
// Лічильники «продано» зберігаються у Netlify Blobs (store "seats").
// Ця ж драбина віддзеркалена в Notion DB «Місця Потоку 2» для наочності,
// але рахує саме код — Notion не є обчислювальним джерелом.
//
// Правила росту (фінал, tariff reference):
//   PRO   — база 5999, +500 сайт / крок = 10 проданих ПРО, стеля 7999,
//           ліміт 50 місць. Промо = сайт − 1000.
//   START — база 4999 сайт / 3999 промо, +300 РАЗОМ із кожним кроком ПРО.
//           Заморожується коли ПРО впирається у стелю. Без ліміту.
//           Анкор (закреслена) — 6999.
//   VIP   — база 10999 сайт / 9999 промо, +1000 / крок = 10 проданих VIP,
//           жорсткий ліміт 30 місць.
//   Промокод = −1000 ₴ на будь-який тариф, будь-яку сходинку.
// =====================================================================

import { getStore } from "@netlify/blobs";

export const PROMO_DISCOUNT = 1000;

// Крок сходинки = скільки проданих місць до зміни ціни
const STEP = 10;

// ---- START ----
const START = {
  key: "start",
  label: "Start",
  siteBase: 4999,      // сайтова ціна на сходинці 1
  stepUp: 300,         // +300 сайт разом із кожним кроком ПРО
  anchor: 6999,        // закреслена анкорна ціна
  hasLimit: false,     // без ліміту місць
  maxStepIndex: 4      // 0..4 (як у ПРО) — далі заморожується
};

// ---- PRO ----
// Промо-драбина: 5999→6499→6999→7499→7999 (стеля).
// Сайтова = промо + PROMO_DISCOUNT (1000): 6999→...→8999.
const PRO = {
  key: "pro",
  label: "PRO",
  siteBase: 6999,      // сайтова ціна на сходинці 1 (промо 5999 + 1000)
  stepUp: 500,
  ceiling: 8999,       // стеля сайтової ціни (промо-стеля 7999 + 1000)
  limit: 50,
  maxStepIndex: 4      // 0:0-9, 1:10-19, 2:20-29, 3:30-39, 4:40-49
};

// ---- VIP ----
const VIP = {
  key: "vip",
  label: "VIP",
  siteBase: 10999,
  stepUp: 1000,
  limit: 30,
  maxStepIndex: 2      // 0:0-9, 1:10-19, 2:20-29
};

// stepIndex за кількістю проданих (0-9 → 0, 10-19 → 1, ...)
function stepIndexFor(sold) {
  return Math.floor(Math.max(0, sold) / STEP);
}

// Скільки продано до наступної цінової сходинки
function seatsUntilNextPrice(sold) {
  const inStep = Math.max(0, sold) % STEP;
  return STEP - inStep; // 1..10
}

// ===== START =====
// Крок START прив'язаний до кроку ПРО (ростуть синхронно), заморожується на стелі ПРО.
function priceStart(proSold) {
  const rawStep = stepIndexFor(proSold);
  const step = Math.min(rawStep, START.maxStepIndex);
  const site = START.siteBase + step * START.stepUp;
  const promo = site - PROMO_DISCOUNT;
  const frozen = rawStep >= START.maxStepIndex; // ПРО досягла стелі → START теж завмер
  return {
    plan: START.key,
    label: START.label,
    stepIndex: step + 1,          // людський індекс 1..5
    siteBase: site,
    promoPrice: promo,
    anchor: START.anchor,
    nextSitePrice: frozen ? null : site + START.stepUp,
    seatsUntilNextPrice: null,     // START лічильник місць НЕ показує
    seatsLeft: null,
    limit: null,
    hasLimit: false,
    isClosed: false,
    frozen
  };
}

// ===== PRO =====
function pricePro(proSold) {
  const rawStep = stepIndexFor(proSold);
  const step = Math.min(rawStep, PRO.maxStepIndex);
  let site = PRO.siteBase + step * PRO.stepUp;
  if (site > PRO.ceiling) site = PRO.ceiling;
  const promo = site - PROMO_DISCOUNT;
  const atCeiling = step >= PRO.maxStepIndex || site >= PRO.ceiling;
  const seatsLeft = Math.max(0, PRO.limit - proSold);
  const isClosed = proSold >= PRO.limit;
  return {
    plan: PRO.key,
    label: PRO.label,
    stepIndex: step + 1,
    siteBase: site,
    promoPrice: promo,
    anchor: null,
    nextSitePrice: atCeiling ? null : Math.min(site + PRO.stepUp, PRO.ceiling),
    // На останній сходинці перше число зникає (лишається тільки seatsLeft)
    seatsUntilNextPrice: (atCeiling || isClosed) ? null : seatsUntilNextPrice(proSold),
    seatsLeft,
    limit: PRO.limit,
    hasLimit: true,
    isClosed,
    frozen: atCeiling
  };
}

// ===== VIP =====
function priceVip(vipSold) {
  const rawStep = stepIndexFor(vipSold);
  const step = Math.min(rawStep, VIP.maxStepIndex);
  const site = VIP.siteBase + step * VIP.stepUp;
  const promo = site - PROMO_DISCOUNT;
  const atTop = step >= VIP.maxStepIndex;
  const seatsLeft = Math.max(0, VIP.limit - vipSold);
  const isClosed = vipSold >= VIP.limit;
  return {
    plan: VIP.key,
    label: VIP.label,
    stepIndex: step + 1,
    siteBase: site,
    promoPrice: promo,
    anchor: null,
    nextSitePrice: (atTop || isClosed) ? null : site + VIP.stepUp,
    seatsUntilNextPrice: (atTop || isClosed) ? null : seatsUntilNextPrice(vipSold),
    seatsLeft,
    limit: VIP.limit,
    hasLimit: true,
    isClosed,
    frozen: atTop
  };
}

// ===== Читання лічильників «продано» з Blobs =====
// store "seats": ключі "pro_sold", "vip_sold" (числа як рядки).
export async function getSoldCounts() {
  try {
    const store = getStore("seats");
    const [proRaw, vipRaw] = await Promise.all([
      store.get("pro_sold"),
      store.get("vip_sold")
    ]);
    return {
      proSold: Number(proRaw) || 0,
      vipSold: Number(vipRaw) || 0
    };
  } catch (err) {
    console.error("getSoldCounts error:", err);
    return { proSold: 0, vipSold: 0 };
  }
}

// ===== Інкремент лічильника (викликає webhook після успішної оплати/броні) =====
// Пише і в Blobs (швидке джерело для /api/current-pricing), і в Notion DB (для ока).
// START без ліміту — власного лічильника не веде.
// Повертає нове значення проданих або null.
export async function incrementSold(plan) {
  if (plan !== "pro" && plan !== "vip") return null;
  let next = null;
  try {
    const store = getStore("seats");
    const key = plan + "_sold";
    const cur = Number(await store.get(key)) || 0;
    next = cur + 1;
    await store.set(key, String(next));
  } catch (err) {
    console.error("incrementSold(blobs) error:", err);
    return null;
  }
  // Синхронізуємо Notion DB (best-effort — не валимо оплату, якщо Notion недоступний)
  try {
    await syncNotionSeats(plan, next);
  } catch (err) {
    console.error("incrementSold(notion) error:", err);
  }
  return next;
}

// ===== Синхронізація Notion DB «Місця Потоку 2» =====
// Оновлює рядок тарифу: «Продано місць», «Поточна ціна», «...з промокодом»,
// «Наступна ціна», «Поточна сходинка», «Місць до наступної ціни», «Статус».
// ENV: NOTION_TOKEN. ID сторінок рядків — у NOTION_ROW_IDS (JSON) або нижче.
const NOTION_VERSION = "2022-06-28";
const NOTION_ROW_IDS = {
  // page_id рядків у БД «Місця Потоку 2»
  pro: process.env.NOTION_ROW_PRO || "3c93fe3c-8b4f-81d9-856a-d31172fc5466",
  vip: process.env.NOTION_ROW_VIP || "3923fe3c-8b4f-8158-b269-c7b4a0d6ebfc"
};

async function syncNotionSeats(plan, soldCount) {
  const token = process.env.NOTION_TOKEN;
  const pageId = NOTION_ROW_IDS[plan];
  if (!token || !pageId) {
    console.warn("syncNotionSeats: no NOTION_TOKEN or row id for", plan);
    return;
  }
  const info = plan === "pro" ? pricePro(soldCount) : priceVip(soldCount);
  const props = {
    "Продано місць": { number: soldCount },
    "Поточна ціна": { number: info.siteBase },
    "Поточна ціна з промокодом": { number: info.promoPrice },
    "Наступна ціна": { number: info.nextSitePrice ?? 0 },
    "Поточна сходинка": { number: info.stepIndex },
    "Місць до наступної ціни": { number: info.seatsUntilNextPrice ?? 0 },
    "Статус": { select: { name: info.isClosed ? "Закритий" : "Активний" } }
  };
  const resp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ properties: props })
  });
  if (!resp.ok) {
    const t = await resp.text();
    console.error("syncNotionSeats Notion error:", resp.status, t.slice(0, 200));
  } else {
    console.log(`🗂️ Notion seats synced: ${plan} sold=${soldCount}`);
  }
}

// ===== Головна: повний прайс за поточними лічильниками =====
export async function getCurrentPricing() {
  const { proSold, vipSold } = await getSoldCounts();
  return {
    start: priceStart(proSold),
    pro: pricePro(proSold),
    vip: priceVip(vipSold),
    _counts: { proSold, vipSold },
    _ts: Date.now()
  };
}

// ===== Ціна конкретного тарифу (для валідації платежу на сервері) =====
// Повертає { siteBase, promoPrice, isClosed } — щоб платіжна функція
// не довіряла ціні з фронту, а перерахувала сама.
export async function getPlanPrice(plan) {
  const { proSold, vipSold } = await getSoldCounts();
  if (plan === "start") return priceStart(proSold);
  if (plan === "pro") return pricePro(proSold);
  if (plan === "vip") return priceVip(vipSold);
  return null;
}

// Чисті функції — експортуємо для юніт-перевірки
export const _pure = { priceStart, pricePro, priceVip, stepIndexFor, seatsUntilNextPrice };
