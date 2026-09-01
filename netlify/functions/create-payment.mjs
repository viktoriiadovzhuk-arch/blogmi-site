import { getStore } from "@netlify/blobs";
import crypto from "crypto";
import { applyPromoAsync } from "./_promos.mjs";

export default async (req, context) => {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { plan, email, promoCode, utm } = await req.json();

    // Validate input
    if (!plan || !email) {
      return new Response(JSON.stringify({ error: "plan and email are required" }), { status: 400 });
    }
    if (!["start", "pro", "vip"].includes(plan)) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), { status: 400 });
    }

    const MONO_TOKEN = process.env.MONO_TOKEN;
    if (!MONO_TOKEN) {
      return new Response(JSON.stringify({ error: "Payment system not configured" }), { status: 500 });
    }

    const SITE_URL = process.env.URL || "https://blogmenorets.netlify.app";

    // =============== APPLY PROMO (SERVER-SIDE) ===============
    const priced = await applyPromoAsync(promoCode, plan, email);
    if (!priced.ok) {
      return new Response(JSON.stringify({ error: priced.error }), { status: 400 });
    }

    const PLAN_NAMES = { start: "Блог.me — тариф Start", pro: "Блог.me — тариф PRO", vip: "Блог.me — тариф VIP" };
    const planName = PLAN_NAMES[plan];
    const amountKop = priced.price * 100; // UAH → копійки
    // =========================================================

    // Generate unique reference (embeds email + plan + promo for webhook)
    const reference = Buffer.from(JSON.stringify({
      email, plan, promo: priced.code || null, ts: Date.now()
    })).toString("base64url");

    // Meta event_id для дедуплікації Pixel ↔ CAPI Purchase events.
    // Той самий event_id передається в Pixel (eventID) на фронті та в CAPI з webhook.
    const metaEventId = "purchase_" + crypto.randomBytes(12).toString("hex");

    // === КОРОТКИЙ monoRef для URL/polling ===
    const monoRef = "m" + Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8);

    // Capture client IP + UA для Meta CAPI
    const clientIp = req.headers.get("x-nf-client-connection-ip")
      || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
      || null;
    const userAgent = req.headers.get("user-agent") || null;

    // Create Monobank invoice
    const response = await fetch("https://api.monobank.ua/api/merchant/invoice/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Token": MONO_TOKEN
      },
      body: JSON.stringify({
        amount: amountKop,
        ccy: 980, // UAH
        merchantPaymInfo: {
          reference: reference,
          destination: planName,
          comment: priced.code ? `${planName} (промокод: ${priced.code})` : planName,
          basketOrder: [{
            name: planName,
            qty: 1,
            sum: amountKop,
            total: amountKop,
            unit: "шт."
          }]
        },
        redirectUrl: `${SITE_URL}/thankyou?ref=${monoRef}`,
        webHookUrl: `${SITE_URL}/.netlify/functions/webhook`,
        validity: 3600, // 1 hour
        paymentType: "debit"
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Monobank error:", response.status, errText);
      return new Response(JSON.stringify({ error: "Payment creation failed" }), { status: 500 });
    }

    const data = await response.json();

    // Store pending payment info for webhook matching
    const store = getStore("payments");
    await store.set(data.invoiceId, JSON.stringify({
      email,
      plan,
      promoCode: priced.code || null,
      amountUAH: priced.price,
      invoiceId: data.invoiceId,
      reference,
      monoRef,
      metaEventId,
      utm: utm || null,
      clientIp,
      userAgent,
      status: "created",
      createdAt: new Date().toISOString()
    }));

    await store.set(`mono_ref_${monoRef}`, data.invoiceId);

    return new Response(JSON.stringify({ pageUrl: data.pageUrl }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("create-payment error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
};
