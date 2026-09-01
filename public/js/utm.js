/*!
 * Blog Mi — UTM tracker
 * Захоплює UTM-параметри з URL і зберігає в localStorage.
 * Зберігає first-touch (перший дотик) і last-touch (останній дотик) окремо.
 * Експортує:
 *   window.getBlogmiUtm()      — повертає плоский {utm_source, utm_medium, ...} (last з fallback на first)
 *   window.getBlogmiUtmFull()  — повертає {first, last, referrer, landing}
 *   window.getMetaCookies()    — повертає {fbp, fbc} для Meta CAPI
 */
(function () {
  if (window.__blogmiUtmInited) return;
  window.__blogmiUtmInited = true;

  var UTM_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term'
  ];
  var STORE_KEY = 'blogmi_utm_v1';
  var FBC_KEY = 'blogmi_fbc';

  function readFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      var u = {};
      var has = false;
      UTM_KEYS.forEach(function (k) {
        var v = params.get(k);
        if (v) { u[k] = v; has = true; }
      });
      return has ? u : null;
    } catch (e) { return null; }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function save(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  // Захоплюємо UTM з поточного URL
  var fresh = readFromUrl();
  var stored = load();

  if (fresh) {
    if (!stored.first) {
      stored.first = Object.assign({ ts: Date.now() }, fresh);
    }
    stored.last = Object.assign({ ts: Date.now() }, fresh);
  }

  // Один раз фіксуємо реферер і landing-сторінку
  if (!stored.referrer && document.referrer) {
    stored.referrer = document.referrer;
  }
  if (!stored.landing) {
    stored.landing = window.location.pathname + window.location.search;
  }

  // Захоплюємо fbclid (Meta click ID) → формуємо _fbc
  try {
    var fbclid = new URLSearchParams(window.location.search).get('fbclid');
    if (fbclid) {
      var fbc = 'fb.1.' + Date.now() + '.' + fbclid;
      // зберігаємо в cookie на 90 днів (стандарт Meta) + дублюємо в localStorage
      var maxAge = 60 * 60 * 24 * 90;
      document.cookie = '_fbc=' + fbc + '; max-age=' + maxAge + '; path=/; SameSite=Lax';
      try { localStorage.setItem(FBC_KEY, fbc); } catch (e) {}
    }
  } catch (e) {}

  if (fresh || (!stored.referrer && document.referrer) || stored.landing) {
    save(stored);
  }

  // ============ Public API ============

  /**
   * Повертає плоский об'єкт UTM-параметрів для передачі на бекенд.
   * Last-touch має пріоритет над first-touch.
   */
  window.getBlogmiUtm = function () {
    var s = load();
    var out = {};
    UTM_KEYS.forEach(function (k) {
      out[k] = (s.last && s.last[k]) || (s.first && s.first[k]) || null;
    });
    // Окремо first-touch source/medium/campaign (для атрибуції в SP)
    out.utm_source_first = (s.first && s.first.utm_source) || null;
    out.utm_medium_first = (s.first && s.first.utm_medium) || null;
    out.utm_campaign_first = (s.first && s.first.utm_campaign) || null;
    out.utm_referrer = s.referrer || '';
    out.utm_landing = s.landing || '';
    return out;
  };

  /**
   * Повний об'єкт зі станом (для debug).
   */
  window.getBlogmiUtmFull = function () {
    return load();
  };

  /**
   * Повертає _fbp і _fbc cookies для Meta CAPI.
   */
  window.getMetaCookies = function () {
    var cookies = {};
    try {
      document.cookie.split(';').forEach(function (c) {
        var parts = c.trim().split('=');
        if (parts[0]) cookies[parts[0]] = parts.slice(1).join('=');
      });
    } catch (e) {}

    var fbp = cookies['_fbp'] || '';
    var fbc = cookies['_fbc'] || '';

    // Fallback на localStorage для fbc, якщо cookie не доступна
    if (!fbc) {
      try { fbc = localStorage.getItem(FBC_KEY) || ''; } catch (e) {}
    }

    return { fbp: fbp, fbc: fbc };
  };
})();
