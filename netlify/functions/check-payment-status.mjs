import { getStore } from "@netlify/blobs";

// CORS headers — для випадку, якщо викликаємо з іншого домену.
// Для same-origin (thankyou.html на тому ж сайті) не критично, але хай буде.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  }

  try {
    const url = new URL(req.url);
    const ref = url.searchParams.get("ref");

    if (!ref) {
      return new Response(JSON.stringify({ error: "ref is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    const paymentsStore = getStore("payments");

    // 1. Спочатку перевіряємо WFP (ключ wfp_<orderReference>)
    let raw = await paymentsStore.get("wfp_" + ref);
    let method = raw ? "wfp" : null;

    // 2. Monobank: шукаємо mapping mono_ref_<shortId> → invoiceId
    if (!raw) {
      const invoiceId = await paymentsStore.get("mono_ref_" + ref);
      if (invoiceId) {
        raw = await paymentsStore.get(invoiceId);
        method = "mono";
      }
    }

    // 3. Fallback: пробуємо ref як invoiceId напряму (на випадок legacy-посилань)
    if (!raw) {
      raw = await paymentsStore.get(ref);
      if (raw) method = "mono";
    }

    if (!raw) {
      return new Response(JSON.stringify({
        found: false,
        status: "unknown"
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    const data = JSON.parse(raw);
    const status = data.status || "pending";

    // Нормалізуємо статус для фронту.
    let normalized;
    if (status === "Approved" || status === "success") {
      normalized = "success";
    } else if (
      status === "pending" ||
      status === "created" ||
      status === "processing" ||
      status === "hold" ||
      status === "Pending" ||
      status === "InProcessing" ||
      status === "WaitingAuthComplete"
    ) {
      normalized = "pending";
    } else {
      normalized = "failed";
    }

    return new Response(JSON.stringify({
      found: true,
      status: normalized,
      rawStatus: status,
      method,
      // Дані для Meta Pixel Purchase (дедуплікація з CAPI по eventId)
      metaEventId: data.metaEventId || null,
      amountUAH: data.amountUAH != null ? data.amountUAH : null,
      currency: "UAH",
      plan: data.plan || null,
      kind: data.kind || "full" // full | rest_payment | booking
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS }
    });

  } catch (err) {
    console.error("check-payment-status error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  }
};
