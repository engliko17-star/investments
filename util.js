/* Купонная книжка — общие помощники: даты, числа, форматирование */
(function () {
  'use strict';
  const KK = (window.KK = window.KK || {});
  const U = (KK.util = {});

  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  U.MONTHS = MONTHS;
  U.MONTHS_SHORT = MONTHS_SHORT;

  /* ---------- даты (строки YYYY-MM-DD, локальное время) ---------- */
  function iso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function parse(s) {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  U.iso = iso;
  U.parseISO = parse;
  U.today = () => iso(new Date());
  U.isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && s !== '0000-00-00';
  U.addDays = (s, n) => {
    const d = parse(s);
    d.setDate(d.getDate() + n);
    return iso(d);
  };
  U.addMonths = (s, n) => {
    const d = parse(s);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, dim));
    return iso(d);
  };
  U.isWeekend = (s) => {
    const w = parse(s).getDay();
    return w === 0 || w === 6;
  };
  /* дата расчётов по сделке: T+1 рабочий день */
  U.addBizDays = (s, n) => {
    let d = s;
    let left = n;
    while (left > 0) {
      d = U.addDays(d, 1);
      if (!U.isWeekend(d)) left--;
    }
    return d;
  };
  U.prevBizDay = (s) => {
    let d = U.addDays(s, -1);
    while (U.isWeekend(d)) d = U.addDays(d, -1);
    return d;
  };
  U.daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  U.daysInMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();
  U.year = (s) => Number(String(s).slice(0, 4));
  U.month0 = (s) => Number(String(s).slice(5, 7)) - 1;

  /* ---------- форматирование ---------- */
  const nf = {};
  function fmt(dec, min) {
    const k = dec + ':' + (min ?? dec);
    if (!nf[k]) nf[k] = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: dec, minimumFractionDigits: min ?? 0 });
    return nf[k];
  }
  U.num = (n, dec = 0, min) => (n == null || !isFinite(n) ? '—' : fmt(dec, min).format(n));
  U.rub = (n, dec = 0, opts = {}) => {
    if (n == null || !isFinite(n)) return '—';
    const s = fmt(dec, opts.min ?? (dec ? Math.min(dec, 2) : 0)).format(Math.abs(n));
    const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
    return sign + s + ' ₽';
  };
  /* рубли с копейками только когда они есть и сумма небольшая */
  U.rubAuto = (n, opts) => (n != null && Math.abs(n) < 1000 && Math.round(n) !== n ? U.rub(n, 2, opts) : U.rub(n, 0, opts));
  U.pct = (n, dec = 2, opts = {}) => {
    if (n == null || !isFinite(n)) return '—';
    const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
    return sign + fmt(dec, dec).format(Math.abs(n)) + ' %';
  };
  U.compact = (n) => {
    if (n == null || !isFinite(n)) return '';
    const a = Math.abs(n);
    if (a >= 1e6) return U.num(n / 1e6, a >= 1e7 ? 0 : 1) + ' млн';
    if (a >= 1e4) return U.num(n / 1e3, 0) + ' тыс';
    return U.num(n, 0);
  };
  U.date = (s) => {
    if (!U.isISO(s)) return '—';
    return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  };
  U.dateHuman = (s, withYear) => {
    if (!U.isISO(s)) return '—';
    const d = parse(s);
    const y = d.getFullYear();
    const showYear = withYear ?? y !== new Date().getFullYear();
    return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${showYear ? ' ' + y : ''}`;
  };
  U.monthTitle = (y, m0) => `${MONTHS[m0][0].toUpperCase()}${MONTHS[m0].slice(1)} ${y}`;
  U.plural = (n, forms) => {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  };
  U.term = (days) => {
    if (days == null || !isFinite(days)) return '—';
    if (days <= 0) return 'погашена';
    if (days < 60) return `${days} ${U.plural(days, ['день', 'дня', 'дней'])}`;
    const months = Math.round(days / 30.4375);
    const y = Math.floor(months / 12);
    const m = months % 12;
    if (!y) return `${m} мес`;
    return m ? `${y} ${U.plural(y, ['год', 'года', 'лет'])} ${m} мес` : `${y} ${U.plural(y, ['год', 'года', 'лет'])}`;
  };

  /* «1 234,56», «1234.5», «0,3%» → число */
  U.parseNum = (v) => {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim();
    if (!s) return null;
    s = s.replace(/[\s  ₽]/g, '').replace(/[−–]/g, '-');
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  };

  U.round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  U.sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  U.groupBy = (arr, f) => {
    const m = new Map();
    for (const x of arr) {
      const k = f(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  };
  U.esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
  U.debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };
  U.lsGet = (k, def) => {
    try {
      const v = localStorage.getItem(k);
      return v == null ? def : JSON.parse(v);
    } catch (e) {
      return def;
    }
  };
  U.lsSet = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch (e) {
      return false;
    }
  };
  U.lsDel = (k) => {
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  };
})();
