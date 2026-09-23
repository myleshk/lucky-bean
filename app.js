/*!
 * Lucky draw wheel - vanilla JS, no build step, GitHub Pages friendly.
 * All content comes from config.json (see that file for the schema).
 */
(() => {
  'use strict';

  const SUPPORTED = ['en', 'zh-Hant'];
  const LS_KEY = 'lucky-bean.locale';
  const TAU = Math.PI * 2;
  const FONT = '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';
  const DEFAULT_PALETTE = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#8e6bd6', '#e76f8a', '#43aa8b', '#f9c74f', '#577590', '#bc6c25'];

  /* Fallbacks for every piece of page chrome, so config.json only has to
     override what it cares about. */
  const DEFAULT_TEXT = {
    title: { en: 'Lucky Draw', 'zh-Hant': '幸運抽獎' },
    subtitle: { en: 'Tap the wheel and see what you get', 'zh-Hant': '點一下轉盤，睇下抽到咩' },
    spin: { en: 'Spin the wheel', 'zh-Hant': '開始抽獎' },
    spinning: { en: 'Spinning…', 'zh-Hant': '抽獎中…' },
    resultTitle: { en: 'You got', 'zh-Hant': '恭喜，你抽到' },
    open: { en: 'Open link', 'zh-Hant': '前往連結' },
    again: { en: 'Spin again', 'zh-Hant': '再抽一次' },
    close: { en: 'Close', 'zh-Hant': '關閉' },
    optionsHeading: { en: 'Options', 'zh-Hant': '獎項' },
    footer: { en: 'Results are drawn at random', 'zh-Hant': '結果以隨機方式抽出' },
    empty: { en: 'No draw options configured yet.', 'zh-Hant': '抽獎選項尚未設定。' },
    loadError: {
      en: 'Could not load config.json. Please open this page over http(s).',
      'zh-Hant': '無法載入 config.json，請以 http(s) 開啟此頁面。',
    },
    redirecting: { en: 'Redirecting in {seconds}s…', 'zh-Hant': '{seconds} 秒後自動前往…' },
  };

  const el = {
    canvas: document.getElementById('wheel'),
    wheelWrap: document.getElementById('wheel-wrap'),
    wheelDesc: document.getElementById('wheel-desc'),
    title: document.getElementById('ui-title'),
    subtitle: document.getElementById('ui-subtitle'),
    langToggle: document.getElementById('lang-toggle'),
    spinBtn: document.getElementById('spin-btn'),
    optionsPanel: document.getElementById('options-panel'),
    optionsHeading: document.getElementById('options-heading'),
    optionsList: document.getElementById('options-list'),
    footer: document.getElementById('ui-footer'),
    sheet: document.getElementById('sheet'),
    sheetBackdrop: document.getElementById('sheet-backdrop'),
    sheetLabel: document.getElementById('sheet-title'),
    sheetWinner: document.getElementById('sheet-winner'),
    sheetRedirect: document.getElementById('sheet-redirect'),
    sheetOpen: document.getElementById('sheet-open'),
    sheetAgain: document.getElementById('sheet-again'),
    sheetClose: document.getElementById('sheet-close'),
    notice: document.getElementById('notice'),
  };

  const ctx = el.canvas.getContext('2d');

  const state = {
    config: {},
    options: [],
    palette: DEFAULT_PALETTE,
    locale: 'en',
    size: 0,
    rotation: 0,
    spinning: false,
    winner: -1,
    raf: 0,
    redirectTimer: 0,
    loadFailed: false,
  };

  /* ---------------- text + locale ---------------- */

  function t(key, vars) {
    const overrides = (state.config && state.config.text) || {};
    const entry = overrides[key] || DEFAULT_TEXT[key] || {};
    let value = entry[state.locale];
    if (value == null) value = entry[state.config.defaultLocale];
    if (value == null) value = Object.values(entry)[0];
    if (value == null) return '';
    value = String(value);
    if (vars) {
      value = value.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
    }
    return value;
  }

  function labelFor(option) {
    if (!option) return '';
    const title = option.title;
    if (typeof title === 'string') return title;
    if (title && typeof title === 'object') {
      let value = title[state.locale];
      if (value == null) value = title[state.config.defaultLocale];
      if (value == null) value = Object.values(title)[0];
      if (value != null) return String(value);
    }
    if (typeof option.id === 'string') return option.id;
    return '';
  }

  /* Best match against the system/browser language list.
     Any Chinese variant maps to Traditional Chinese; everything else to English. */
  function detectLocale() {
    const stored = readStoredLocale();
    if (stored) return stored;
    const tags = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ''];
    for (const tag of tags) {
      const lang = String(tag).toLowerCase();
      if (lang.startsWith('zh')) return 'zh-Hant';
      if (lang.startsWith('en')) return 'en';
    }
    const fallback = state.config && state.config.defaultLocale;
    return SUPPORTED.includes(fallback) ? fallback : 'en';
  }

  function readStoredLocale() {
    try {
      const value = window.localStorage.getItem(LS_KEY);
      return SUPPORTED.includes(value) ? value : null;
    } catch (err) {
      return null;
    }
  }

  function applyLocale(next, manual) {
    state.locale = SUPPORTED.includes(next) ? next : 'en';
    if (manual) {
      try { window.localStorage.setItem(LS_KEY, state.locale); } catch (err) { /* private mode */ }
    }

    document.documentElement.lang = state.locale;
    document.documentElement.dataset.locale = state.locale;
    document.title = t('title');

    el.title.textContent = t('title');
    el.subtitle.textContent = t('subtitle');
    el.spinBtn.textContent = state.spinning ? t('spinning') : t('spin');
    el.footer.textContent = t('footer');
    el.sheetLabel.textContent = t('resultTitle');
    el.sheetAgain.textContent = t('again');
    el.sheetClose.setAttribute('aria-label', t('close'));
    if (!el.sheetOpen.hidden) el.sheetOpen.textContent = t('open');
    if (!el.sheet.hidden) el.sheetLabel.textContent = t('resultTitle');

    renderLangToggle();
    renderOptions();
    draw();
  }

  function renderLangToggle() {
    const allowed = !state.config || state.config.allowLanguageToggle !== false;
    el.langToggle.hidden = !allowed;
    el.langToggle.innerHTML = '';
    if (!allowed) return;

    [['en', 'EN'], ['zh-Hant', '繁']].forEach(([code, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.lang = code;
      button.textContent = label;
      button.setAttribute('aria-pressed', String(state.locale === code));
      button.addEventListener('click', () => applyLocale(code, true));
      el.langToggle.appendChild(button);
    });
  }

  function renderOptions() {
    const labels = state.options.map(labelFor);
    el.optionsPanel.hidden = labels.length === 0;
    el.optionsHeading.textContent = t('optionsHeading');
    el.optionsList.innerHTML = '';
    labels.forEach((label) => {
      const li = document.createElement('li');
      li.textContent = label;
      el.optionsList.appendChild(li);
    });
    el.wheelDesc.textContent = labels.join(', ');
    el.canvas.setAttribute('aria-label', `${t('title')}: ${labels.join(', ')}`);
  }

  /* ---------------- canvas ---------------- */

  function resize() {
    const rect = el.canvas.getBoundingClientRect();
    const size = Math.max(140, Math.round(rect.width || 320));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    el.canvas.width = Math.round(size * dpr);
    el.canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.size = size;
    draw();
  }

  function colorFor(index) {
    const palette = state.palette.length ? state.palette : DEFAULT_PALETTE;
    const color = palette[index % palette.length];
    // Keep the last wedge visually distinct from the first one.
    if (index === state.options.length - 1 && color === palette[0] && state.options.length > 1) {
      return palette[1 % palette.length];
    }
    return color;
  }

  function fit(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
    return `${out}…`;
  }

  /* Shrink the type a little before cutting the label short. */
  function fitFont(text, maxWidth, base, min) {
    let size = base;
    while (size > min) {
      ctx.font = `600 ${size}px ${FONT}`;
      if (ctx.measureText(text).width <= maxWidth) return size;
      size -= 1;
    }
    ctx.font = `600 ${min}px ${FONT}`;
    return min;
  }

  function draw() {
    const size = state.size || 320;
    const c = size / 2;
    const n = state.options.length;
    ctx.clearRect(0, 0, size, size);

    const R = c - Math.max(8, size * 0.03);
    const outer = Math.max(6, size * 0.026);

    if (!n) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, R - outer, 0, TAU);
      ctx.setLineDash([9, 9]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'currentColor';
      ctx.globalAlpha = 0.35;
      ctx.stroke();
      ctx.restore();
      return;
    }

    const seg = TAU / n;
    const baseFont = Math.max(9, Math.min(size * 0.048, (seg * R) * 0.6, 19));
    const hubR = Math.max(15, R * 0.17);

    for (let i = 0; i < n; i += 1) {
      const start = -Math.PI / 2 + state.rotation + i * seg;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, R - outer, start, start + seg);
      ctx.closePath();
      ctx.fillStyle = colorFor(i);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.stroke();

      if (i === state.winner && !state.spinning) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, R - outer, start, start + seg);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fill();
        ctx.lineWidth = Math.max(3, size * 0.013);
        ctx.strokeStyle = 'rgba(255,255,255,0.98)';
        ctx.shadowColor = 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.restore();
      }
    }

    // labels
    const textOuter = R - outer - Math.max(8, size * 0.035);
    const textInner = Math.max(hubR + size * 0.022, R * 0.24);
    const maxWidth = textOuter - textInner;

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 4;
    ctx.font = `600 ${baseFont}px ${FONT}`;

    for (let i = 0; i < n; i += 1) {
      const label = labelFor(state.options[i]);
      if (!label || maxWidth < 18) continue;
      const mid = -Math.PI / 2 + state.rotation + (i + 0.5) * seg;
      fitFont(label, maxWidth, baseFont, Math.max(9, baseFont * 0.74));
      const text = fit(label, maxWidth);
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(mid);
      if (Math.cos(mid) < 0) {
        // Left half: flip so the text is never upside down.
        ctx.rotate(Math.PI);
        ctx.textAlign = 'left';
        ctx.fillText(text, -textOuter, 0);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(text, textOuter, 0);
      }
      ctx.restore();
    }
    ctx.restore();

    // rim
    ctx.beginPath();
    ctx.arc(c, c, R - outer / 2, 0, TAU);
    ctx.lineWidth = outer;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();

    // hub
    const grad = ctx.createLinearGradient(c, c - hubR, c, c + hubR);
    grad.addColorStop(0, '#333c74');
    grad.addColorStop(1, '#161b3c');
    ctx.beginPath();
    ctx.arc(c, c, hubR, 0, TAU);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = Math.max(2, size * 0.008);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();

    ctx.save();
    ctx.font = `${Math.round(hubR * 0.95)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f9c74f';
    ctx.fillText('★', c, c + hubR * 0.04);
    ctx.restore();

    // pointer
    const pw = Math.max(11, size * 0.05);
    const apex = Math.max(10, size * 0.028) + pw * 1.5;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(c, apex);
    ctx.lineTo(c - pw, apex - pw * 1.5 - 4);
    ctx.lineTo(c + pw, apex - pw * 1.5 - 4);
    ctx.closePath();
    ctx.fillStyle = '#f9c74f';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(2, size * 0.007);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- spin ---------------- */

  function random() {
    if (window.crypto && window.crypto.getRandomValues) {
      const buffer = new Uint32Array(1);
      window.crypto.getRandomValues(buffer);
      return buffer[0] / 4294967296;
    }
    return Math.random();
  }

  function pickWinner() {
    let total = 0;
    const weights = state.options.map((option) => {
      const weight = Number(option && option.weight);
      const value = Number.isFinite(weight) && weight > 0 ? weight : 1;
      total += value;
      return value;
    });
    let roll = random() * total;
    for (let i = 0; i < weights.length; i += 1) {
      roll -= weights[i];
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }

  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mod = (value, base) => ((value % base) + base) % base;
  const buzz = (ms) => { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (err) { /* ignore */ } } };

  function spin() {
    if (state.spinning || !state.options.length) return;

    state.spinning = true;
    state.winner = -1;
    closeSheet(true);
    el.spinBtn.disabled = true;
    el.spinBtn.textContent = t('spinning');

    const n = state.options.length;
    const seg = TAU / n;
    const index = pickWinner();
    const jitter = (random() - 0.5) * seg * 0.62;
    const turns = reduceMotion() ? 1 : 5 + Math.floor(random() * 2);
    const target = -(index + 0.5) * seg + jitter;
    const start = state.rotation;
    const end = start + turns * TAU + mod(target - start, TAU);
    const duration = reduceMotion() ? 500 : Math.max(900, Number(state.config.spinDurationMs) || 4200);
    const begin = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - begin) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      state.rotation = start + (end - start) * eased;
      draw();
      if (progress < 1) {
        state.raf = window.requestAnimationFrame(step);
      } else {
        finish(index);
      }
    };

    state.raf = window.requestAnimationFrame(step);
  }

  function finish(index) {
    state.spinning = false;
    state.winner = index;
    state.rotation = mod(state.rotation, TAU);
    el.spinBtn.disabled = false;
    el.spinBtn.textContent = t('spin');
    draw();
    buzz(22);
    openSheet(index);
  }

  /* ---------------- result sheet ---------------- */

  function safeUrl(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return '';
    try {
      const url = new URL(raw.trim(), window.location.href);
      return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
    } catch (err) {
      return '';
    }
  }

  function openSheet(index) {
    const option = state.options[index];
    const url = safeUrl(option && option.url);

    el.sheetLabel.textContent = t('resultTitle');
    el.sheetWinner.textContent = labelFor(option);
    el.sheetAgain.textContent = t('again');

    if (url) {
      el.sheetOpen.href = url;
      el.sheetOpen.textContent = t('open');
      el.sheetOpen.hidden = false;
    } else {
      el.sheetOpen.hidden = true;
      el.sheetOpen.removeAttribute('href');
    }

    window.clearInterval(state.redirectTimer);
    state.redirectTimer = 0;
    const seconds = Number(state.config.autoRedirectSeconds) || 0;
    if (url && seconds > 0) {
      let left = Math.ceil(seconds);
      el.sheetRedirect.hidden = false;
      el.sheetRedirect.textContent = t('redirecting', { seconds: left });
      state.redirectTimer = window.setInterval(() => {
        left -= 1;
        if (left <= 0) {
          window.clearInterval(state.redirectTimer);
          window.location.href = url;
          return;
        }
        el.sheetRedirect.textContent = t('redirecting', { seconds: left });
      }, 1000);
    } else {
      el.sheetRedirect.hidden = true;
    }

    el.sheet.hidden = false;
    el.sheetBackdrop.hidden = false;
    window.requestAnimationFrame(() => {
      el.sheet.classList.add('open');
      (url ? el.sheetOpen : el.sheetAgain).focus({ preventScroll: true });
    });
  }

  function closeSheet(instant) {
    window.clearInterval(state.redirectTimer);
    state.redirectTimer = 0;
    if (el.sheet.hidden) return;
    el.sheet.classList.remove('open');
    el.sheetBackdrop.hidden = true;
    if (instant) {
      el.sheet.hidden = true;
      return;
    }
    window.setTimeout(() => {
      if (!el.sheet.classList.contains('open')) el.sheet.hidden = true;
    }, 340);
    el.spinBtn.focus({ preventScroll: true });
  }

  /* ---------------- boot ---------------- */

  function showNotice(message) {
    el.notice.textContent = message;
    el.notice.hidden = false;
  }

  function applyTheme() {
    const theme = (state.config && state.config.theme) || {};

    if (typeof theme.background === 'string' && theme.background.trim()) {
      document.body.style.background = theme.background.trim();
    }
    if (typeof theme.accent === 'string' && theme.accent.trim()) {
      document.documentElement.style.setProperty('--accent', theme.accent.trim());
    }
    if (Array.isArray(theme.palette)) {
      const palette = theme.palette.filter((color) => typeof color === 'string' && color.trim());
      if (palette.length) state.palette = palette;
    }

    const mode = resolveThemeMode(theme);
    document.documentElement.dataset.theme = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'light' ? '#eef1fb' : '#0d1130');
  }

  /* theme.mode wins; otherwise a custom background decides the tokens it needs;
     otherwise follow the system setting. */
  function resolveThemeMode(theme) {
    if (theme.mode === 'light' || theme.mode === 'dark') return theme.mode;
    if (typeof theme.background === 'string') {
      const luminance = averageLuminance(theme.background);
      if (luminance !== null) return luminance < 0.5 ? 'dark' : 'light';
    }
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function averageLuminance(css) {
    const hexes = String(css).match(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi);
    if (!hexes || !hexes.length) return null;
    const total = hexes.reduce((sum, hex) => {
      const raw = hex.slice(1);
      const full = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
      const r = parseInt(full.slice(0, 2), 16) / 255;
      const g = parseInt(full.slice(2, 4), 16) / 255;
      const b = parseInt(full.slice(4, 6), 16) / 255;
      return sum + (0.2126 * r + 0.7152 * g + 0.0722 * b);
    }, 0);
    return total / hexes.length;
  }

  const followSystem = () => !state.config.theme
    || (state.config.theme.mode !== 'light'
      && state.config.theme.mode !== 'dark'
      && !(typeof state.config.theme.background === 'string' && state.config.theme.background.trim()));

  function normalizeConfig(raw) {
    const config = (raw && typeof raw === 'object') ? raw : {};
    const list = Array.isArray(config.options) ? config.options : [];
    config.options = list
      .filter((option) => option && (typeof option === 'string' || typeof option === 'object'))
      .map((option) => (typeof option === 'string'
        ? { title: { en: option, 'zh-Hant': option } }
        : option));
    return config;
  }

  async function loadConfig() {
    if (window.LUCKY_BEAN_CONFIG && typeof window.LUCKY_BEAN_CONFIG === 'object') {
      return window.LUCKY_BEAN_CONFIG;
    }
    const response = await fetch('config.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function bindEvents() {
    el.spinBtn.addEventListener('click', spin);
    el.canvas.addEventListener('click', spin);
    el.sheetAgain.addEventListener('click', spin);
    el.sheetOpen.addEventListener('click', () => { window.clearInterval(state.redirectTimer); });
    el.sheetClose.addEventListener('click', () => closeSheet());
    el.sheetBackdrop.addEventListener('click', () => closeSheet());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSheet();
    });
    if ('ResizeObserver' in window) {
      new ResizeObserver(resize).observe(el.wheelWrap);
    } else {
      window.addEventListener('resize', resize);
    }
    window.addEventListener('orientationchange', () => window.setTimeout(resize, 250));
  }

  async function init() {
    bindEvents();
    try {
      state.config = normalizeConfig(await loadConfig());
    } catch (err) {
      state.loadFailed = true;
      state.config = normalizeConfig({});
    }

    state.options = state.config.options;
    applyTheme();
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (followSystem()) applyTheme();
      });
    }
    applyLocale(detectLocale(), false);
    resize();
    el.spinBtn.disabled = state.options.length === 0;

    if (state.loadFailed) showNotice(t('loadError'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
