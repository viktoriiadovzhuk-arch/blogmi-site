// Meta Conversions API (CAPI) helper
// Документація: https://developers.facebook.com/docs/marketing-api/conversions-api
//
// ENV:
//   META_PIXEL_ID         — Pixel ID (за замовчуванням захардкоджений 1481333723021483)
//   META_CAPI_TOKEN       — Access Token (обов'язковий, отримується в Events Manager)
//   META_TEST_EVENT_CODE  — опціонально, для тестового режиму (TEST12345)

import crypto from "crypto";

const DEFAULT_PIXEL_ID = "1481333723021483";
const GRAPH_VERSION = "v19.0";

function sha256Lower(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  return crypto.createHash("sha256").update(v).digest("hex");
}

function normalizePhone(phone) {
  if (!phone) return null;
  // Залишаємо лише цифри (E.164 без '+')
  const digits = String(phone).replace(/\D/g, "");
  return digits || null;
}

/**
 * Відправляє подію в Meta Conversions API.
 *
 * @param {object} args
 * @param {string} args.eventName     — 'Purchase', 'Lead', тощо
 * @param {string} args.eventId       — унікальний ID для дедуплікації з Pixel
 * @param {string} [args.eventSourceUrl] — URL сторінки де відбулась подія
 * @param {string} [args.actionSource] — 'website' | 'system_generated' | 'business_messaging'
 * @param {object} args.userData      — {email, phone, fbp, fbc, ipAddress, userAgent}
 * @param {object} [args.customData]  — {value, currency, content_name, content_type, contents}
 * @returns {Promise<{ok: boolean, error?: string, response?: any}>}
 */
export async function sendMetaEvent(args) {
  try {
    const PIXEL_ID = process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID;
    const TOKEN = process.env.META_CAPI_TOKEN;
    const TEST_CODE = process.env.META_TEST_EVENT_CODE || null;

    if (!TOKEN) {
      console.warn("[CAPI] META_CAPI_TOKEN not configured — skipping event");
      return { ok: false, error: "no_token" };
    }

    if (!args.eventName) {
      return { ok: false, error: "no_event_name" };
    }

    const ud = args.userData || {};

    // Хешуємо PII (вимога Meta для email/phone/external_id)
    const userData = {};
    const em = sha256Lower(ud.email);
    if (em) userData.em = [em];

    const phNorm = normalizePhone(ud.phone);
    const ph = phNorm ? sha256Lower(phNorm) : null;
    if (ph) userData.ph = [ph];

    // external_id — стабільний user-level ID (hashed email або інше)
    if (em) userData.external_id = [em];

    // fbp, fbc — НЕ хешуються
    if (ud.fbp) userData.fbp = ud.fbp;
    if (ud.fbc) userData.fbc = ud.fbc;

    // IP і UA — НЕ хешуються
    if (ud.ipAddress) userData.client_ip_address = ud.ipAddress;
    if (ud.userAgent) userData.client_user_agent = ud.userAgent;

    const eventData = {
      event_name: args.eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: args.actionSource || "website",
      user_data: userData
    };

    if (args.eventId) eventData.event_id = args.eventId;
    if (args.eventSourceUrl) eventData.event_source_url = args.eventSourceUrl;
    if (args.customData) eventData.custom_data = args.customData;

    const payload = { data: [eventData] };
    if (TEST_CODE) payload.test_event_code = TEST_CODE;

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (!resp.ok) {
      console.error(`[CAPI] Failed (${resp.status}):`, json);
      return { ok: false, error: "api_failed", status: resp.status, response: json };
    }

    console.log(`[CAPI] ${args.eventName} sent (event_id=${args.eventId || "—"}):`, json);
    return { ok: true, response: json };
  } catch (err) {
    console.error("[CAPI] error:", err);
    return { ok: false, error: "exception", message: err.message };
  }
}

/**
 * Зручний шорткат для Purchase.
 */
export async function sendMetaPurchase({
  eventId,
  email,
  phone,
  fbp,
  fbc,
  ipAddress,
  userAgent,
  eventSourceUrl,
  value,
  currency = "UAH",
  contentName,
  contentType = "product",
  contents
}) {
  return sendMetaEvent({
    eventName: "Purchase",
    eventId,
    eventSourceUrl,
    actionSource: "website",
    userData: { email, phone, fbp, fbc, ipAddress, userAgent },
    customData: {
      value: Number(value) || 0,
      currency,
      content_name: contentName,
      content_type: contentType,
      ...(contents ? { contents } : {})
    }
  });
}
