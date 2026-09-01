import { getCurrentPricing } from "./_pricing.mjs";

// Публічний ендпоінт: віддає актуальні ціни й місця по трьох тарифах.
// Викликається лендінгом при завантаженні + періодичним поллінгом.
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
    const pricing = await getCurrentPricing();
    return new Response(JSON.stringify(pricing), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  } catch (err) {
    console.error("current-pricing error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  }
};
