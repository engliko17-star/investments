/* Купонная книжка — данные Московской биржи (ISS, iss.moex.com)
   Браузер ходит в ISS напрямую. Если напрямую не пускает, а в config.js указан
   moexProxyUrl (edge-функция Supabase), запросы идут через неё. Ответы кэшируются
   в localStorage, поэтому без связи страница показывает последние известные данные. */
(function () {
  'use strict';
  const KK = (window.KK = window.KK || {});
  const U = KK.util;
  const M = (KK.moex = {});

  const BASE = 'https://iss.moex.com';
  const CACHE_PREFIX = 'kk:iss:';
  const TTL = {
    quotes: 60 * 1000,
    describe: 7 * 864e5,
    bondization: 12 * 3600e3,
    dividends: 24 * 3600e3,
    search: 864e5,
  };

  M.status = { ok: null, via: null, lastError: null, lastFetch: null, stale: false };
  const listeners = new Set();
  M.onStatus = (fn) => listeners.add(fn);
  function setStatus(patch) {
    Object.assign(M.status, patch);
    listeners.forEach((fn) => fn(M.status));
  }

  function cfg() {
    return window.KK_CONFIG || {};
  }

  async function fetchJSON(url, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  /* запасной канал: функция moex-proxy в том же проекте Supabase.
     Если адрес не указан в config.js, берём его из адреса Supabase. */
  function proxyUrl() {
    const c = cfg();
    if (c.moexProxyUrl) return c.moexProxyUrl;
    if (c.supabaseUrl) return c.supabaseUrl.replace(/\/+$/, '') + '/functions/v1/moex-proxy';
    return null;
  }
  M.proxyUrl = proxyUrl;

  async function fetchISS(path) {
    const proxy = proxyUrl();
    const prefer = U.lsGet('kk:moexVia', 'direct');
    const errs = {};
    const direct = () =>
      fetchJSON(BASE + path)
        .then((d) => ({ d, via: 'direct' }))
        .catch((e) => {
          errs.direct = e;
          throw e;
        });
    const viaProxy = () => {
      if (!proxy) return Promise.reject((errs.proxy = new Error('нет адреса')));
      const sep = proxy.includes('?') ? '&' : '?';
      const key = cfg().supabaseAnonKey;
      const headers = key && /^eyJ/.test(key) ? { apikey: key, Authorization: 'Bearer ' + key } : key ? { apikey: key } : {};
      return fetchJSON(proxy + sep + 'path=' + encodeURIComponent(path), { headers })
        .then((d) => {
          if (d && d.error && !d.securities && !d.description) throw new Error(d.error);
          return { d, via: 'proxy' };
        })
        .catch((e) => {
          errs.proxy = e;
          throw e;
        });
    };
    const order = prefer === 'proxy' && proxy ? [viaProxy, direct] : [direct, viaProxy];
    for (const f of order) {
      try {
        const res = await f();
        if (res.via !== prefer) U.lsSet('kk:moexVia', res.via);
        setStatus({ ok: true, via: res.via, lastError: null, lastFetch: Date.now() });
        return res.d;
      } catch (e) {
        /* пробуем следующий путь */
      }
    }
    const pe = errs.proxy ? errs.proxy.message : '';
    let msg;
    if (!proxy) msg = 'браузер не пускает к Мосбирже напрямую, а запасной канал не настроен';
    else if (/404/.test(pe)) msg = 'браузер не пускает к Мосбирже напрямую, а функция moex-proxy в Supabase ещё не создана';
    else if (/401|403/.test(pe)) msg = 'функция moex-proxy в Supabase просит вход: выключите у неё проверку JWT';
    else msg = 'Мосбиржа не отвечает ни напрямую, ни через Supabase' + (pe ? ' (' + pe + ')' : '');
    setStatus({ ok: false, lastError: msg });
    throw new Error(msg);
  }

  async function get(path, ttl, { force } = {}) {
    const key = CACHE_PREFIX + path;
    const cached = U.lsGet(key, null);
    if (!force && cached && Date.now() - cached.t < ttl) return cached.d;
    try {
      const d = await fetchISS(path);
      if (!U.lsSet(key, { t: Date.now(), d })) {
        pruneCache();
        U.lsSet(key, { t: Date.now(), d });
      }
      return d;
    } catch (e) {
      if (cached) {
        setStatus({ stale: true });
        return cached.d;
      }
      throw e;
    }
  }
  M.cachedAt = (path) => U.lsGet(CACHE_PREFIX + path, null)?.t || null;

  function pruneCache() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) keys.push([k, U.lsGet(k, { t: 0 }).t]);
      }
      keys.sort((a, b) => a[1] - b[1]).slice(0, Math.ceil(keys.length / 2)).forEach(([k]) => U.lsDel(k));
    } catch (e) {}
  }

  /* ISS-блок {columns, data} → массив объектов */
  function rows(json, block) {
    const b = json && json[block];
    if (!b || !b.columns || !b.data) return [];
    return b.data.map((r) => {
      const o = {};
      b.columns.forEach((c, i) => (o[c] = r[i]));
      return o;
    });
  }
  M.rows = rows;
  const pick = (o, ...keys) => {
    for (const k of keys) {
      const v = o && o[k];
      if (v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && !isFinite(v))) return v;
    }
    return null;
  };
  const pos = (v) => (typeof v === 'number' && v > 0 ? v : null);
  const date = (v) => (U.isISO(v) ? v : null);

  function kindOf(group, type, market) {
    const g = String(group || '').toLowerCase();
    const t = String(type || '').toLowerCase();
    if (g.includes('bond') || t.includes('bond')) return 'bond';
    if (g.includes('ppif') || g.includes('etf') || t.includes('ppif') || t.includes('etf') || t.includes('pif')) return 'fund';
    if (g.includes('share') || t.includes('share') || g.includes('_dr') || t.includes('depositary')) return 'share';
    if (market === 'bonds') return 'bond';
    return market === 'shares' ? 'share' : null;
  }
  M.kindOf = kindOf;

  /* ---------- поиск бумаги по тикеру, ISIN или названию ---------- */
  M.search = async (q) => {
    q = String(q || '').trim();
    if (q.length < 2) return [];
    const json = await get(`/iss/securities.json?q=${encodeURIComponent(q)}&iss.meta=off&iss.only=securities&limit=30`, TTL.search);
    return rows(json, 'securities')
      .filter((r) => String(r.group || '').startsWith('stock_') || /bond|share|ppif|etf/.test(String(r.type || '')))
      .map((r) => ({
        secid: r.secid,
        shortname: r.shortname,
        name: r.name,
        isin: r.isin,
        traded: r.is_traded === 1,
        kind: kindOf(r.group, r.type),
        board: r.primary_boardid || r.marketprice_boardid,
      }))
      .filter((r) => r.kind)
      .sort((a, b) => Number(b.traded) - Number(a.traded));
  };

  /* ---------- карточка бумаги: тип, площадка, номинал, погашение ---------- */
  M.describe = async (secid) => {
    const json = await get(
      `/iss/securities/${encodeURIComponent(secid)}.json?iss.meta=off&iss.only=description,boards`,
      TTL.describe
    );
    const d = {};
    rows(json, 'description').forEach((r) => (d[r.name] = r.value));
    if (!d.SECID) return null;
    const boards = rows(json, 'boards').filter((b) => b.engine === 'stock');
    const primary =
      boards.find((b) => b.is_primary === 1 && b.is_traded === 1) ||
      boards.find((b) => b.is_primary === 1) ||
      boards.find((b) => b.is_traded === 1) ||
      boards[0];
    const market = primary ? primary.market : null;
    const num = (v) => (v == null || v === '' ? null : U.parseNum(v));
    return {
      secid: d.SECID,
      shortname: d.SHORTNAME || d.NAME || d.SECID,
      name: d.NAME || d.SHORTNAME,
      isin: d.ISIN || null,
      kind: kindOf(d.GROUP, d.TYPE, market),
      typeName: d.TYPENAME || null,
      market,
      board: primary ? primary.boardid : null,
      initialFace: num(d.INITIALFACEVALUE),
      faceValue: num(d.FACEVALUE),
      matDate: date(d.MATDATE),
      couponFreq: num(d.COUPONFREQUENCY),
      couponPercent: num(d.COUPONPERCENT),
      faceUnit: d.FACEUNIT || null,
    };
  };

  /* тикер или ISIN → карточка */
  M.resolve = async (code) => {
    code = String(code || '').trim();
    if (!code) return null;
    try {
      const d = await M.describe(code);
      if (d) return d;
    } catch (e) {
      /* попробуем поиском */
    }
    const found = await M.search(code);
    const up = code.toUpperCase();
    const exact =
      found.find((f) => String(f.secid).toUpperCase() === up) ||
      found.find((f) => String(f.isin).toUpperCase() === up) ||
      found.find((f) => String(f.shortname).toUpperCase() === up) ||
      (found.length === 1 ? found[0] : null);
    return exact ? M.describe(exact.secid) : null;
  };

  /* ---------- котировки: одна выдача на площадку ---------- */
  M.quotes = async (list, { force } = {}) => {
    const groups = new Map();
    for (const s of list) {
      if (!s || !s.secid || !s.market || !s.board) continue;
      const k = s.market + '|' + s.board;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s.secid);
    }
    const out = {};
    await Promise.all(
      [...groups.entries()].map(async ([k, ids]) => {
        const [market, board] = k.split('|');
        ids.sort();
        for (let i = 0; i < ids.length; i += 50) {
          const chunk = ids.slice(i, i + 50);
          const path = `/iss/engines/stock/markets/${market}/boards/${board}/securities.json?securities=${chunk
            .map(encodeURIComponent)
            .join(',')}&iss.meta=off&iss.only=securities,marketdata`;
          const json = await get(path, TTL.quotes, { force });
          const at = M.cachedAt(path);
          const md = {};
          rows(json, 'marketdata').forEach((r) => (md[r.SECID] = r));
          rows(json, 'securities').forEach((s) => {
            const m = md[s.SECID] || {};
            const isBond = market === 'bonds';
            const price = pos(pick(m, 'LAST', 'LCURRENTPRICE', 'MARKETPRICE', 'MARKETPRICETODAY')) ??
              pos(pick(s, 'PREVLEGALCLOSEPRICE', 'PREVPRICE', 'PREVWAPRICE', 'PREVADMITTEDQUOTE'));
            const face = pos(pick(s, 'FACEVALUE'));
            out[s.SECID] = {
              secid: s.SECID,
              shortname: s.SHORTNAME,
              secname: s.SECNAME,
              isin: s.ISIN || null,
              market,
              board,
              price, // облигации — % от номинала, остальное — ₽ за бумагу
              priceRub: price == null ? null : isBond ? (price / 100) * (face || 1000) : price,
              prevPrice: pos(pick(s, 'PREVLEGALCLOSEPRICE', 'PREVPRICE')),
              change: pick(m, 'LASTCHANGEPRCNT', 'LASTTOPREVPRICE'),
              faceValue: face,
              accruedInt: isBond ? pick(s, 'ACCRUEDINT') : null,
              couponValue: isBond ? pick(s, 'COUPONVALUE') : null,
              couponPercent: isBond ? pick(s, 'COUPONPERCENT') : null,
              couponPeriod: isBond ? pick(s, 'COUPONPERIOD') : null,
              nextCoupon: isBond ? date(s.NEXTCOUPON) : null,
              matDate: isBond ? date(s.MATDATE) : null,
              offerDate: isBond ? date(pick(s, 'OFFERDATE', 'BUYBACKDATE', 'PUTOPTIONDATE')) : null,
              lotSize: pick(s, 'LOTSIZE'),
              ytm: isBond ? pos(pick(m, 'YIELD', 'YIELDATWAPRICE', 'CLOSEYIELD')) ?? pos(pick(s, 'YIELDATPREVWAPRICE')) : null,
              duration: isBond ? pick(m, 'DURATION') : null,
              time: pick(m, 'UPDATETIME', 'TIME'),
              tradeDate: pick(m, 'TRADEDATE', 'SYSTIME'),
              fetchedAt: at,
            };
          });
        }
      })
    );
    return out;
  };

  /* ---------- расписание облигации: купоны, амортизация, оферты ---------- */
  M.bondization = async (secid) => {
    const json = await get(
      `/iss/statistics/engines/stock/markets/bonds/bondization/${encodeURIComponent(
        secid
      )}.json?iss.meta=off&iss.only=coupons,amortizations,offers&limit=unlimited`,
      TTL.bondization
    );
    const coupons = rows(json, 'coupons')
      .map((c) => ({
        date: date(c.coupondate),
        recordDate: date(c.recorddate),
        startDate: date(c.startdate),
        value: typeof c.value_rub === 'number' ? c.value_rub : typeof c.value === 'number' ? c.value : null,
        rate: typeof c.valueprc === 'number' ? c.valueprc : null,
        face: typeof c.facevalue === 'number' ? c.facevalue : null,
      }))
      .filter((c) => c.date)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const amorts = rows(json, 'amortizations')
      .map((a) => ({
        date: date(a.amortdate),
        value: typeof a.value_rub === 'number' ? a.value_rub : typeof a.value === 'number' ? a.value : null,
        pct: typeof a.valueprc === 'number' ? a.valueprc : null,
        maturity: String(a.data_source || '').toLowerCase() === 'maturity',
        face: typeof a.facevalue === 'number' ? a.facevalue : null,
      }))
      .filter((a) => a.date)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    // если источник не размечен, последняя выплата — погашение
    if (amorts.length && !amorts.some((a) => a.maturity)) amorts[amorts.length - 1].maturity = true;
    const offers = rows(json, 'offers')
      .map((o) => ({ date: date(o.offerdate), type: o.offertype || null }))
      .filter((o) => o.date);
    return {
      coupons,
      amorts,
      offers,
      hasAmortization: amorts.filter((a) => !a.maturity).length > 0,
    };
  };

  /* ---------- дивиденды ---------- */
  M.dividends = async (secid) => {
    const json = await get(`/iss/securities/${encodeURIComponent(secid)}/dividends.json?iss.meta=off`, TTL.dividends);
    return rows(json, 'dividends')
      .map((d) => ({ recordDate: date(d.registryclosedate), value: typeof d.value === 'number' ? d.value : null, currency: d.currencyid }))
      .filter((d) => d.recordDate && d.value != null && (!d.currency || /RUB|SUR/i.test(d.currency)));
  };

  M.clearCache = () => {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => U.lsDel(k));
    } catch (e) {}
  };
})();
