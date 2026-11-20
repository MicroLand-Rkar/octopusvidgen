/* OctopusVidGen landing: language switching.
   Every string carries data-i18n="key" (its text) or data-i18n-attr="attr:key;attr2:key2" (attributes), with the
   English written in the HTML. i18n/<code>.json is a flat { key: string } file; a key it lacks keeps the English.
   The choice is stored under "ovg.lang", the same key the studio at /app/ reads, so it carries over. */
(function () {
  var LANGS = ['en', 'zh', 'my', 'th', 'es', 'hi', 'ar', 'pt', 'fr', 'de', 'ru', 'ja', 'ko', 'vi', 'id'];
  var RTL = { ar: true };
  var KEY = 'ovg.lang';
  var root = document.documentElement;
  var en = {};
  var cache = { en: en };
  var current = 'en';
  var currentDict = null;
  var watching = false;

  // Motion scripts (the hero's entrance, split headlines) may put the original English back after a
  // language was applied; put the chosen language back whenever a translated element's text changes.
  function watch() {
    if (watching || !window.MutationObserver) return;
    watching = true;
    new MutationObserver(function (records) {
      if (current === 'en' || !currentDict) return;
      var seen = [];
      function fix(el) {
        if (!el || seen.indexOf(el) >= 0) return;
        seen.push(el);
        var k = el.getAttribute('data-i18n');
        var v = typeof currentDict[k] === 'string' && currentDict[k] !== '' ? currentDict[k] : null;
        if (v != null && el.textContent !== v) el.textContent = v;
      }
      records.forEach(function (r) {
        var el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        fix(el && el.closest ? el.closest('[data-i18n]') : null);
        // an element swapped in whole (a re-rendered headline)
        (r.addedNodes || []).forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.hasAttribute('data-i18n')) fix(n);
          n.querySelectorAll('[data-i18n]').forEach(fix);
        });
      });
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  function attrPairs(el) {
    return (el.getAttribute('data-i18n-attr') || '').split(';').map(function (p) {
      var i = p.indexOf(':');
      return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : null;
    }).filter(Boolean);
  }

  // The English is read from the page itself before any script changes it.
  function collect() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (!(k in en)) en[k] = el.textContent;
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      attrPairs(el).forEach(function (p) { if (!(p[1] in en)) en[p[1]] = el.getAttribute(p[0]) || ''; });
    });
  }

  function apply(code, dict) {
    function t(k) { return dict && typeof dict[k] === 'string' && dict[k] !== '' ? dict[k] : en[k]; }
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = t(el.getAttribute('data-i18n'));
      if (v != null && el.textContent !== v) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      attrPairs(el).forEach(function (p) { var v = t(p[1]); if (v != null) el.setAttribute(p[0], v); });
    });
    root.lang = code;
    root.dir = RTL[code] ? 'rtl' : 'ltr';
    current = code;
    currentDict = dict;
    watch();
    // and once more after the entrance animations and late scripts have run
    if (code !== 'en') [400, 1200, 2600].forEach(function (ms) {
      setTimeout(function () { if (current === code) reapply(); }, ms);
    });
    document.querySelectorAll('[data-lang-picker]').forEach(function (s) { s.value = code; });
  }

  function reapply() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      var v = currentDict && typeof currentDict[k] === 'string' && currentDict[k] !== '' ? currentDict[k] : null;
      if (v != null && el.textContent !== v) el.textContent = v;
    });
  }

  function load(code) {
    if (cache[code]) return Promise.resolve(cache[code]);
    return fetch('i18n/' + code + '.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (d) { cache[code] = d || {}; return cache[code]; });
  }

  function setLang(code, save) {
    if (LANGS.indexOf(code) < 0) code = 'en';
    if (save) { try { localStorage.setItem(KEY, code); } catch (e) { /* storage off */ } }
    if (code === 'en') { apply('en', en); return; }
    load(code).then(function (d) { apply(code, d); });
  }

  function initial() {
    // ?lang=xx shows one language without saving it (links, screenshots)
    var q = /[?&]lang=([a-z]{2})/.exec(location.search);
    if (q && LANGS.indexOf(q[1]) >= 0) return q[1];
    try {
      var saved = localStorage.getItem(KEY);
      if (saved && LANGS.indexOf(saved) >= 0) return saved;
    } catch (e) { /* storage off */ }
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < list.length; i++) {
      var c = String(list[i]).toLowerCase().split('-')[0];
      if (LANGS.indexOf(c) >= 0) return c;
    }
    return 'en';
  }

  function start() {
    collect();
    document.querySelectorAll('[data-lang-picker]').forEach(function (s) {
      s.addEventListener('change', function () { setLang(s.value, true); });
    });
    var code = initial();
    if (code === 'en') return apply('en', en);
    // The first language is read synchronously, before the kit's modules run, so the hero's entrance
    // animation splits and restores the translated headline instead of the English one.
    try {
      var x = new XMLHttpRequest();
      x.open('GET', 'i18n/' + code + '.json', false);
      x.send();
      if (x.status === 200) { cache[code] = JSON.parse(x.responseText); apply(code, cache[code]); return; }
    } catch (e) { /* fall back to the async load */ }
    setLang(code, false);
  }

  window.ovgI18n = { set: function (c) { setLang(c, true); }, get lang() { return current; } };
  // Loaded at the end of <body>, before the kit's modules: the English is read before any loop changes it.
  start();
})();
