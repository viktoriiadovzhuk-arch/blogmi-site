import { getStore } from "@netlify/blobs";
import crypto from "crypto";
import { markDynamicPromoUsed } from "./_promos.mjs";
import { incrementSold } from "./_pricing.mjs";
import { sendMetaPurchase } from "./_meta-capi.mjs";

// SendPulse Events URLs
const SP_FULL_PAID = "https://events.sendpulse.com/events/id/a129f386f88a48e5985449ea0f705f40/9399561";
const SP_BOOKING   = "https://events.sendpulse.com/events/id/a28db23860284bfca934f46d06ddc920/9399561";

const SITE_URL = process.env.URL || "https://julianorets.online";

// Назва тарифу для SendPulse/LMS — 3 тарифи (Start / PRO / VIP)
function planToLabel(plan) {
  return ({ start: "Start", pro: "PRO", vip: "VIP" })[plan] || "Start";
}

function generatePassword() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Приведення UTM-об'єкта до плоских рядків для SendPulse
function flattenUtm(utm) {
  if (!utm || typeof utm !== "object") return {};
  return {
    utm_source: utm.utm_source || "",
    utm_medium: utm.utm_medium || "",
    utm_campaign: utm.utm_campaign || "",
    utm_content: utm.utm_content || "",
    utm_term: utm.utm_term || "",
    utm_source_first: utm.utm_source_first || "",
    utm_medium_first: utm.utm_medium_first || "",
    utm_campaign_first: utm.utm_campaign_first || "",
    utm_referrer: utm.utm_referrer || "",
    utm_landing: utm.utm_landing || ""
  };
}

// ===== SENDPULSE: подія "повна оплата" — створює юзера =====
async function sendpulseFullyPaid({ email, productName, fullPrice, paidFeeNow, password, planLabel, utm }) {
  try {
    const feeNow = paidFeeNow != null ? paidFeeNow : fullPrice;
    await fetch(SP_FULL_PAID, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        product_name: productName,
        product_price: String(fullPrice),
        paid_fee: String(feeNow),
        full_paid_url: "",
        order_date: new Date().toISOString().split("T")[0],
        password,
        tariff: planLabel,
        ...flattenUtm(utm)
      })
    });
    console.log(`📧 SendPulse FULL PAID for ${email}, fullPrice: ${fullPrice}, paid_fee: ${feeNow}, utm.source=${utm?.utm_source || "—"}`);
  } catch (e) {
    console.error("SendPulse full paid error:", e);
  }
}

// ===== SENDPULSE: подія "бронь" — без юзера, без пароля =====
async function sendpulseBooking({ email, planLabel, fullPrice, paidFee, fullPaidUrl, payRestDeadline, utm }) {
  try {
    const remaining = Math.max(0, Number(fullPrice) - Number(paidFee));
    // Дата "до якої оплатити" — красивий формат "5 жовтня" + ISO
    let deadlinePretty = "";
    let deadlineDate = "";
    if (payRestDeadline) {
      const months = ["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];
      const d = new Date(payRestDeadline);
      const kyiv = new Date(d.getTime() + 3 * 60 * 60 * 1000);
      deadlinePretty = `${kyiv.getUTCDate()} ${months[kyiv.getUTCMonth()]}`;
      deadlineDate = payRestDeadline.split("T")[0];
    }
    await fetch(SP_BOOKING, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        product_name: "Блог.me — тариф " + planLabel + " (бронь)",
        product_price: String(fullPrice),
        paid_fee: String(paidFee),
        remaining_amount: String(remaining),
        pay_rest_deadline: deadlineDate,
        pay_rest_deadline_pretty: deadlinePretty,
        is_fully_paid: "false",
        full_paid_url: fullPaidUrl,
        order_date: new Date().toISOString().split("T")[0],
        tariff: planLabel,
        ...flattenUtm(utm)
      })
    });
    console.log(`📧 SendPulse BOOKING for ${email}, paid: ${paidFee}, remaining: ${remaining}, deadline: ${deadlinePretty}, url: ${fullPaidUrl}`);
  } catch (e) {
    console.error("SendPulse booking error:", e);
  }
}

// ===== Створення юзера в LMS =====
async function createUser(email, plan, invoiceId, amountUAH, paidFeeNow, utm) {
  const usersStore = getStore("users");
  const password = generatePassword();
  const now = new Date();
  const userKey = email.toLowerCase().trim();
  const planLabel = planToLabel(plan);

  await usersStore.set(userKey, JSON.stringify({
    email, password, plan, invoiceId,
    amountUAH: amountUAH || null,
    createdAt: now.toISOString(),
    active: true
  }));

  console.log(`✅ User created: ${email}, plan: ${plan}, amount: ${amountUAH}`);

  // SendPulse: повна оплата (з UTM)
  await sendpulseFullyPaid({
    email,
    productName: "Блог.me — тариф " + planLabel,
    fullPrice: amountUAH,
    paidFeeNow: paidFeeNow != null ? paidFeeNow : amountUAH,
    password,
    planLabel,
    utm
  });

  // External webhook
  const EW = process.env.EXTERNAL_WEBHOOK_URL;
  if (EW) {
    try { await fetch(EW, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, plan: planLabel, invoiceId, amountUAH }) }); } catch {}
  }

  return password;
}

// ===== META CAPI: Purchase (для повної оплати або доплати залишку) =====
async function capiPurchase({ eventId, email, amountUAH, planLabel, fbp, fbc, clientIp, userAgent, eventSourceUrl }) {
  try {
    const planName = planLabel ? `Блог.me — тариф ${planLabel}` : "Блог.me";
    await sendMetaPurchase({
      eventId,
      email,
      fbp,
      fbc,
      ipAddress: clientIp,
      userAgent,
      eventSourceUrl: eventSourceUrl || (SITE_URL + "/thankyou"),
      value: amountUAH,
      currency: "UAH",
      contentName: planName,
      contentType: "product"
    });
  } catch (e) {
    console.error("CAPI Purchase error:", e);
  }
}

// ===== META CAPI: Purchase для броні (value=1000) =====
async function capiPurchaseBooking({ eventId, email, bookingAmount, planLabel, fbp, fbc, clientIp, userAgent }) {
  try {
    await sendMetaPurchase({
      eventId,
      email,
      fbp,
      fbc,
      ipAddress: clientIp,
      userAgent,
      eventSourceUrl: SITE_URL + "/thankyou-booking",
      value: bookingAmount,
      currency: "UAH",
      contentName: `Блог.me — бронь тарифу ${planLabel}`,
      contentType: "product"
    });
  } catch (e) {
    console.error("CAPI Purchase (booking) error:", e);
  }
}

// ===== Обробник: успішна повна оплата =====
async function handleSuccessFull(paymentData, invoiceId) {
  const { email, plan, amountUAH, promoCode, metaEventId, utm, clientIp, userAgent } = paymentData;
  await createUser(email, plan, invoiceId, amountUAH, null, utm);

  // Meta CAPI Purchase
  if (metaEventId && email) {
    const planLabel = planToLabel(plan);
    await capiPurchase({
      eventId: metaEventId,
      email,
      amountUAH,
      planLabel,
      clientIp,
      userAgent
    });
  }

  // Якщо був використаний динамічний промокод — позначаємо як використаний
  if (promoCode) {
    await markDynamicPromoUsed(promoCode);
  }

  // Займаємо місце в лічильнику (PRO/VIP). Start без ліміту — incrementSold сам це ігнорує.
  const soldNow = await incrementSold(plan);
  if (soldNow != null) {
    console.log(`🎟️ Seat taken (full): ${plan} → sold=${soldNow}`);
  }
}

// ===== Обробник: успішна бронь =====
async function handleSuccessBooking(token) {
  const bookingsStore = getStore("bookings");
  const raw = await bookingsStore.get("token_" + token);
  if (!raw) {
    console.error("Booking not found for token:", token);
    return;
  }

  const booking = JSON.parse(raw);
  if (booking.status === "booked" || booking.status === "fully_paid") {
    console.log("Booking already processed:", token);
    return;
  }

  booking.status = "booked";
  booking.bookedAt = new Date().toISOString();

  // Перезаписуємо у всі індекси
  await bookingsStore.set("token_" + token, JSON.stringify(booking));
  await bookingsStore.set("email_" + booking.email + "_" + booking.plan, JSON.stringify(booking));
  await bookingsStore.set("invoice_" + booking.bookingInvoiceId, JSON.stringify(booking));

  const planLabel = booking.planToLabel(plan);

  // SendPulse booking з UTM
  await sendpulseBooking({
    email: booking.email,
    planLabel,
    fullPrice: booking.fullPrice,
    paidFee: booking.bookingAmount,
    fullPaidUrl: booking.fullPaidUrl,
    payRestDeadline: booking.payRestDeadline,
    utm: booking.utm
  });

  // Meta CAPI Purchase (value=1000)
  if (booking.metaEventId && booking.email) {
    await capiPurchaseBooking({
      eventId: booking.metaEventId,
      email: booking.email,
      bookingAmount: booking.bookingAmount,
      planLabel,
      clientIp: booking.clientIp,
      userAgent: booking.userAgent
    });
  }

  // Займаємо місце в лічильнику ОДРАЗУ при броні (PRO/VIP).
  // Позначку seatCounted ставимо, щоб доплата залишку не рахувала місце вдруге.
  const soldNow = await incrementSold(booking.plan);
  if (soldNow != null) {
    booking.seatCounted = true;
    await bookingsStore.set("token_" + token, JSON.stringify(booking));
    await bookingsStore.set("email_" + booking.email + "_" + booking.plan, JSON.stringify(booking));
    console.log(`🎟️ Seat taken (booking): ${booking.plan} → sold=${soldNow}`);
  }

  console.log(`✅ Booking confirmed: ${booking.email}, plan: ${booking.plan}`);
}

// ===== Обробник: успішна доплата залишку =====
async function handleSuccessRest(token, paymentRef, paymentData) {
  const bookingsStore = getStore("bookings");
  const raw = await bookingsStore.get("token_" + token);
  if (!raw) {
    console.error("Booking not found for rest payment, token:", token);
    return;
  }

  const booking = JSON.parse(raw);
  if (booking.status === "fully_paid") {
    console.log("Booking already fully paid:", token);
    return;
  }

  booking.status = "fully_paid";
  booking.fullyPaidAt = new Date().toISOString();
  if (paymentRef) booking.fullyPaidRef = paymentRef;
  await bookingsStore.set("token_" + token, JSON.stringify(booking));
  await bookingsStore.set("email_" + booking.email + "_" + booking.plan, JSON.stringify(booking));
  if (booking.restInvoiceId) {
    await bookingsStore.set("invoice_" + booking.restInvoiceId, JSON.stringify(booking));
  }

  // Створюємо юзера + летить SendPulse "повна оплата" (з UTM)
  const ref = paymentRef || booking.restInvoiceId || booking.wfpRestOrderRef;
  await createUser(booking.email, booking.plan, ref, booking.fullPrice, booking.remaining, booking.utm);

  // Meta CAPI Purchase для доплати залишку
  // event_id беремо з payment.metaEventId якщо передали, fallback — booking.restMetaEventId
  const restEventId = paymentData?.metaEventId || booking.restMetaEventId;
  if (restEventId && booking.email) {
    const planLabel = booking.planToLabel(plan);
    await capiPurchase({
      eventId: restEventId,
      email: booking.email,
      amountUAH: booking.remaining,
      planLabel,
      clientIp: paymentData?.clientIp || booking.clientIp,
      userAgent: paymentData?.userAgent || booking.userAgent
    });
  }

  // Місце вже зайняте при броні (seatCounted=true). Тут повторно НЕ рахуємо.
  // Safety-net: якщо з якоїсь причини бронь не зайняла місце (збій Blobs/Notion),
  // займаємо його зараз, щоб лічильник не «недорахував».
  if (!booking.seatCounted) {
    const soldNow = await incrementSold(booking.plan);
    if (soldNow != null) {
      booking.seatCounted = true;
      await bookingsStore.set("token_" + token, JSON.stringify(booking));
      await bookingsStore.set("email_" + booking.email + "_" + booking.plan, JSON.stringify(booking));
      console.log(`🎟️ Seat taken (rest safety-net): ${booking.plan} → sold=${soldNow}`);
    }
  }

  console.log(`✅ Booking fully paid: ${booking.email}, plan: ${booking.plan}, ref: ${ref}, paid_fee=${booking.remaining}`);
}

// ===== Допоміжне: оновити payments[invoiceId] зі статусом =====
async function updatePaymentStatus(invoiceId, status, extra = {}) {
  const paymentsStore = getStore("payments");
  try {
    const raw = await paymentsStore.get(invoiceId);
    const data = raw ? JSON.parse(raw) : { invoiceId };
    data.status = status;
    Object.assign(data, extra);
    await paymentsStore.set(invoiceId, JSON.stringify(data));
  } catch (e) {
    console.error("updatePaymentStatus error:", e);
  }
}

// ===== ГОЛОВНИЙ HANDLER =====
export default async (req) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  try {
    const body = await req.json();
    const paymentsStore = getStore("payments");

    // ========== WAYFORPAY ==========
    if (body.merchantAccount && body.orderReference) {
      console.log("WFP webhook:", body.orderReference, body.transactionStatus);

      const orderRef = body.orderReference;
      const status = body.transactionStatus;

      let paymentData;
      try {
        const raw = await paymentsStore.get("wfp_" + orderRef);
        paymentData = raw ? JSON.parse(raw) : null;
      } catch { paymentData = null; }

      if (paymentData) {
        paymentData.status = status;
        await paymentsStore.set("wfp_" + orderRef, JSON.stringify(paymentData));

        if (status === "Approved") {
          if (paymentData.kind === "rest_payment" && paymentData.token) {
            // WFP-доплата залишку
            await handleSuccessRest(paymentData.token, orderRef, paymentData);
          } else {
            // WFP — звичайна повна оплата
            await handleSuccessFull(paymentData, orderRef);
          }
        }
      }

      // Sign WFP response
      const WFP_SECRET = process.env.WFP_SECRET;
      const time = Math.floor(Date.now() / 1000);
      const responseStatus = "accept";
      const responseSignString = orderRef + ";" + responseStatus + ";" + time;
      const responseSignature = crypto
        .createHmac("md5", WFP_SECRET || "")
        .update(responseSignString)
        .digest("hex");

      return new Response(JSON.stringify({
        orderReference: orderRef,
        status: responseStatus,
        time,
        signature: responseSignature
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ========== MONOBANK ==========
    if (body.invoiceId) {
      console.log("Mono webhook:", body.invoiceId, body.status);

      const { invoiceId, status, reference } = body;

      // Декодуємо reference щоб зрозуміти тип платежу
      let decoded = null;
      if (reference) {
        try {
          decoded = JSON.parse(Buffer.from(reference, "base64url").toString());
        } catch {}
      }

      const kind = decoded?.kind || "full"; // full | booking | rest_payment

      // ВСІ Monobank webhooks → оновлюємо payments[invoiceId] зі статусом
      const failureReason = body.failureReason || body.errCode || null;
      await updatePaymentStatus(invoiceId, status, failureReason ? { failureReason } : {});

      if (status !== "success") {
        return new Response("OK", { status: 200 });
      }

      // ===== status === "success" =====
      const monoAmountUAH = body.amount ? Math.round(body.amount / 100) : null;

      if (kind === "booking") {
        await handleSuccessBooking(decoded.token);
      } else if (kind === "rest_payment") {
        // Завантажуємо paymentData щоб взяти event_id, utm, ip, ua
        let paymentData;
        try {
          const raw = await paymentsStore.get(invoiceId);
          paymentData = raw ? JSON.parse(raw) : null;
        } catch { paymentData = null; }
        await handleSuccessRest(decoded.token, null, paymentData);
      } else {
        // Звичайна повна оплата
        let paymentData;
        try {
          const raw = await paymentsStore.get(invoiceId);
          paymentData = raw ? JSON.parse(raw) : null;
        } catch { paymentData = null; }

        if (!paymentData && decoded) {
          paymentData = { email: decoded.email, plan: decoded.plan, invoiceId };
        }

        if (paymentData) {
          if (paymentData.amountUAH == null && monoAmountUAH != null) {
            paymentData.amountUAH = monoAmountUAH;
          }
          await handleSuccessFull(paymentData, invoiceId);
        }
      }

      return new Response("OK", { status: 200 });
    }

    console.log("Unknown webhook format:", JSON.stringify(body).slice(0, 200));
    return new Response("OK", { status: 200 });

  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("OK", { status: 200 });
  }
};
