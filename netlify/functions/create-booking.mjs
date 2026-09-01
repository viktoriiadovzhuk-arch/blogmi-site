import { getStore } from "@netlify/blobs";
import crypto from "crypto";
import { getPlanPrice } from "./_pricing.mjs";

// Бронь — фіксована сума 1000 ₴, без промокодів
const BOOKING_AMOUNT = 1000;

// Повна ціна тарифу тепер береться з драбини (getPlanPrice) — не хардкод.
// Бронь займає місце ОДРАЗУ (webhook викличе incrementSold при успішній оплаті 1000).

// Дедлайн доплати — день старту курсу (5 жовтня 2026)
const PAY_REST_DEADLINE = new Date('2026-10-05T23:59:59+03:00').toISOString();

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { plan, email, utm } = await req.json();
    const emailKey = (email || "").toLowerCase().trim();

    if (!emailKey || !emailKey.includes("@")) {
      return new Response(JSON.stringify({ error: "Невірний email" }), { status: 400 });
    }
    if (!["start", "pro", "vip"].includes(plan)) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), { status: 400 });
    }

    const MONO_TOKEN = process.env.MONO_TOKEN;
    if (!MONO_TOKEN) {
      return new Response(JSON.stringify({ error: "Payment system not configured" }), { status: 500 });
    }

    const SITE_URL = process.env.URL || "https://julianorets.online";

    // ===== ПЕРЕВІРКА ДУБЛЯ =====
    // Якщо вже є активна бронь по цьому email і плану — повертаємо існуюче посилання
    const bookingsStore = getStore("bookings");
    const existingRaw = await bookingsStore.get("email_" + emailKey + "_" + plan);

    if (existingRaw) {
      const existing = JSON.parse(existingRaw);
      // Якщо бронь оплачена і ще не доплачена — даємо посилання на доплату
      if (existing.status === "booked" && existing.fullPaidUrl) {
        return new Response(JSON.stringify({
          duplicate: true,
          fullPaidUrl: existing.fullPaidUrl,
          pageUrl: null,
          message: "У тебе вже є активна бронь. Ось посилання на доплату."
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      // Якщо вже повністю оплачено — теж повідомляємо
      if (existing.status === "fully_paid") {
        return new Response(JSON.stringify({
          alreadyPaid: true,
          message: "Цей тариф уже повністю оплачено. Перевір email — там доступ до платформи."
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }

    // ===== ГЕНЕРАЦІЯ ТОКЕНА =====
    // Без дефісів — щоб точно влазив у Telegram start-параметр (ліміт 64, дозволені тільки [a-zA-Z0-9_-])
    const token = crypto.randomBytes(16).toString("hex"); // 32 hex символи
    const fullPaidUrl = `${SITE_URL}/pay-rest?token=${token}`;

    const planName = ({ start: "Бронь місця — тариф Start", pro: "Бронь місця — тариф PRO", vip: "Бронь місця — тариф VIP" })[plan];

    // Повна ціна тарифу — з драбини (сервер, не фронт). Бронь фіксує САЙТОВУ ціну.
    const pricing = await getPlanPrice(plan);
    if (!pricing) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), { status: 400 });
    }
    // Тариф закритий — бронь не приймаємо
    if (pricing.isClosed) {
      return new Response(JSON.stringify({ error: "Місця на цей тариф уже заповнено" }), { status: 409 });
    }
    const fullPrice = pricing.siteBase;

    const remaining = fullPrice - BOOKING_AMOUNT;
    const amountKop = BOOKING_AMOUNT * 100;

    // Meta event_id для дедуплікації Pixel ↔ CAPI (Purchase=1000 при броні)
    const metaEventId = "booking_" + crypto.randomBytes(12).toString("hex");

    // Capture client IP + UA для CAPI
    const clientIp = req.headers.get("x-nf-client-connection-ip")
      || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
      || null;
    const userAgent = req.headers.get("user-agent") || null;

    // Reference для webhook — позначка що це бронь
    const reference = Buffer.from(JSON.stringify({
      email: emailKey,
      plan,
      kind: "booking",
      token,
      ts: Date.now()
    })).toString("base64url");

    // ===== ВИКЛИК Monobank =====
    const webHookUrl = `${SITE_URL}/.netlify/functions/webhook`;
    console.log(`📤 Booking: creating Mono invoice. webHookUrl=${webHookUrl}, redirectUrl=${SITE_URL}/thankyou-booking?token=${token}`);

    const response = await fetch("https://api.monobank.ua/api/merchant/invoice/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Token": MONO_TOKEN
      },
      body: JSON.stringify({
        amount: amountKop,
        ccy: 980,
        merchantPaymInfo: {
          reference,
          destination: planName,
          comment: planName + " (передоплата 1000 ₴)",
          basketOrder: [{
            name: planName,
            qty: 1,
            sum: amountKop,
            total: amountKop,
            unit: "шт."
          }]
        },
        redirectUrl: `${SITE_URL}/thankyou-booking?token=${token}`,
        webHookUrl,
        validity: 3600,
        paymentType: "debit"
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Mono booking error:", response.status, errText);
      return new Response(JSON.stringify({ error: "Не вдалося створити платіж" }), { status: 500 });
    }

    const data = await response.json();

    // ===== ЗБЕРІГАЄМО БРОНЬ =====
    const bookingData = {
      token,
      email: emailKey,
      plan,
      fullPrice,
      bookingAmount: BOOKING_AMOUNT,
      remaining,
      fullPaidUrl,
      payRestDeadline: PAY_REST_DEADLINE,
      bookingInvoiceId: data.invoiceId,
      bookingReference: reference,
      // Meta + UTM
      metaEventId,
      utm: utm || null,
      clientIp,
      userAgent,
      status: "pending",      // pending → booked → fully_paid
      createdAt: new Date().toISOString()
    };

    // Індекс по email+plan (для дедуплікації)
    await bookingsStore.set("email_" + emailKey + "_" + plan, JSON.stringify(bookingData));
    // Індекс по токену (для сторінки доплати)
    await bookingsStore.set("token_" + token, JSON.stringify(bookingData));
    // Індекс по invoiceId (для webhook)
    await bookingsStore.set("invoice_" + data.invoiceId, JSON.stringify(bookingData));

    return new Response(JSON.stringify({
      pageUrl: data.pageUrl,
      token
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("create-booking error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
};
