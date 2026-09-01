/*!
 * Blog Mi — Meta Pixel base
 * Ініціалізує Meta Pixel (1481333723021483) і трекає PageView.
 * Експортує:
 *   window.metaTrackPurchase({ value, currency, eventId, content_name, content_type, contents })
 *     — трекає Purchase з опціональним eventID для дедуплікації зі server-side CAPI.
 *   window.metaTrack(eventName, params, eventId) — узагальнений враппер.
 */
(function () {
  if (window.__metaPixelInited) return;
  window.__metaPixelInited = true;

  var PIXEL_ID = '1481333723021483';

  // ===== Standard Meta Pixel snippet =====
  !function(f,b,e,v,n,t,s){
    if(f.fbq)return;
    n=f.fbq=function(){
      n.callMethod ? n.callMethod.apply(n,arguments) : n.queue.push(arguments);
    };
    if(!f._fbq)f._fbq=n;
    n.push=n; n.loaded=!0; n.version='2.0'; n.queue=[];
    t=b.createElement(e); t.async=!0; t.src=v;
    s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', PIXEL_ID);
  // PageView викликається автоматично на кожному завантаженні сторінки,
  // де підключений цей скрипт.
  fbq('track', 'PageView');

  // ===== Public API =====

  /**
   * Універсальний враппер для треку стандартних подій.
   * @param {string} eventName — 'Purchase', 'Lead', 'InitiateCheckout', тощо
   * @param {object} params — параметри події (value, currency, ...)
   * @param {string} [eventId] — унікальний ID для дедуплікації з CAPI
   */
  window.metaTrack = function (eventName, params, eventId) {
    if (typeof fbq !== 'function') return;
    var opts = eventId ? { eventID: eventId } : {};
    fbq('track', eventName, params || {}, opts);
  };

  /**
   * Трек події Purchase.
   * @param {object} opts
   * @param {number} opts.value — сума (число, не рядок)
   * @param {string} [opts.currency] — 'UAH' за замовчуванням
   * @param {string} [opts.eventId] — для дедуплікації з CAPI
   * @param {string} [opts.content_name] — назва товару
   * @param {string} [opts.content_type] — 'product' за замовчуванням
   * @param {Array}  [opts.contents] — [{id, quantity, item_price}]
   */
  window.metaTrackPurchase = function (opts) {
    if (typeof fbq !== 'function' || !opts) return;
    var params = {
      value: Number(opts.value) || 0,
      currency: opts.currency || 'UAH'
    };
    if (opts.content_name) params.content_name = opts.content_name;
    params.content_type = opts.content_type || 'product';
    if (opts.contents) params.contents = opts.contents;

    var fbqOpts = opts.eventId ? { eventID: opts.eventId } : {};
    fbq('track', 'Purchase', params, fbqOpts);
  };
})();
