/* Купонная книжка — интерфейс */
(function () {
  'use strict';
  const KK = window.KK;
  const U = KK.util;
  const E = KK.engine;
  const M = KK.moex;
  const C = KK.charts;
  const I = KK.importer;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = U.esc;

  const VIEWS = ['overview', 'assets', 'history', 'forecast', 'analytics'];
  const KIND_COLOR = { bond: 'var(--bond)', share: 'var(--share)', fund: 'var(--fund)' };
  const TODAY = () => U.today();

  const S = {
    store: null,
    ops: [],
    settings: { ...KK.DEFAULT_SETTINGS },
    info: {},
    model: null,
    account: 'all',
    view: 'overview',
    year: U.year(TODAY()),
    month: U.month0(TODAY()),
    net: true,
    assets: { kind: 'all', q: '', closed: false, sort: 'mv', dir: -1 },
    hist: { type: 'all', src: 'all', q: '', confirm: null, limit: 12, open: [] },
    fc: null,
    marketLoading: false,
    started: false,
  };

  const ICON = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  };

  /* ================= общие помощники ================= */
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (err ? ' err' : '');
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), err ? 7000 : 3200);
  }
  const dot = (k) => `<span class="dot ${esc(k || 'bond')}" aria-hidden="true"></span>`;
  const sgn = (n) => (n > 0.005 ? 'good' : n < -0.005 ? 'bad' : '');
  const amt = (n) => U.rubAuto(n);
  async function pool(items, n, fn) {
    const q = [...items];
    await Promise.all(
      Array.from({ length: Math.min(n, q.length) }, async () => {
        while (q.length) await fn(q.shift());
      })
    );
  }
  function stripNulls(o) {
    const r = {};
    for (const k in o) if (o[k] != null) r[k] = o[k];
    return r;
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }
  function opsForAccount() {
    return S.account === 'all' ? S.ops : S.ops.filter((o) => (o.account || '') === S.account);
  }
  function recompute() {
    S.model = E.build({ ops: opsForAccount(), info: S.info, settings: S.settings });
  }
  function accounts() {
    const set = new Set(S.settings.accounts || []);
    S.ops.forEach((o) => o.account && set.add(o.account));
    return [...set];
  }
  function knownSecurities() {
    const map = new Map();
    for (const o of S.ops) {
      if (!o.secid) continue;
      const inf = S.info[o.secid] || {};
      map.set(o.secid, { secid: o.secid, shortname: inf.shortname || o.name || o.secid, kind: inf.kind || o.asset_type || 'bond', isin: inf.isin || o.isin });
    }
    return [...map.values()];
  }
  const statusText = (f) => {
    if (f.status === 'received') return f.source === 'import' ? 'получено · из отчёта' : 'получено · внесено вручную';
    if (f.status === 'auto') return 'по расписанию Мосбиржи';
    return 'ожидается' + (f.estimate ? ' · оценка' : f.approxDate ? ' · дата примерная' : '');
  };

  /* ================= запуск ================= */
  async function boot() {
    applyTheme(U.lsGet('kk:theme', 'system'));
    const configured = KK.storeConfigured() && !!window.supabase;
    if (!configured) {
      if (U.lsGet('kk:demo', false)) {
        S.store = KK.makeStore(true);
        return start();
      }
      return showLogin(true);
    }
    S.store = KK.makeStore(false);
    try {
      const user = await S.store.init();
      S.store.onAuthChange((u) => {
        if (!u && S.started) location.reload();
      });
      if (user) return start();
    } catch (e) {
      console.error(e);
    }
    showLogin(false);
  }

  function showLogin(setup) {
    $('#boot').hidden = true;
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#setupNote').hidden = !setup;
    $('#loginForm').hidden = setup;
    $('#demoBtn').hidden = !setup;
    if (!setup) setTimeout(() => $('#loginEmail').focus(), 50);
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#loginError');
    err.hidden = true;
    const btn = $('#loginBtn');
    btn.disabled = true;
    btn.textContent = 'Вхожу…';
    try {
      await S.store.signIn($('#loginEmail').value.trim(), $('#loginPass').value);
      await start();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Войти';
    }
  });
  $('#demoBtn').addEventListener('click', () => {
    U.lsSet('kk:demo', true);
    S.store = KK.makeStore(true);
    start();
  });

  async function start() {
    $('#boot').hidden = false;
    $('#login').hidden = true;
    try {
      const [ops, settings] = await Promise.all([S.store.loadOps(), S.store.loadSettings()]);
      S.ops = ops;
      S.settings = settings;
    } catch (e) {
      $('#boot').textContent = e.message;
      return;
    }
    S.started = true;
    S.fc = {
      daily: Number(S.settings.dailyDeposit) || 0,
      start: null,
      years: S.settings.forecastYears || 5,
      reinvest: S.settings.reinvest !== false,
      rate: S.settings.forecastRate ?? null,
    };
    const savedAcc = U.lsGet('kk:account', 'all');
    S.account = savedAcc === 'all' || accounts().includes(savedAcc) ? savedAcc : 'all';
    $('#boot').hidden = true;
    $('#app').hidden = false;
    buildAccountFilter();
    renderBanners();
    recompute();
    route();
    window.addEventListener('hashchange', route);
    setMoexStatus();
    loadMarket();
    setInterval(() => {
      if (!document.hidden) refreshQuotes();
    }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshQuotes();
    });
  }

  function buildAccountFilter() {
    const sel = $('#accountFilter');
    const accs = accounts();
    sel.innerHTML = `<option value="all">Все счета</option>` + accs.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
    sel.value = S.account;
    sel.closest('label').hidden = accs.length < 2;
  }
  $('#accountFilter').addEventListener('change', (e) => {
    S.account = e.target.value;
    U.lsSet('kk:account', S.account);
    recompute();
    renderView();
  });

  function renderBanners() {
    const b = [];
    if (S.store.mode === 'demo')
      b.push(`<div class="banner info"><span>Это пример портфеля. Всё, что вы меняете, хранится только в этом браузере.</span><button class="btn sm" data-act="leave-demo">Выйти из примера</button></div>`);
    if (M.status.ok === false && !Object.values(S.info).some((i) => i.price != null || i.priceRub != null))
      b.push(`<div class="banner"><span>Не получилось связаться с Мосбиржей: ${esc(M.status.lastError || '')}. Стоимость показана по цене покупки. ${
        (window.KK_CONFIG || {}).moexProxyUrl ? '' : 'Если так будет постоянно, подключите запасной канал (README, шаг 5).'
      }</span><button class="btn sm" data-act="refresh-moex">Повторить</button></div>`);
    $('#banners').innerHTML = b.join('');
  }

  /* ================= данные Мосбиржи ================= */
  async function loadMarket({ force } = {}) {
    const secids = [...new Set(S.ops.filter((o) => o.secid).map((o) => o.secid))];
    S.marketLoading = true;
    setMoexStatus();
    const info = { ...S.info };
    await pool(secids, 4, async (id) => {
      try {
        const d = await M.describe(id);
        info[id] = d ? { ...(info[id] || {}), ...stripNulls(d) } : { ...(info[id] || {}), unknown: true };
      } catch (e) {
        /* нет связи — останутся данные из операций */
      }
    });
    try {
      const q = await M.quotes(secids.map((id) => info[id]).filter(Boolean), { force });
      for (const id in q) info[id] = { ...info[id], ...stripNulls(q[id]) };
    } catch (e) {
      /* см. статус */
    }
    await pool(
      secids.filter((id) => (info[id] || {}).kind === 'bond'),
      4,
      async (id) => {
        try {
          info[id] = { ...info[id], ...(await M.bondization(id)) };
        } catch (e) {}
      }
    );
    await pool(
      secids.filter((id) => ['share', 'fund'].includes((info[id] || {}).kind)),
      4,
      async (id) => {
        try {
          info[id] = { ...info[id], dividends: await M.dividends(id) };
        } catch (e) {}
      }
    );
    S.info = info;
    S.marketLoading = false;
    recompute();
    renderBanners();
    renderView({ keepFocus: true });
    setMoexStatus();
  }

  async function refreshQuotes() {
    if (S.marketLoading || !S.started) return;
    const list = Object.values(S.info).filter((i) => i.market && i.board);
    if (!list.length) return;
    try {
      const q = await M.quotes(list);
      for (const id in q) S.info[id] = { ...S.info[id], ...stripNulls(q[id]) };
      recompute();
      renderView({ keepFocus: true });
    } catch (e) {}
    setMoexStatus();
  }

  function setMoexStatus() {
    const pill = $('#moexStatus');
    const times = Object.values(S.info).map((i) => i.fetchedAt).filter(Boolean);
    const at = times.length ? Math.max(...times) : null;
    const hm = at ? new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null;
    let state = 'ok';
    let text = 'Мосбиржа' + (hm ? ' · ' + hm : '');
    let title = 'Цены Мосбиржи' + (hm ? ', обновлено в ' + hm : '') + (M.status.via === 'proxy' ? ' (через Supabase)' : '') + '. Нажмите, чтобы обновить.';
    if (S.marketLoading) {
      state = 'loading';
      text = 'Мосбиржа · обновляю';
    } else if (M.status.ok === false) {
      state = at ? 'stale' : 'error';
      text = at ? 'Мосбиржа · ' + hm : 'Мосбиржа · нет связи';
      title = 'Нет связи с Мосбиржей (' + (M.status.lastError || '') + ')' + (at ? '. Показаны цены на ' + hm : '') + '. Нажмите, чтобы повторить.';
    } else if (!at) {
      state = M.status.ok ? 'ok' : 'loading';
      text = 'Мосбиржа';
    }
    pill.dataset.state = state;
    pill.querySelector('.txt').textContent = text;
    pill.title = title;
  }
  $('#moexStatus').addEventListener('click', () => loadMarket({ force: true }));

  /* ================= навигация ================= */
  function route() {
    const v = (location.hash || '#overview').slice(1);
    const next = VIEWS.includes(v) ? v : 'overview';
    const changed = next !== S.view;
    S.view = next;
    $$('.tabs a').forEach((a) => (a.dataset.view === S.view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    $$('.view').forEach((s) => (s.hidden = s.id !== 'view-' + S.view));
    renderView();
    if (changed) window.scrollTo(0, 0);
  }
  function renderView(opts = {}) {
    if (!S.model) return;
    const host = $('#view-' + S.view);
    if (opts.keepFocus && host.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    ({ overview: renderOverview, assets: renderAssets, history: renderHistory, forecast: renderForecast, analytics: renderAnalytics })[S.view]();
  }
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => renderView({ keepFocus: true }), 150);
  });

  function emptyPortfolio(title) {
    return `<div class="card empty"><strong>${esc(title || 'Здесь пока пусто')}</strong>
      <span>Загрузите PDF-отчёты Т-Банка или внесите первую покупку. Купоны, цены и даты погашения сайт сам возьмёт с Мосбиржи.</span>
      <div class="chips"><button class="btn primary" data-act="import">${ICON.upload} Загрузить отчёты</button><button class="btn" data-act="add-op">${ICON.plus} Добавить операцию</button></div></div>`;
  }

  /* ================= ОБЗОР ================= */
  function renderOverview() {
    const host = $('#view-overview');
    const m = S.model;
    const t = m.totals;
    const today = m.today;
    const y = U.year(today);
    if (!m.positions.length) {
      host.innerHTML = `<div class="view-head"><div><h1>Обзор</h1></div></div>` + emptyPortfolio('Добавьте свои бумаги');
      return;
    }
    const thisYear = m.received.filter((f) => E.isIncome(f.type) && U.year(f.date) === y);
    const yGross = U.sum(thisYear, (f) => f.amount);
    const yTax = U.sum(thisYear, (f) => f.tax);
    const restYear = m.expected.filter((f) => E.isIncome(f.type) && f.date > today && U.year(f.date) === y);
    const next = m.expected.find((f) => E.isIncome(f.type) && f.date > today);
    const nextSameDay = next ? m.expected.filter((f) => E.isIncome(f.type) && f.date === next.date) : [];
    const nextNet = U.sum(nextSameDay, (f) => f.net);
    const nextGross = U.sum(nextSameDay, (f) => f.amount);
    const days = next ? U.daysBetween(today, next.date) : null;
    const ct = Number(S.settings.couponTax ?? 30);
    const unrealPct = t.cost > 0 ? (t.unreal / t.cost) * 100 : null;
    const nextD = next ? U.parseISO(next.date) : null;

    host.innerHTML = `
      <div class="view-head"><div><h1>Обзор</h1><div class="sub">${U.dateHuman(today, true)}${S.account !== 'all' ? ' · счёт «' + esc(S.account) + '»' : ''}</div></div>
        <div class="chips"><button class="btn" data-act="import">${ICON.upload} Загрузить отчёты</button><button class="btn primary" data-act="add-op">${ICON.plus} Операция</button></div></div>
      <div class="tiles">
        <article class="tile hero">
          <span class="label">Пассивный доход за ${y} год после налога</span>
          <span class="value">${U.rub(yGross - yTax)}</span>
          <span class="sub">до налога ${U.rub(yGross)} · налог ${U.rub(yTax)}${restYear.length ? `<br>до конца года ожидается ещё ${U.rub(U.sum(restYear, (f) => f.net))}` : ''}</span>
        </article>
        <article class="tile">
          <span class="label">Ожидается за 12 месяцев</span>
          <span class="value">${U.rub(t.expected12Net)}</span>
          <span class="sub">после налога · ≈ ${U.rub(t.expected12Net / 12)} в месяц<br>до налога ${U.rub(t.expected12Gross)}</span>
        </article>
        <article class="tile">
          <span class="label">Стоимость портфеля</span>
          <span class="value">${U.rub(t.mv)}</span>
          <span class="sub">куплено за ${U.rub(t.cost)}${t.cost ? ` · <span class="${sgn(t.unreal)}">${U.rub(t.unreal, 0, { sign: true })} (${U.pct(unrealPct, 1, { sign: true })})</span>` : ''}${t.accrued ? `<br>плюс НКД ${U.rub(t.accrued)}` : ''}${t.missingQuotes ? `<br><span class="badge warn">${t.missingQuotes} без цены</span>` : ''}</span>
        </article>
        ${
          next
            ? `<article class="coupon" aria-label="Ближайшая выплата">
          <div class="stub"><div><div class="day">${nextD.getDate()}</div><div class="mon">${U.MONTHS_SHORT[nextD.getMonth()]}</div></div></div>
          <div class="body"><span class="label">Ближайшая выплата · ${days === 1 ? 'завтра' : 'через ' + days + ' ' + U.plural(days, ['день', 'дня', 'дней'])}</span>
            <span class="value">${amt(nextNet)}</span>
            <span class="sub">${nextSameDay.length > 1 ? nextSameDay.length + ' бумаги' : esc(next.name) + ' · ' + E.OP[next.type].toLowerCase()} · до налога ${amt(nextGross)}</span></div>
        </article>`
            : `<article class="tile"><span class="label">Ближайшая выплата</span><span class="value">—</span><span class="sub">Купонов по расписанию не видно</span></article>`
        }
      </div>
      <section class="card" id="monthsCard"></section>
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h2>Ближайшие выплаты</h2><a href="#analytics" class="sm">Доход по годам →</a></div>
          ${upcomingList(m)}
        </section>
        <section class="card">
          <div class="card-head"><h2>За всё время</h2></div>
          <dl class="kv">
            <dt>Получено купонов и дивидендов</dt><dd>${U.rub(t.incomeGross)}</dd>
            <dt>Налог</dt><dd>−${U.rub(t.incomeTax)}</dd>
            <dt><b>После налога</b></dt><dd><b>${U.rub(t.incomeNet)}</b></dd>
            <dt>Уплачено НКД при покупках</dt><dd>−${U.rub(t.nkdPaid)}</dd>
            ${t.realized ? `<dt>Результат продаж и погашений</dt><dd class="${sgn(t.realized)}">${U.rub(t.realized, 0, { sign: true })}</dd>` : ''}
            ${t.deposits ? `<dt>Внесено на счёт (по отчётам)</dt><dd>${U.rub(t.deposits)}</dd>` : ''}
          </dl>
        </section>
      </div>`;
    renderMonths();
  }

  function upcomingList(m) {
    const list = m.expected.filter((f) => E.isIncome(f.type) && f.date > m.today).slice(0, 7);
    if (!list.length) return `<p class="muted sm">Будущих купонов и дивидендов пока не видно.</p>`;
    return `<ul class="pay-list">${list
      .map(
        (f) => `<li><span class="when">${U.date(f.date).slice(0, 5)}</span>
        <span class="what"><b>${dot(f.kind)} ${esc(f.name)}</b><small>${E.OP[f.type]} · ${U.num(f.qty)} шт × ${U.rubAuto(f.perUnit)}${f.estimate ? ' · оценка' : ''}</small></span>
        <span class="amt">${amt(f.net)}<small>до налога ${amt(f.amount)}</small></span></li>`
      )
      .join('')}</ul>`;
  }

  function renderMonths() {
    const card = $('#monthsCard');
    if (!card) return;
    const m = S.model;
    const today = m.today;
    const cy = U.year(today);
    const opYears = S.ops.map((o) => U.year(o.op_date)).filter(Boolean);
    const minY = Math.min(cy, ...opYears);
    const maxY = cy + 1;
    S.year = Math.max(minY, Math.min(maxY, S.year));
    const months = E.monthly(m, S.year);
    const k = S.net ? 'Net' : '';
    const series = [
      ...E.KINDS.map((kind) => ({ label: E.KIND[kind].label, color: KIND_COLOR[kind], values: months.map((x) => x['received' + k][kind]) })),
      ...E.KINDS.map((kind) => ({ label: E.KIND[kind].label + ' — ожидается', color: KIND_COLOR[kind], opacity: 0.35, values: months.map((x) => x['expected' + k][kind]) })),
    ];
    const kindsPresent = E.KINDS.filter((kind) => months.some((x) => x.received[kind] || x.expected[kind]));
    const total = (x) => U.sum(E.KINDS, (kind) => x['received' + k][kind] + x['expected' + k][kind]);
    const yearTotal = U.sum(months, total);
    const isFuture = (i) => S.year > cy || (S.year === cy && i > U.month0(today));
    if (S.monthYear !== S.year) {
      const withData = months.map((x, i) => (total(x) > 0 ? i : -1)).filter((i) => i >= 0);
      if (S.year === cy) S.month = U.month0(today);
      else S.month = withData.length ? withData[S.year < cy ? withData.length - 1 : 0] : 0;
    }
    S.monthYear = S.year;

    card.innerHTML = `
      <div class="card-head"><h2>Доход по месяцам</h2>
        <div class="tools">
          <div class="year-switch"><button class="icon-btn" data-act="year" data-d="-1" aria-label="Предыдущий год" ${S.year <= minY ? 'disabled' : ''}>${ICON.left}</button><strong>${S.year}</strong><button class="icon-btn" data-act="year" data-d="1" aria-label="Следующий год" ${S.year >= maxY ? 'disabled' : ''}>${ICON.right}</button></div>
          <div class="seg" role="group" aria-label="Налог"><button data-act="net" data-v="0" aria-pressed="${!S.net}">До налога</button><button data-act="net" data-v="1" aria-pressed="${S.net}">После налога</button></div>
        </div></div>
      <div class="legend">${(kindsPresent.length ? kindsPresent : ['bond']).map((kind) => `<span>${dot(kind)} ${E.KIND[kind].label}</span>`).join('')}<span class="faded">${dot('bond')} светлее — ожидается</span><span class="muted">За ${S.year}: <b class="num" style="color:var(--ink)">${U.rub(yearTotal)}</b></span></div>
      <div class="months-layout"><div class="chart" id="monthChart"></div><div class="month-detail" id="monthDetail"></div></div>`;

    C.bars($('#monthChart'), {
      labels: U.MONTHS_SHORT,
      series,
      height: 260,
      selected: S.month,
      mutedLabels: months.map((_, i) => isFuture(i)),
      ariaLabel: `Пассивный доход по месяцам за ${S.year}`,
      valueLabels: (i, v) => (i === S.month && v > 0 ? U.compact(v) : null),
      aria: (i) => `${U.MONTHS[i]}: ${U.rub(total(months[i]))}`,
      tooltip: (i) => {
        const x = months[i];
        const rows = [];
        E.KINDS.forEach((kind) => x['received' + k][kind] && rows.push(`<div class="row"><span>${dot(kind)}${E.KIND[kind].label}</span><span>${amt(x['received' + k][kind])}</span></div>`));
        const ex = U.sum(E.KINDS, (kind) => x['expected' + k][kind]);
        if (ex) rows.push(`<div class="row"><span>ожидается</span><span>${amt(ex)}</span></div>`);
        return `<b>${U.monthTitle(S.year, i)}</b>${rows.join('') || '<span class="muted">выплат нет</span>'}`;
      },
      onSelect: (i) => {
        S.month = i;
        renderMonths();
        const d = $('#monthDetail');
        if (d && window.innerWidth < 980) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
    });
    renderMonthDetail(months[S.month]);
  }

  function renderMonthDetail(x) {
    const host = $('#monthDetail');
    const gross = U.sum(x.items, (f) => f.amount);
    const net = U.sum(x.items, (f) => f.net);
    const byAsset = new Map();
    for (const f of x.items) {
      const key = f.secid + '|' + f.type + '|' + f.date;
      if (!byAsset.has(key)) byAsset.set(key, { ...f });
      else {
        const a = byAsset.get(key);
        a.amount += f.amount;
        a.net += f.net;
      }
    }
    const items = [...byAsset.values()];
    host.innerHTML = `<h3>${U.monthTitle(S.year, x.m0)}</h3>
      <div class="total"><span class="muted sm">${S.net ? 'после налога' : 'до налога'}</span><strong class="num">${U.rub(S.net ? net : gross)}</strong></div>
      ${
        items.length
          ? `<ul class="pay-list">${items
              .map(
                (f) => `<li><span class="when">${U.date(f.date).slice(0, 5)}</span><span class="what"><b>${dot(f.kind)} ${esc(f.name)}</b><small>${E.OP[f.type]} · ${statusText(f)}</small></span>
            <span class="amt">${amt(S.net ? f.net : f.amount)}<small>${S.net ? 'до налога ' + amt(f.amount) : 'налог ' + amt(f.tax)}</small></span></li>`
              )
              .join('')}</ul>`
          : `<p class="muted sm">В этом месяце выплат нет.</p>`
      }`;
  }

  /* ================= АКТИВЫ ================= */
  const ASSET_COLS = [
    { key: 'name', title: 'Актив', val: (p) => p.name.toLowerCase(), dir: 1 },
    { key: 'qty', title: 'Кол-во', val: (p) => p.qty },
    { key: 'price', title: 'Цена', val: (p) => p.pricePct ?? p.priceRub ?? -1 },
    { key: 'mv', title: 'Стоимость', val: (p) => p.mv },
    { key: 'coupon', title: 'Купон / див.', val: (p) => p.couponPct ?? p.divYield ?? -1 },
    { key: 'ytm', title: 'Доходность', val: (p) => p.ytm ?? p.divYield ?? -1 },
    { key: 'mat', title: 'До погашения', val: (p) => (p.daysToMat == null ? 1e9 : p.daysToMat), dir: 1 },
    { key: 'income', title: 'Получено выплат', val: (p) => p.incomeGross },
    { key: 'result', title: 'Прибыль', val: (p) => p.unreal ?? 0 },
  ];

  function renderAssets() {
    const host = $('#view-assets');
    const m = S.model;
    if (!m.positions.length) {
      host.innerHTML = `<div class="view-head"><div><h1>Активы</h1></div></div>` + emptyPortfolio();
      return;
    }
    const A = S.assets;
    const base = m.positions.filter((p) => A.closed || !p.closed);
    const counts = { all: base.length };
    E.KINDS.forEach((k) => (counts[k] = base.filter((p) => p.kind === k).length));
    const q = A.q.trim().toLowerCase();
    let rows = base.filter((p) => (A.kind === 'all' || p.kind === A.kind) && (!q || (p.name + ' ' + p.secid + ' ' + (p.isin || '') + ' ' + (p.fullName || '')).toLowerCase().includes(q)));
    const col = ASSET_COLS.find((c) => c.key === A.sort) || ASSET_COLS[3];
    rows = rows.slice().sort((a, b) => {
      const va = col.val(a);
      const vb = col.val(b);
      return (va > vb ? 1 : va < vb ? -1 : 0) * A.dir;
    });
    const closedCount = m.positions.filter((p) => p.closed).length;
    const totMv = U.sum(rows, (p) => p.mv);
    const totInc = U.sum(rows, (p) => p.incomeGross);
    const totUnreal = U.sum(rows, (p) => p.unreal ?? 0);
    const totCost = U.sum(rows.filter((p) => !p.closed), (p) => p.cost);

    host.innerHTML = `
      <div class="view-head"><div><h1>Активы</h1><div class="sub">${counts.all} ${U.plural(counts.all, ['бумага', 'бумаги', 'бумаг'])} · ${U.rub(U.sum(base, (p) => p.mv))}</div></div>
        <button class="btn primary" data-act="add-op">${ICON.plus} Покупка</button></div>
      <div class="toolbar">
        <div class="chips" role="group" aria-label="Вид актива">
          <button class="chip" data-act="kind" data-v="all" aria-pressed="${A.kind === 'all'}">Все <span class="count">${counts.all}</span></button>
          ${E.KINDS.map((k) => `<button class="chip" data-act="kind" data-v="${k}" aria-pressed="${A.kind === k}" ${counts[k] ? '' : 'disabled'}>${dot(k)} ${E.KIND[k].label} <span class="count">${counts[k]}</span></button>`).join('')}
        </div>
        <input class="input grow" id="assetSearch" type="search" placeholder="Поиск по названию, тикеру или ISIN" value="${esc(A.q)}" aria-label="Поиск">
        ${closedCount ? `<label class="check"><input type="checkbox" id="showClosed" ${A.closed ? 'checked' : ''}> Проданные и погашенные (${closedCount})</label>` : ''}
      </div>
      <div class="table-wrap"><table class="data" id="assetTable">
        <thead><tr>${ASSET_COLS.map((c) => `<th data-sort="${c.key}" ${A.sort === c.key ? `aria-sort="${A.dir > 0 ? 'ascending' : 'descending'}"` : ''} tabindex="0">${c.title}${A.sort === c.key ? `<span class="arr">${A.dir > 0 ? '↑' : '↓'}</span>` : ''}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(assetRow).join('') || `<tr><td colspan="9" class="muted" style="text-align:left">Ничего не нашлось</td></tr>`}</tbody>
        <tfoot><tr><td>Итого</td><td></td><td></td><td>${U.rub(totMv)}</td><td></td><td></td><td></td><td>${U.rub(totInc)}<small>после налога ${U.rub(U.sum(rows, (p) => p.incomeNet))}</small></td><td class="${sgn(totUnreal)}">${U.rub(totUnreal, 0, { sign: true })}<small>${totCost ? U.pct((totUnreal / totCost) * 100, 1, { sign: true }) : ''}</small></td></tr></tfoot>
      </table></div>
      <p class="note">Цены и доходность к погашению — с Мосбиржи, ${M.status.ok === false ? 'последние сохранённые' : 'обновляются раз в минуту'}. Цена облигации — в процентах от номинала. «Прибыль» — изменение цены относительно средней цены покупки с комиссией; купоны в неё не входят и показаны отдельно.</p>`;

    const s = $('#assetSearch');
    s.addEventListener('input', U.debounce(() => {
      A.q = s.value;
      renderAssets();
      const n = $('#assetSearch');
      n.focus();
      n.setSelectionRange(n.value.length, n.value.length);
    }, 200));
    const cb = $('#showClosed');
    if (cb) cb.addEventListener('change', () => ((A.closed = cb.checked), renderAssets()));
  }

  function assetRow(p) {
    const ch = p.change != null && p.change !== 0 ? `<small class="${sgn(p.change)}">${U.pct(p.change, 2, { sign: true })} за день</small>` : '';
    const price =
      p.kind === 'bond'
        ? p.pricePct != null
          ? `${U.num(p.pricePct, 2, 2)}&nbsp;%<small>${U.rub(p.priceRub, 2)}</small>${ch}`
          : '<span class="muted">—</span>'
        : p.priceRub != null
        ? `${U.rub(p.priceRub, 2)}${ch}`
        : '<span class="muted">—</span>';
    const coupon =
      p.kind === 'bond'
        ? p.couponPct != null
          ? `${U.pct(p.couponPct, 2)}${p.nextCoupon ? `<small>${U.dateHuman(p.nextCoupon.date)} · ${U.rubAuto(p.nextCoupon.perUnit)}</small>` : ''}`
          : '—'
        : p.divYield != null
        ? `${U.pct(p.divYield, 1)}<small>див. за 12 мес</small>`
        : '<span class="muted">—</span>';
    const ytm = p.kind === 'bond' ? (p.ytm != null ? `${U.pct(p.ytm, 2)}<small>к погашению</small>` : '—') : '<span class="muted">—</span>';
    const mat = p.kind === 'bond' && p.matDate ? `${U.term(p.daysToMat)}<small>${U.date(p.matDate)}</small>` : '<span class="muted">—</span>';
    const badges = [];
    if (p.hasAmort) badges.push('<span class="badge accent">амортизация</span>');
    if (p.offerDate) badges.push(`<span class="badge warn">оферта ${U.date(p.offerDate)}</span>`);
    if (p.closed) badges.push('<span class="badge">закрыта</span>');
    else if (!p.hasQuote) badges.push('<span class="badge warn">нет цены</span>');
    return `<tr data-secid="${esc(p.secid)}" class="${p.closed ? 'closed' : ''}" tabindex="0">
      <td><div class="asset-name"><b>${dot(p.kind)}<span>${esc(p.name)}</span></b><span class="meta"><span class="mono">${esc(p.secid)}</span>${badges.join('')}</span></div></td>
      <td>${U.num(p.qty)}${p.qty ? `<small>ср. ${U.rub(p.avg, 2)}</small>` : ''}</td>
      <td>${price}</td>
      <td>${p.closed ? '—' : U.rub(p.mv)}${p.accrued ? `<small>+ НКД ${U.rub(p.accrued)}</small>` : ''}</td>
      <td>${coupon}</td>
      <td>${ytm}</td>
      <td>${mat}</td>
      <td>${p.incomeGross ? U.rub(p.incomeGross) : '—'}${p.incomeGross ? `<small>после налога ${U.rub(p.incomeNet)}</small>` : ''}</td>
      <td class="${sgn(p.closed ? p.realized : p.unreal)}">${
        p.closed ? U.rub(p.realized, 0, { sign: true }) + '<small>продажа/погашение</small>' : p.unreal != null ? U.rub(p.unreal, 0, { sign: true }) + `<small>${U.pct(p.unrealPct, 1, { sign: true })}</small>` : '—'
      }</td></tr>`;
  }

  /* ---------- карточка бумаги ---------- */
  function openAsset(secid) {
    const p = S.model.positions.find((x) => x.secid === secid);
    if (!p) return;
    const d = $('#drawer');
    const pastPays = p.flows.filter((f) => E.isIncome(f.type) || f.type === 'amortization' || f.type === 'redemption').slice().reverse();
    const fut = p.future.slice(0, 6);
    const metrics = [
      ['Количество', U.num(p.qty) + ' шт'],
      ['Средняя цена', p.qty ? U.rub(p.avg, 2) : '—'],
      ['Стоимость сейчас', p.closed ? '—' : U.rub(p.mv)],
      ['Изменение цены', p.unreal != null ? `<span class="${sgn(p.unreal)}">${U.rub(p.unreal, 0, { sign: true })}</span>` : '—'],
      ['Выплаты до налога', U.rub(p.incomeGross)],
      ['Выплаты после налога', U.rub(p.incomeNet)],
    ];
    if (p.kind === 'bond') {
      metrics.push(
        ['Ставка купона', U.pct(p.couponPct)],
        ['Доходность к погашению', U.pct(p.ytm)],
        ['Номинал сейчас', U.rub(p.faceNow, 2)],
        ['Амортизация', p.hasAmort ? 'есть' : p.hasAmort === false ? 'нет' : '—'],
        ['Погашение', p.matDate ? `${U.date(p.matDate)} · ${U.term(p.daysToMat)}` : '—'],
        ['НКД уплачено', U.rub(p.nkdPaid, 2)]
      );
      if (p.principalBack) metrics.push(['Вернулось номинала', U.rub(p.principalBack)]);
      if (p.offerDate) metrics.push(['Оферта', U.date(p.offerDate)]);
    } else {
      metrics.push(['Дивиденды за 12 мес', p.divYield != null ? U.pct(p.divYield, 1) + ' к цене' : '—'], ['Комиссии', U.rub(p.fees, 2)]);
    }
    if (p.realized) metrics.push(['Продажи и погашения', `<span class="${sgn(p.realized)}">${U.rub(p.realized, 0, { sign: true })}</span>`]);
    metrics.push(['Итог с выплатами', `<span class="${sgn(p.result)}">${U.rub(p.result, 0, { sign: true })}</span>`]);

    d.innerHTML = `<div class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
      <div class="head"><div><div class="sm muted">${dot(p.kind)} ${E.KIND[p.kind].one}${p.accounts.length ? ' · ' + p.accounts.map(esc).join(', ') : ''}</div>
        <h2 id="drawerTitle">${esc(p.name)}</h2><div class="sm muted"><span class="mono">${esc(p.secid)}</span>${p.isin && p.isin !== p.secid ? ' · <span class="mono">' + esc(p.isin) + '</span>' : ''}${p.fullName && p.fullName !== p.name ? '<br>' + esc(p.fullName) : ''}</div></div>
        <button class="icon-btn" data-act="close-drawer" aria-label="Закрыть">${ICON.close}</button></div>
      <div class="chips"><button class="btn sm primary" data-act="add-op" data-secid="${esc(p.secid)}" data-type="buy">${ICON.plus} Покупка</button><button class="btn sm" data-act="add-op" data-secid="${esc(p.secid)}" data-type="sell">Продажа</button><a class="btn sm ghost" href="https://www.moex.com/ru/issue.aspx?code=${encodeURIComponent(p.secid)}" target="_blank" rel="noopener">На сайте Мосбиржи ↗</a></div>
      <div class="metrics">${metrics.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      ${fut.length ? `<section><h3 class="label" style="margin-bottom:6px">Ожидается</h3><ul class="pay-list">${fut.map((f) => payItem(f)).join('')}</ul></section>` : ''}
      <section><h3 class="label" style="margin-bottom:6px">Получено</h3>${pastPays.length ? `<ul class="pay-list">${pastPays.map((f) => payItem(f)).join('')}</ul>` : '<p class="muted sm">Выплат пока не было.</p>'}</section>
      <section><h3 class="label" style="margin-bottom:6px">Операции</h3><ul class="pay-list">${p.ops
        .slice()
        .reverse()
        .map((o) => `<li><span class="when">${U.date(o.op_date).slice(0, 5)}<br>${o.op_date.slice(0, 4)}</span><span class="what"><b>${E.OP[o.op_type]}</b><small>${opDetails(o)}</small></span><span class="amt">${amt(opTotal(o))}</span></li>`)
        .join('')}</ul></section>
    </div>`;
    d.hidden = false;
    document.body.style.overflow = 'hidden';
    d.querySelector('.icon-btn').focus();
  }
  function payItem(f) {
    return `<li><span class="when">${U.date(f.date).slice(0, 5)}<br>${f.date.slice(0, 4)}</span><span class="what"><b>${E.OP[f.type]}</b><small>${f.qty ? U.num(f.qty) + ' шт × ' + U.rubAuto(f.perUnit ?? f.amount / f.qty) + ' · ' : ''}${statusText(f)}</small></span>
      <span class="amt">${amt(E.isIncome(f.type) ? f.net : f.amount)}<small>${E.isIncome(f.type) ? 'до налога ' + amt(f.amount) : 'возврат номинала'}</small></span></li>`;
  }
  function closeDrawer() {
    const d = $('#drawer');
    d.hidden = true;
    d.innerHTML = '';
    document.body.style.overflow = '';
  }
  $('#drawer').addEventListener('click', (e) => {
    if (e.target.id === 'drawer') closeDrawer();
  });

  /* ================= ОПЕРАЦИИ ================= */
  function opDetails(o) {
    const parts = [];
    if (o.op_type === 'buy' || o.op_type === 'sell') {
      parts.push(`${U.num(o.quantity)} шт × ${o.price_pct != null ? U.num(o.price_pct, 2) + '%' : U.rub(o.price, 2)}`);
      if (Number(o.accrued_interest)) parts.push('НКД ' + U.rub(o.accrued_interest, 2));
      if (Number(o.fee)) parts.push('комиссия ' + U.rub(o.fee, 2));
    } else {
      if (o.quantity) parts.push(U.num(o.quantity) + ' шт');
      if (Number(o.tax)) parts.push('налог ' + U.rub(o.tax, 2));
    }
    if (o.note && !(o.op_type === 'buy' || o.op_type === 'sell')) parts.push(esc(String(o.note).slice(0, 70)));
    return parts.join(' · ');
  }
  function opTotal(o) {
    const n = (v) => Number(v) || 0;
    if (o.op_type === 'buy') return n(o.quantity) * n(o.price) + n(o.accrued_interest) + n(o.fee);
    if (o.op_type === 'sell') return n(o.quantity) * n(o.price) + n(o.accrued_interest) - n(o.fee);
    return n(o.amount);
  }

  function renderHistory() {
    const host = $('#view-history');
    const H = S.hist;
    const all = opsForAccount();
    const imported = all.filter((o) => o.source === 'import');
    const lastImport = imported.length ? imported.reduce((a, o) => (o.op_date > a ? o.op_date : a), '') : null;
    const manualAfter = lastImport ? all.filter((o) => o.source !== 'import' && o.op_date > lastImport) : all.filter((o) => o.source !== 'import');
    const q = H.q.trim().toLowerCase();
    const list = all
      .filter((o) => H.type === 'all' || (H.type === 'trades' ? o.op_type === 'buy' || o.op_type === 'sell' : H.type === 'income' ? ['coupon', 'dividend', 'amortization', 'redemption'].includes(o.op_type) : ['deposit', 'withdrawal', 'tax', 'fee'].includes(o.op_type)))
      .filter((o) => H.src === 'all' || (H.src === 'import' ? o.source === 'import' : o.source !== 'import'))
      .filter((o) => !q || [o.secid, o.name, o.isin, o.note, (S.info[o.secid] || {}).shortname, E.OP[o.op_type]].join(' ').toLowerCase().includes(q))
      .slice()
      .sort((a, b) => (a.op_date < b.op_date ? 1 : a.op_date > b.op_date ? -1 : String(b.created_at).localeCompare(String(a.created_at))));
    const groups = [...U.groupBy(list, (o) => o.op_date.slice(0, 7)).entries()];
    const shown = groups.slice(0, H.limit);

    host.innerHTML = `
      <div class="view-head"><div><h1>Операции</h1><div class="sub">${all.length} ${U.plural(all.length, ['операция', 'операции', 'операций'])}${S.account !== 'all' ? ' по счёту «' + esc(S.account) + '»' : ''}</div></div>
        <div class="chips"><button class="btn" data-act="export">${ICON.download} Экспорт CSV</button><button class="btn" data-act="import">${ICON.upload} Загрузить отчёты</button><button class="btn primary" data-act="add-op">${ICON.plus} Добавить</button></div></div>
      <div class="banner info"><span>${
        lastImport
          ? `Последняя операция из отчётов — <b>${U.dateHuman(lastImport, true)}</b>. ${manualAfter.length ? `После неё вручную внесено ${manualAfter.length} ${U.plural(manualAfter.length, ['операция', 'операции', 'операций'])}. Когда загрузите отчёт за этот месяц, они заменятся записями из отчёта.` : 'После неё вручную ничего не вносилось.'}`
          : 'Отчёты ещё не загружались. Операции, внесённые вручную, подписаны «вручную».'
      }</span></div>
      ${reportsPanel()}
      <div class="toolbar">
        <div class="chips" role="group" aria-label="Тип">
          ${[
            ['all', 'Все'],
            ['trades', 'Сделки'],
            ['income', 'Выплаты'],
            ['cash', 'Деньги и налоги'],
          ]
            .map(([v, t]) => `<button class="chip" data-act="hist-type" data-v="${v}" aria-pressed="${H.type === v}">${t}</button>`)
            .join('')}
        </div>
        <div class="seg" role="group" aria-label="Источник">${[
          ['all', 'Все'],
          ['import', 'Из отчётов'],
          ['manual', 'Вручную'],
        ]
          .map(([v, t]) => `<button data-act="hist-src" data-v="${v}" aria-pressed="${H.src === v}">${t}</button>`)
          .join('')}</div>
        <input class="input grow" id="histSearch" type="search" placeholder="Бумага, тикер или примечание" value="${esc(H.q)}" aria-label="Поиск по операциям">
      </div>
      ${
        list.length
          ? `<div class="ops">${shown
              .map(
                ([key, ops]) => `<section class="ops-month"><h3><span>${U.monthTitle(U.year(key), U.month0(key + '-01'))}</span><span class="num">${ops.length}</span></h3><ul class="ops-list">${monthRows(key, ops, H.type === 'all' && !q)}</ul></section>`
              )
              .join('')}${groups.length > H.limit ? `<button class="btn" data-act="hist-more">Показать ещё</button>` : ''}</div>`
          : all.length
          ? `<div class="card empty"><strong>Ничего не нашлось</strong><span>Измените фильтры или поиск.</span></div>`
          : emptyPortfolio('Операций пока нет')
      }`;
    const s = $('#histSearch');
    s.addEventListener('input', U.debounce(() => {
      H.q = s.value;
      renderHistory();
      const n = $('#histSearch');
      n.focus();
      n.setSelectionRange(n.value.length, n.value.length);
    }, 200));
  }

  /* пополнения по 100 ₽ каждый день: в общем списке сворачиваются в одну строку за месяц */
  function monthRows(key, ops, collapse) {
    const deps = ops.filter((o) => o.op_type === 'deposit');
    if (!collapse || deps.length < 3) return ops.map(opRow).join('');
    const open = S.hist.open.includes(key);
    const sum = U.sum(deps, (o) => o.amount);
    const dates = deps.map((o) => o.op_date).sort();
    const accs = [...new Set(deps.map((o) => o.account).filter(Boolean))];
    const summary = `<li class="op-row dep-sum"><span class="d">${U.date(dates[dates.length - 1]).slice(0, 5)}</span>
      <div class="main"><div class="t"><span class="type-badge deposit">Пополнения</span><b>${deps.length} ${U.plural(deps.length, ['пополнение', 'пополнения', 'пополнений'])}</b></div>
        <small>с ${U.dateHuman(dates[0])} по ${U.dateHuman(dates[dates.length - 1])}${S.account === 'all' && accs.length ? ' · ' + accs.map(esc).join(', ') : ''}</small></div>
      <div class="sum">+${amt(sum)}</div>
      <div class="acts"><button class="btn sm ghost" data-act="dep-toggle" data-v="${key}" aria-expanded="${open}">${open ? 'Свернуть' : 'Показать'}</button></div></li>`;
    let placed = false;
    return ops
      .map((o) => {
        if (o.op_type !== 'deposit') return opRow(o);
        const head = placed ? '' : ((placed = true), summary);
        return head + (open ? opRow(o) : '');
      })
      .join('');
  }

  function opRow(o) {
    const inf = S.info[o.secid] || {};
    const name = o.secid ? inf.shortname || o.name || o.secid : o.account || 'Брокерский счёт';
    const kind = inf.kind || o.asset_type;
    const confirming = S.hist.confirm === o.id;
    return `<li class="op-row" data-id="${esc(o.id)}"><span class="d">${U.date(o.op_date).slice(0, 5)}</span>
      <div class="main"><div class="t"><span class="type-badge ${esc(o.op_type)}">${E.OP[o.op_type] || o.op_type}</span><b>${o.secid ? dot(kind) + ' ' : ''}${esc(name)}</b>${o.secid ? `<span class="mono muted xs">${esc(o.secid)}</span>` : ''}</div>
        <small>${opDetails(o) || '&nbsp;'}${S.account === 'all' && o.account && o.secid ? ' · ' + esc(o.account) : ''} · <span class="src">${o.source === 'import' ? 'из отчёта' : 'вручную'}</span></small></div>
      <div class="sum">${o.op_type === 'buy' || o.op_type === 'withdrawal' || o.op_type === 'tax' || o.op_type === 'fee' ? '−' : '+'}${amt(opTotal(o))}</div>
      <div class="acts">${
        confirming
          ? `<span class="confirm">Удалить? <button class="btn sm danger" data-act="del-yes" data-id="${esc(o.id)}">Да</button><button class="btn sm" data-act="del-no">Нет</button></span>`
          : `<button class="icon-btn" data-act="edit-op" data-id="${esc(o.id)}" aria-label="Изменить">${ICON.edit}</button><button class="icon-btn" data-act="del-op" data-id="${esc(o.id)}" aria-label="Удалить">${ICON.trash}</button>`
      }</div></li>`;
  }

  /* ---------- форма операции ---------- */
  const TRADE = ['buy', 'sell'];
  const PAY = ['coupon', 'dividend', 'amortization', 'redemption'];
  const CASH = ['deposit', 'withdrawal'];
  let F = null;

  function openOpDialog({ op, type, secid } = {}) {
    closeDrawer();
    const inf = secid ? S.info[secid] || {} : {};
    F = op
      ? {
          id: op.id,
          type: op.op_type,
          secid: op.secid || '',
          query: op.secid ? (S.info[op.secid] || {}).shortname || op.name || op.secid : '',
          name: op.name || '',
          kind: (S.info[op.secid] || {}).kind || op.asset_type || 'bond',
          account: op.account || accounts()[0] || '',
          date: op.op_date,
          qty: op.quantity ?? '',
          priceMode: op.price_pct != null ? 'pct' : 'rub',
          price: op.price_pct != null ? op.price_pct : op.price ?? '',
          nkd: op.accrued_interest ?? '',
          fee: op.fee ?? '',
          amount: op.amount ?? '',
          tax: op.tax ?? '',
          note: op.note || '',
          hasAmort: op.has_amortization ?? null,
          source: op.source,
        }
      : {
          type: type || 'buy',
          secid: secid || '',
          query: secid ? inf.shortname || secid : '',
          name: inf.shortname || '',
          kind: inf.kind || 'bond',
          account: (secid && S.ops.find((o) => o.secid === secid)?.account) || (S.account !== 'all' ? S.account : (inf.kind && inf.kind !== 'bond' ? accounts().find((a) => /акци/i.test(a)) : accounts().find((a) => /облиг/i.test(a))) || accounts()[0] || ''),
          date: TODAY(),
          qty: '',
          priceMode: (inf.kind || 'bond') === 'bond' ? 'pct' : 'rub',
          price: '',
          nkd: '',
          fee: '',
          amount: '',
          tax: '',
          note: '',
          hasAmort: null,
        };
    renderOpDialog();
    $('#dlgOp').showModal();
    setTimeout(() => {
      const f = $('#dlgOp [data-autofocus]');
      if (f) f.focus();
    }, 30);
  }

  function faceAt(date) {
    const inf = S.info[F.secid] || {};
    return E.faceOn(inf, date || TODAY()) || inf.faceValue || inf.initialFace || 1000;
  }

  function renderOpDialog() {
    const dlg = $('#dlgOp');
    const t = F.type;
    const isTrade = TRADE.includes(t);
    const isPay = PAY.includes(t);
    const isCash = CASH.includes(t);
    const bond = F.kind === 'bond';
    const accs = accounts();
    const inf = S.info[F.secid] || {};
    const schedKnown = inf.amorts != null;
    const types = [...TRADE, ...PAY, ...CASH];
    dlg.innerHTML = `<form class="dlg" id="opForm" novalidate>
      <div class="dlg-head"><h2 id="dlgOpTitle">${F.id ? 'Изменить операцию' : 'Новая операция'}</h2><button type="button" class="icon-btn" data-act="close-dlg" aria-label="Закрыть">${ICON.close}</button></div>
      <div class="dlg-body">
        <div class="type-picker" role="group" aria-label="Тип операции">${types.map((x) => `<button type="button" class="chip" data-act="op-type" data-v="${x}" aria-pressed="${t === x}">${E.OP[x]}</button>`).join('')}</div>
        <div class="form-grid">
          ${
            !isCash
              ? `<div class="field full suggest"><span>Бумага</span>
            <input class="input" id="fSec" autocomplete="off" placeholder="Тикер, ISIN или название: ОФЗ 26238, SBER…" value="${esc(F.query)}" ${F.id ? '' : 'data-autofocus'} aria-autocomplete="list" aria-controls="secList">
            <ul class="suggest-list" id="secList" role="listbox" hidden></ul>
            <span class="hint" id="secHint">${F.secid ? `${dot(F.kind)} ${esc(E.KIND[F.kind].one)} · <span class="mono">${esc(F.secid)}</span>${inf.matDate ? ' · погашение ' + U.date(inf.matDate) : ''}${inf.hasAmortization ? ' · с амортизацией' : ''}` : 'Начните вводить — подскажу бумаги с Мосбиржи'}</span></div>`
              : ''
          }
          <label class="field"><span>Дата</span><input class="input" type="date" id="fDate" value="${esc(F.date)}" max="${U.addDays(TODAY(), 7)}" required ${isCash && !F.id ? 'data-autofocus' : ''}></label>
          <label class="field"><span>Счёт</span><select class="input" id="fAcc">${accs.map((a) => `<option ${a === F.account ? 'selected' : ''}>${esc(a)}</option>`).join('')}<option value="" ${!F.account ? 'selected' : ''}>без счёта</option></select></label>
          ${
            !isCash && !F.secid
              ? `<label class="field"><span>Вид актива</span><select class="input" id="fKind">${E.KINDS.map((k) => `<option value="${k}" ${F.kind === k ? 'selected' : ''}>${E.KIND[k].one}</option>`).join('')}</select></label>`
              : ''
          }
          ${
            isTrade
              ? `<label class="field"><span>Количество, шт</span><input class="input num" id="fQty" inputmode="decimal" value="${esc(F.qty)}" required></label>
            <div class="field"><span>Цена за 1 шт${bond ? '' : ', ₽'}</span>
              <div style="display:flex;gap:6px"><input class="input num" id="fPrice" inputmode="decimal" value="${esc(F.price)}" required style="flex:1">${
                bond ? `<div class="seg"><button type="button" data-act="price-mode" data-v="pct" aria-pressed="${F.priceMode === 'pct'}">%</button><button type="button" data-act="price-mode" data-v="rub" aria-pressed="${F.priceMode === 'rub'}">₽</button></div>` : ''
              }</div>
              <span class="hint" id="priceHint"></span></div>
            ${bond ? `<label class="field"><span>НКД за всю сделку, ₽</span><input class="input num" id="fNkd" inputmode="decimal" value="${esc(F.nkd)}" placeholder="0"><span class="hint">Есть в деталях сделки в приложении банка</span></label>` : ''}
            <label class="field"><span>Комиссия, ₽</span><input class="input num" id="fFee" inputmode="decimal" value="${esc(F.fee)}" placeholder="0 или 0,3%"><span class="hint">Можно ввести процент: 0,3%</span></label>
            ${bond && !schedKnown ? `<label class="check full"><input type="checkbox" id="fAmort" ${F.hasAmort ? 'checked' : ''}> У облигации есть амортизация</label>` : ''}`
              : ''
          }
          ${
            isPay || isCash
              ? `<label class="field"><span>${isPay ? (E.isIncome(t) ? 'Сумма до налога, ₽' : 'Сумма, ₽') : 'Сумма, ₽'}</span><input class="input num" id="fAmount" inputmode="decimal" value="${esc(F.amount)}" required></label>`
              : ''
          }
          ${isPay && E.isIncome(t) ? `<label class="field"><span>Удержан налог, ₽</span><input class="input num" id="fTax" inputmode="decimal" value="${esc(F.tax)}" placeholder="если известен"></label>` : ''}
          ${isPay ? `<label class="field"><span>Количество бумаг</span><input class="input num" id="fQty" inputmode="decimal" value="${esc(F.qty)}" placeholder="необязательно"></label>` : ''}
          <label class="field full"><span>Примечание</span><input class="input" id="fNote" value="${esc(F.note)}" placeholder="необязательно"></label>
        </div>
        ${isTrade ? `<div class="calc-line"><span id="calcLabel">${t === 'buy' ? 'Спишется со счёта' : 'Поступит на счёт'}</span><strong id="calcTotal">—</strong></div>` : ''}
        <p class="error sm bad" id="opError" hidden></p>
      </div>
      <div class="dlg-foot">${F.id && F.source === 'import' ? '<span class="left xs muted">Из отчёта</span>' : ''}<button type="button" class="btn" data-act="close-dlg">Отмена</button><button type="submit" class="btn primary" id="opSave">${F.id ? 'Сохранить' : 'Добавить'}</button></div>
    </form>`;
    bindOpForm();
    updateCalc();
  }

  function readForm() {
    const v = (id) => {
      const e = $('#' + id);
      return e ? e.value : undefined;
    };
    const set = (k, id) => {
      const x = v(id);
      if (x !== undefined) F[k] = x;
    };
    set('date', 'fDate');
    set('account', 'fAcc');
    set('qty', 'fQty');
    set('price', 'fPrice');
    set('nkd', 'fNkd');
    set('fee', 'fFee');
    set('amount', 'fAmount');
    set('tax', 'fTax');
    set('note', 'fNote');
    set('query', 'fSec');
    const k = v('fKind');
    if (k) F.kind = k;
    const a = $('#fAmort');
    if (a) F.hasAmort = a.checked;
  }

  function computeTrade() {
    const qty = U.parseNum(F.qty);
    const raw = U.parseNum(F.price);
    const bond = F.kind === 'bond';
    const face = bond ? faceAt(F.date) : null;
    let priceRub = raw;
    let pct = null;
    if (bond && raw != null) {
      if (F.priceMode === 'pct') {
        pct = raw;
        priceRub = (raw / 100) * face;
      } else pct = (raw / face) * 100;
    }
    const nkd = U.parseNum(F.nkd) || 0;
    let fee = 0;
    const feeStr = String(F.fee || '').trim();
    if (/%$/.test(feeStr)) fee = qty && priceRub ? ((U.parseNum(feeStr.replace('%', '')) || 0) * qty * priceRub) / 100 : 0;
    else fee = U.parseNum(feeStr) || 0;
    fee = U.round2(fee);
    const total = qty && priceRub ? (F.type === 'buy' ? qty * priceRub + nkd + fee : qty * priceRub + nkd - fee) : null;
    return { qty, priceRub, pct, nkd, fee, total, face };
  }

  function updateCalc() {
    if (!TRADE.includes(F.type)) return;
    readForm();
    const c = computeTrade();
    const tEl = $('#calcTotal');
    if (tEl) tEl.textContent = c.total != null ? U.rub(c.total, 2) : '—';
    const h = $('#priceHint');
    if (h) {
      if (F.kind === 'bond' && c.priceRub != null)
        h.textContent = F.priceMode === 'pct' ? `= ${U.rub(c.priceRub, 2)} за облигацию (номинал ${U.rub(c.face, 0)})` : `= ${U.num(c.pct, 2)}% от номинала ${U.rub(c.face, 0)}`;
      else if (F.kind === 'bond') h.textContent = F.priceMode === 'pct' ? 'В процентах от номинала, как в стакане' : 'В рублях за одну облигацию';
      else h.textContent = '';
    }
    const feeHint = $('#fFee') && $('#fFee').nextElementSibling;
    if (feeHint && /%$/.test(String(F.fee).trim())) feeHint.textContent = `= ${U.rub(c.fee, 2)}`;
  }

  function bindOpForm() {
    const form = $('#opForm');
    form.addEventListener('input', (e) => {
      if (e.target.id !== 'fSec') updateCalc();
    });
    form.addEventListener('change', (e) => {
      if (e.target.id === 'fKind') {
        readForm();
        F.priceMode = F.kind === 'bond' ? 'pct' : 'rub';
        renderOpDialog();
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveOp();
    });
    const sec = $('#fSec');
    if (!sec) return;
    const list = $('#secList');
    let items = [];
    let active = -1;
    const show = (arr) => {
      items = arr.slice(0, 8);
      active = -1;
      list.innerHTML = items
        .map((s, i) => `<li role="option" data-i="${i}">${dot(s.kind)}<span style="flex:1;min-width:0"><b>${esc(s.shortname)}</b> <small class="mono">${esc(s.secid)}</small><br><small>${esc(s.name && s.name !== s.shortname ? s.name : E.KIND[s.kind].one)}</small></span>${s.mine ? '<small>в портфеле</small>' : ''}</li>`)
        .join('');
      list.hidden = !items.length;
    };
    const choose = async (s) => {
      F.secid = s.secid;
      F.query = s.shortname;
      F.name = s.shortname;
      F.kind = s.kind || 'bond';
      F.priceMode = F.kind === 'bond' ? 'pct' : 'rub';
      list.hidden = true;
      readForm();
      F.query = s.shortname;
      if (!S.info[s.secid] || S.info[s.secid].initialFace == null) {
        try {
          const d = await M.describe(s.secid);
          if (d) {
            S.info[s.secid] = { ...(S.info[s.secid] || {}), ...stripNulls(d) };
            F.kind = d.kind || F.kind;
          }
          if (F.kind === 'bond') S.info[s.secid] = { ...S.info[s.secid], ...(await M.bondization(s.secid)) };
        } catch (e) {}
      }
      renderOpDialog();
      const next = $('#fQty') || $('#fAmount');
      if (next) next.focus();
    };
    const search = U.debounce(async () => {
      const q = sec.value.trim();
      F.secid = '';
      $('#secHint').textContent = 'Ищу…';
      const ql = q.toLowerCase();
      const mine = knownSecurities()
        .filter((s) => !ql || (s.shortname + ' ' + s.secid + ' ' + (s.isin || '')).toLowerCase().includes(ql))
        .map((s) => ({ ...s, mine: true }));
      show(mine);
      if (q.length < 2) {
        $('#secHint').textContent = 'Начните вводить — подскажу бумаги с Мосбиржи';
        return;
      }
      try {
        const found = await M.search(q);
        const ids = new Set(mine.map((s) => s.secid));
        show([...mine, ...found.filter((f) => !ids.has(f.secid))]);
        $('#secHint').textContent = found.length || mine.length ? 'Выберите бумагу из списка' : 'Не нашлось. Проверьте тикер или ISIN.';
      } catch (e) {
        $('#secHint').textContent = 'Мосбиржа не отвечает. Можно ввести тикер вручную и выбрать вид актива.';
        renderKindSelectIfNeeded();
      }
    }, 280);
    sec.addEventListener('input', search);
    sec.addEventListener('focus', () => {
      if (!F.secid) search();
    });
    sec.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        $$('li', list).forEach((li, i) => li.setAttribute('aria-selected', i === active));
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        choose(items[active]);
      } else if (e.key === 'Escape') list.hidden = true;
    });
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li');
      if (li) {
        e.preventDefault();
        choose(items[Number(li.dataset.i)]);
      }
    });
    sec.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 150));
  }
  function renderKindSelectIfNeeded() {
    if ($('#fKind')) return;
    readForm();
    renderOpDialog();
  }

  async function saveOp() {
    readForm();
    const err = $('#opError');
    err.hidden = true;
    const fail = (msg) => {
      err.textContent = msg;
      err.hidden = false;
    };
    const t = F.type;
    if (!U.isISO(F.date)) return fail('Укажите дату.');
    const op = { op_type: t, op_date: F.date, account: F.account || null, note: F.note || null };
    if (!CASH.includes(t)) {
      if (!F.secid) {
        const code = String(F.query || '').trim();
        if (!code) return fail('Выберите бумагу.');
        $('#opSave').disabled = true;
        try {
          const d = await M.resolve(code);
          if (d) {
            F.secid = d.secid;
            F.kind = d.kind || F.kind;
            F.name = d.shortname;
            S.info[d.secid] = { ...(S.info[d.secid] || {}), ...stripNulls(d) };
          }
        } catch (e) {}
        $('#opSave').disabled = false;
        if (!F.secid) {
          F.secid = code.toUpperCase().replace(/\s+/g, '');
          F.name = code;
        }
      }
      op.secid = F.secid;
      op.name = F.name || (S.info[F.secid] || {}).shortname || F.secid;
      op.asset_type = F.kind;
      op.isin = (S.info[F.secid] || {}).isin || null;
    }
    if (TRADE.includes(t)) {
      const c = computeTrade();
      if (!(c.qty > 0)) return fail('Укажите количество.');
      if (!(c.priceRub > 0)) return fail('Укажите цену.');
      if (t === 'sell') {
        const held = (S.model.positions.find((p) => p.secid === F.secid) || {}).qty || 0;
        const own = F.id ? Number((S.ops.find((o) => o.id === F.id) || {}).quantity) || 0 : 0;
        if (c.qty > held + own + 1e-9) return fail(`В портфеле только ${U.num(held + own)} шт.`);
      }
      Object.assign(op, {
        quantity: c.qty,
        price: Math.round(c.priceRub * 1e4) / 1e4,
        price_pct: F.kind === 'bond' ? Math.round(c.pct * 1e4) / 1e4 : null,
        accrued_interest: F.kind === 'bond' ? c.nkd : 0,
        fee: c.fee,
        amount: U.round2(c.qty * c.priceRub),
        has_amortization: F.kind === 'bond' && F.hasAmort != null ? F.hasAmort : null,
      });
    } else {
      const a = U.parseNum(F.amount);
      if (!(a > 0)) return fail('Укажите сумму.');
      op.amount = a;
      op.tax = U.parseNum(F.tax);
      op.quantity = U.parseNum(F.qty);
    }
    $('#opSave').disabled = true;
    try {
      const isNewSec = op.secid && !S.ops.some((o) => o.secid === op.secid);
      if (F.id) {
        const row = await S.store.updateOp(F.id, op);
        S.ops = S.ops.map((o) => (o.id === F.id ? row : o));
      } else {
        const [row] = await S.store.insertOps([{ ...op, source: 'manual' }]);
        S.ops.push(row);
      }
      $('#dlgOp').close();
      buildAccountFilter();
      recompute();
      renderView();
      toast(F.id ? 'Операция изменена' : `${E.OP[t]} добавлена`);
      if (isNewSec) loadMarket();
    } catch (e) {
      fail(e.message);
      $('#opSave').disabled = false;
    }
  }

  /* ---------- загрузка отчётов ---------- */
  let IMP = null;
  const MONTH_KEY = (iso) => String(iso || '').slice(0, 7);
  const monthLabel = (key, short) => {
    const y = U.year(key);
    const m0 = U.month0(key + '-01');
    return short ? `${U.MONTHS_SHORT[m0]} ${y}` : `${U.MONTHS[m0]} ${y}`;
  };
  function monthsBetween(a, b) {
    const out = [];
    let y = U.year(a);
    let m = U.month0(a + '-01');
    const yb = U.year(b);
    const mb = U.month0(b + '-01');
    while (y < yb || (y === yb && m <= mb)) {
      out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
      m++;
      if (m > 11) (m = 0), y++;
    }
    return out;
  }
  function guessAccount(ops) {
    const accs = accounts();
    const stocks = ops.some((o) => o.asset_hint === 'share' || o.asset_hint === 'fund' || o.op_type === 'dividend');
    return (stocks ? accs.find((a) => /акци/i.test(a)) : accs.find((a) => /облиг/i.test(a))) || accs[0] || '';
  }

  function openImport() {
    closeDrawer();
    IMP = { step: 'pick', busy: false, progress: null, results: [], errors: [], groups: [], rows: [], skipped: [], filter: 'all', limit: 150, tableAccount: S.account !== 'all' ? S.account : accounts()[0] || '' };
    renderImport();
    $('#dlgImport').showModal();
  }

  function renderImport() {
    const dlg = $('#dlgImport');
    if (IMP.step === 'pick') {
      const p = IMP.progress;
      dlg.innerHTML = `<div class="dlg">
        <div class="dlg-head"><h2 id="dlgImportTitle">Загрузить отчёты</h2><button type="button" class="icon-btn" data-act="close-dlg" aria-label="Закрыть">${ICON.close}</button></div>
        <div class="dlg-body">
          <ol class="steps">
            <li>В Т-Инвестициях закажите <b>брокерский отчёт</b> в PDF. Он делается за месяц, поэтому нужны отчёты за все месяцы с открытия счёта.</li>
            <li>Выберите сразу все файлы, по обоим счетам. Сайт сам разложит их по счетам и проверит, что ни один месяц не пропущен.</li>
            <li>Повторная загрузка безопасна: что уже есть, второй раз не добавится. Последние операции, которых ещё нет в отчётах, внесите вручную. Когда придёт отчёт за этот месяц, ручные записи заменятся записями из отчёта.</li>
          </ol>
          <label class="drop ${IMP.busy ? 'busy' : ''}" id="drop"><input type="file" id="impFile" accept=".pdf,.csv,.txt,.xlsx,.xls" multiple hidden ${IMP.busy ? 'disabled' : ''}>
            ${ICON.upload.replace('<svg', '<svg width="28" height="28"')}<b>${IMP.busy ? (p ? `Читаю ${p.done + 1} из ${p.total}…` : 'Читаю…') : 'Выберите файлы или перетащите их сюда'}</b>
            <span class="sm muted">${IMP.busy && p ? esc(p.name || '') : 'PDF-отчёты Т-Банка, можно много сразу · или CSV, выгруженный с этого сайта'}</span>
            ${IMP.busy && p ? `<span class="progress" aria-hidden="true"><span style="width:${Math.round((p.done / p.total) * 100)}%"></span></span>` : ''}</label>
          ${IMP.errors.length ? `<div class="banner"><span>${IMP.errors.map((e) => `${esc(e.file)}: ${esc(e.message)}`).join('<br>')}</span></div>` : ''}
          <p class="error sm bad" id="impError" hidden></p>
        </div>
        <div class="dlg-foot"><button type="button" class="btn" data-act="close-dlg">Отмена</button></div></div>`;
      const input = $('#impFile');
      const drop = $('#drop');
      input.addEventListener('change', () => input.files.length && handleFiles([...input.files]));
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add('over'))));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!IMP.busy && e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]);
      });
      return;
    }

    /* ---- предпросмотр ---- */
    const rows = IMP.rows;
    const sel = rows.filter((r) => r.checked);
    const replacing = sel.filter((r) => r.replaces).length;
    const byType = {};
    sel.forEach((r) => (byType[r.op_type] = (byType[r.op_type] || 0) + 1));
    const counts = { dup: 0, maybe: 0, unresolved: 0, replace: 0 };
    rows.forEach((r) => counts[r.status] != null && counts[r.status]++);
    const accs = accounts();
    const FILTERS = [
      ['all', 'Все', () => true],
      ['trades', 'Сделки', (r) => TRADE.includes(r.op_type)],
      ['pay', 'Выплаты', (r) => PAY.includes(r.op_type)],
      ['cash', 'Пополнения и прочее', (r) => !TRADE.includes(r.op_type) && !PAY.includes(r.op_type)],
      ['attention', 'Требуют внимания', (r) => r.status === 'unresolved' || r.status === 'maybe' || r.status === 'replace'],
    ];
    const f = FILTERS.find((x) => x[0] === IMP.filter) || FILTERS[0];
    const visible = rows.map((r, i) => [r, i]).filter(([r]) => f[2](r));
    const shown = visible.slice(0, IMP.limit);
    const known = knownSecurities();
    IMP.codes.forEach((c) => !known.some((k) => k.secid === c.secid) && known.push(c));
    const statusLabel = {
      new: '<span class="badge good">новая</span>',
      dup: '<span class="badge">уже есть</span>',
      replace: '<span class="badge accent">заменит ручную</span>',
      maybe: '<span class="badge warn">похожа на внесённую</span>',
      unresolved: '<span class="badge bad">выберите бумагу</span>',
    };
    const check = (ok, html) => `<li class="${ok === true ? 'ok' : ok === false ? 'warn' : 'info'}">${html}</li>`;

    const groupsHtml = IMP.groups
      .map((g) => {
        const periods = g.periods;
        const span = periods.length === 1 ? monthLabel(periods[0]) : `${monthLabel(periods[0], true)} – ${monthLabel(periods[periods.length - 1], true)} · ${periods.length} ${U.plural(periods.length, ['отчёт', 'отчёта', 'отчётов'])}`;
        const items = [];
        if (g.kind === 'tbank') {
          const bad = g.cashBad;
          items.push(
            bad.length
              ? check(false, `Не сходятся деньги в ${bad.length === 1 ? 'отчёте' : 'отчётах'} за ${bad.map((b) => esc(monthLabel(b.period))).join(', ')}: часть строк могла не прочитаться. Проверьте операции этих месяцев.`)
              : check(true, `Все строки прочитаны: остаток денег в ${periods.length === 1 ? 'отчёте' : 'каждом отчёте'} сходится до копейки.`)
          );
          if (g.missing.length) items.push(check(false, `Не хватает ${g.missing.length === 1 ? 'отчёта' : 'отчётов'} за ${g.missing.map((m) => esc(monthLabel(m))).join(', ')}.`));
          const rc = g.recon;
          if (rc) {
            if (!rc.mismatch.length) items.push(check(true, `Количество бумаг на ${U.date(rc.date)} совпадает с отчётом: ${rc.total} ${U.plural(rc.total, ['бумага', 'бумаги', 'бумаг'])}.`));
            else
              items.push(
                check(
                  false,
                  `На ${U.date(rc.date)} не совпадает количество по ${rc.mismatch.length} ${U.plural(rc.mismatch.length, ['бумаге', 'бумагам', 'бумагам'])}.${
                    rc.earlier ? ` В отчёте за ${esc(monthLabel(rc.earlier.period))} бумаги были уже на начало месяца: загрузите отчёты за прошлые месяцы${g.since ? `, начиная с открытия счёта (${U.date(g.since)})` : ''}, иначе не будет цен покупки.` : ''
                  }
                  <details><summary>Подробнее</summary><table class="mini"><thead><tr><th>Бумага</th><th>В отчёте</th><th>На сайте</th></tr></thead><tbody>${rc.mismatch
                    .slice(0, 40)
                    .map((x) => `<tr><td>${esc(x.name)}</td><td>${U.num(x.report)}</td><td>${U.num(x.site)}</td></tr>`)
                    .join('')}</tbody></table></details>`
                )
              );
          }
        }
        return `<div class="imp-group">
          <div class="imp-group-head"><div><b>${g.kind === 'tbank' ? `Договор …${esc(g.tail || '????')}` : 'Таблица'}</b><span class="sm muted">${g.kind === 'tbank' ? esc(span) : esc(g.files.join(', '))}</span></div>
            <label class="field inline"><span>Счёт</span><select class="input" data-imp-acc="${esc(g.acct)}">${accs.map((a) => `<option ${a === g.account ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label></div>
          ${items.length ? `<ul class="checks">${items.join('')}</ul>` : ''}
        </div>`;
      })
      .join('');

    dlg.innerHTML = `<div class="dlg">
      <div class="dlg-head"><h2 id="dlgImportTitle">Проверьте отчёты</h2><button type="button" class="icon-btn" data-act="close-dlg" aria-label="Закрыть">${ICON.close}</button></div>
      <div class="dlg-body">
        ${IMP.errors.length ? `<div class="banner"><span>Не прочитаны: ${IMP.errors.map((e) => `${esc(e.file)} — ${esc(e.message)}`).join('; ')}</span></div>` : ''}
        ${groupsHtml}
        <p class="sm">Нашлось ${rows.length} ${U.plural(rows.length, ['операция', 'операции', 'операций'])}${counts.dup ? `, из них ${counts.dup} уже есть на сайте` : ''}${counts.replace ? `, ${counts.replace} заменят записи, внесённые вручную` : ''}${counts.maybe ? `, ${counts.maybe} похожи на внесённые вручную, они не отмечены` : ''}${counts.unresolved ? `. Для ${counts.unresolved} выплат не удалось понять бумагу, выберите её в списке` : ''}.</p>
        <div class="chips">${Object.entries(byType).map(([k, n]) => `<span class="badge accent">${E.OP[k]}: ${n}</span>`).join('')}</div>
        <div class="seg wrap" role="group" aria-label="Показать">${FILTERS.map(([k, t, fn]) => `<button type="button" data-act="imp-filter" data-v="${k}" aria-pressed="${IMP.filter === k}">${t} <span class="count">${rows.filter(fn).length}</span></button>`).join('')}</div>
        <div class="preview-table"><table class="data"><thead><tr><th><input type="checkbox" id="impAll" aria-label="Отметить все показанные"></th><th>Дата</th><th>Операция</th><th style="text-align:left">Бумага</th><th>Кол-во</th><th>Цена, ₽</th><th>Сумма, ₽</th><th>Статус</th></tr></thead><tbody>
        ${shown
          .map(
            ([r, i]) => `<tr class="${r.status === 'dup' ? 'dup' : ''}"><td><input type="checkbox" data-imp="${i}" ${r.checked ? 'checked' : ''} ${r.status === 'dup' ? 'disabled' : ''} aria-label="Добавить"></td>
          <td>${U.date(r.op_date)}</td><td>${E.OP[r.op_type]}</td>
          <td style="text-align:left">${
            PAY.includes(r.op_type) && (r.status === 'unresolved' || !r.secid)
              ? `<select class="input" data-imp-sec="${i}" style="min-height:30px;padding:2px 6px"><option value="">— бумага —</option>${known.map((k) => `<option value="${esc(k.secid)}" ${k.secid === r.secid ? 'selected' : ''}>${esc(k.shortname)}</option>`).join('')}</select><small title="${esc(r.note || '')}">${esc(String(r.note || '').slice(0, 60))}</small>`
              : r.secid
              ? `${dot(r.asset_type)} ${esc(r.name || r.secid)}<small class="mono">${esc(r.secid)}</small>`
              : `<small>${esc(r.account || '')}</small>`
          }${r.replaces ? `<small>вместо записи от ${U.date(r.replacesDate)}</small>` : ''}</td>
          <td>${r.quantity != null ? U.num(r.quantity) : ''}</td><td>${r.price != null && TRADE.includes(r.op_type) ? U.num(r.price, 2) : ''}</td><td>${U.num(r.amount, 2)}</td><td>${statusLabel[r.status] || ''}</td></tr>`
          )
          .join('')}</tbody></table></div>
        ${visible.length > shown.length ? `<button type="button" class="btn sm" data-act="imp-more">Показать ещё ${Math.min(IMP.limit, visible.length - shown.length)} из ${visible.length - shown.length}</button>` : ''}
        ${IMP.skipped.length ? `<details><summary class="sm">Пропущено строк: ${IMP.skipped.length}</summary><ul class="sm muted">${IMP.skipped.slice(0, 60).map((s) => `<li>${s.date ? U.date(s.date) + ' · ' : ''}${esc(s.text || '')}${s.amount ? ' · ' + U.rub(s.amount, 2, { sign: true }) : ''} — ${esc(s.reason)}</li>`).join('')}</ul></details>` : ''}
        <p class="error sm bad" id="impError" hidden></p>
      </div>
      <div class="dlg-foot"><span class="left">Добавится: <b>${sel.length}</b>${replacing ? ` · заменит ручных: <b>${replacing}</b>` : ''}</span><button type="button" class="btn" data-act="imp-back">Назад</button><button type="button" class="btn primary" data-act="imp-save" ${sel.length ? '' : 'disabled'}>Добавить ${sel.length}</button></div></div>`;

    dlg.querySelectorAll('[data-imp]').forEach((cb) =>
      cb.addEventListener('change', () => {
        rows[Number(cb.dataset.imp)].checked = cb.checked;
        reconcileImport();
        renderImport();
      })
    );
    dlg.querySelectorAll('[data-imp-sec]').forEach((s) =>
      s.addEventListener('change', () => {
        const r = rows[Number(s.dataset.impSec)];
        const k = known.find((x) => x.secid === s.value);
        r.secid = s.value || null;
        r.name = k ? k.shortname : null;
        r.asset_type = k ? k.kind : r.asset_type;
        r.status = r.secid ? 'new' : 'unresolved';
        r.checked = !!r.secid;
        renderImport();
      })
    );
    dlg.querySelectorAll('[data-imp-acc]').forEach((s) =>
      s.addEventListener('change', () => {
        const g = IMP.groups.find((x) => x.acct === s.dataset.impAcc);
        if (g) g.account = s.value;
        statusImport();
        renderImport();
      })
    );
    const all = $('#impAll');
    const pickable = shown.filter(([r]) => r.status !== 'dup' && r.status !== 'unresolved');
    all.checked = pickable.length > 0 && pickable.every(([r]) => r.checked);
    all.addEventListener('change', () => {
      pickable.forEach(([r]) => (r.checked = all.checked));
      reconcileImport();
      renderImport();
    });
  }

  async function handleFiles(files) {
    IMP.busy = true;
    IMP.errors = [];
    IMP.results = [];
    const total = files.length;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      IMP.progress = { done: i, total, name: file.name };
      renderImport();
      try {
        if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
          const r = await KK.tbank.parse(file);
          r.fileName = file.name;
          if (!r.ops.length && !r.holdings.length) throw new Error('в отчёте нет операций');
          IMP.results.push(r);
        } else {
          const r = await I.parse(file);
          if (!r.ops.length) throw new Error('не нашлось операций');
          IMP.results.push({ format: 'table', fileName: file.name, ops: r.ops, skipped: r.skipped });
        }
      } catch (e) {
        console.error(e);
        IMP.errors.push({ file: file.name, message: e.message });
      }
    }
    IMP.progress = null;
    IMP.busy = false;
    if (!IMP.results.length) return renderImport();
    try {
      await buildImport();
      IMP.step = 'preview';
    } catch (e) {
      console.error(e);
      IMP.errors.push({ file: 'разбор', message: e.message });
    }
    renderImport();
  }

  async function buildImport() {
    const results = IMP.results;
    const tb = results.filter((r) => r.format === 'tbank-pdf');
    const settings = S.settings;

    /* общий справочник по всем отчётам: ISIN → код, код → тип и название */
    const isinMap = {};
    const types = {};
    const names = {};
    for (const r of tb) {
      for (const [isin, code] of Object.entries(r.isinMap)) if (!isinMap[isin] || (KK.tbank.looksIsin(isinMap[isin]) && !KK.tbank.looksIsin(code))) isinMap[isin] = code;
      Object.assign(types, r.types);
      for (const [c, n] of Object.entries(r.names)) if (!names[c]) names[c] = n;
    }
    const canon = (code, isin) => {
      if (isin && isinMap[isin]) return isinMap[isin];
      if (code && KK.tbank.looksIsin(code) && isinMap[code]) return isinMap[code];
      return code || isin || null;
    };

    /* группы: договор (= счёт) или таблица */
    const groups = new Map();
    for (const r of tb) {
      const k = r.acct;
      if (!groups.has(k)) groups.set(k, { kind: 'tbank', acct: k, tail: r.contract && r.contract.tail, since: r.contract && r.contract.since, results: [], files: [] });
      const g = groups.get(k);
      g.results.push(r);
      g.files.push(r.fileName);
    }
    const tables = results.filter((r) => r.format === 'table');
    if (tables.length) groups.set('table', { kind: 'table', acct: 'table', results: tables, files: tables.map((r) => r.fileName), account: IMP.tableAccount });
    for (const g of groups.values()) {
      if (g.kind === 'tbank') {
        g.results.sort((a, b) => (a.period && b.period ? (a.period.from < b.period.from ? -1 : 1) : 0));
        g.periods = [...new Set(g.results.map((r) => MONTH_KEY(r.period && r.period.from)).filter(Boolean))].sort();
        g.account = (settings.accountMap || {})[g.acct] || (settings.reports && settings.reports[g.acct] && settings.reports[g.acct].account) || guessAccount(g.results.flatMap((r) => r.ops));
        g.cashBad = g.results.filter((r) => r.cashCheck && !r.cashCheck.ok).map((r) => ({ period: MONTH_KEY(r.period.from), diff: r.cashCheck.computed - r.cashCheck.closing }));
        const before = ((settings.reports || {})[g.acct] || {}).periods || [];
        const allPeriods = [...new Set([...before, ...g.periods])].sort();
        g.missing = allPeriods.length ? monthsBetween(allPeriods[0], allPeriods[allPeriods.length - 1]).filter((m) => !allPeriods.includes(m)) : [];
      }
    }
    IMP.groups = [...groups.values()];
    IMP.skipped = results.flatMap((r) => r.skipped || []);

    /* операции */
    const raw = [];
    const seenKeys = new Set();
    for (const g of IMP.groups)
      for (const r of g.results)
        for (const o of r.ops) {
          if (o.import_key && seenKeys.has(o.import_key)) continue;
          if (o.import_key) seenKeys.add(o.import_key);
          raw.push({ ...o, _group: g.acct, code: g.kind === 'tbank' ? canon(o.code, o.isin) : o.code });
        }

    /* коды → бумаги: сначала свои, потом справочник отчётов, для таблиц — Мосбиржа */
    const codes = [...new Set(raw.map((o) => o.code).filter(Boolean))];
    const resolved = {};
    await pool(codes, 4, async (c) => {
      const mine = S.ops.find((o) => o.secid === c || o.isin === c);
      if (mine) return (resolved[c] = { secid: mine.secid, shortname: (S.info[mine.secid] || {}).shortname || mine.name, kind: (S.info[mine.secid] || {}).kind || mine.asset_type });
      if (types[c] || names[c]) return (resolved[c] = { secid: c, shortname: names[c] || c, kind: types[c] || 'bond' });
      try {
        const d = await M.resolve(c);
        if (d) {
          resolved[c] = d;
          S.info[d.secid] = { ...(S.info[d.secid] || {}), ...stripNulls(d) };
        }
      } catch (e) {}
    });
    IMP.codes = Object.values(resolved).map((d) => ({ secid: d.secid, shortname: d.shortname, kind: d.kind || 'bond' }));
    IMP.rows = raw.map((o) => {
      const d = o.code ? resolved[o.code] : null;
      return {
        _group: o._group,
        op_date: o.op_date,
        op_type: o.op_type,
        secid: d ? d.secid : o.code ? String(o.code).toUpperCase() : null,
        isin: o.isin || (d && d.isin) || null,
        name: o.name || (d ? d.shortname : null),
        asset_type: (d && d.kind) || o.asset_type || o.asset_hint || (o.code ? 'bond' : null),
        account: null,
        quantity: o.quantity ?? null,
        price: o.price ?? null,
        price_pct: o.price_pct ?? null,
        accrued_interest: o.accrued_interest ?? null,
        fee: o.fee ?? null,
        amount: o.amount ?? null,
        tax: o.tax ?? null,
        note: o.note || null,
        import_key: o.import_key,
        source: 'import',
        unresolvedHint: !!o.unresolved,
      };
    });
    statusImport();
  }

  /* статусы строк: уже есть / заменит ручную / новая */
  function statusImport() {
    const keys = new Set(S.ops.map((o) => o.import_key).filter(Boolean));
    const groupAcc = Object.fromEntries(IMP.groups.map((g) => [g.acct, g.account]));
    const used = new Set();
    const manual = S.ops.filter((o) => o.source !== 'import');
    const near = (a, b, days) => Math.abs(U.daysBetween(a, b)) <= days;
    const close = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= Math.max(1, Math.abs(Number(b) || 0) * 0.01);
    for (const r of IMP.rows) {
      r.account = groupAcc[r._group] || null;
      r.replaces = null;
      r.replacesDate = null;
      if (keys.has(r.import_key)) {
        r.status = 'dup';
        r.checked = false;
        continue;
      }
      if (PAY.includes(r.op_type) && !r.secid) {
        r.status = 'unresolved';
        r.checked = false;
        continue;
      }
      const twin = manual.find(
        (x) =>
          !used.has(x.id) &&
          x.op_type === r.op_type &&
          (x.secid || null) === (r.secid || null) &&
          (!x.account || !r.account || x.account === r.account) &&
          near(x.op_date, r.op_date, TRADE.includes(r.op_type) ? 4 : 6) &&
          (TRADE.includes(r.op_type) ? Math.abs((Number(x.quantity) || 0) - (r.quantity || 0)) < 1e-9 : close(x.amount, r.amount))
      );
      if (twin) {
        used.add(twin.id);
        r.status = 'replace';
        r.replaces = twin.id;
        r.replacesDate = twin.op_date;
        r.checked = true;
      } else {
        r.status = 'new';
        r.checked = true;
      }
    }
    reconcileImport();
  }

  /* сверка количества бумаг с остатками на конец последнего отчёта */
  function reconcileImport() {
    for (const g of IMP.groups) {
      g.recon = null;
      if (g.kind !== 'tbank') continue;
      const last = g.results.filter((r) => r.period && r.holdings.length).slice(-1)[0];
      if (!last) continue;
      const end = last.period.to;
      const replaced = new Set(IMP.rows.filter((r) => r.checked && r.replaces).map((r) => r.replaces));
      const ops = [
        ...S.ops.filter((o) => (o.account || null) === g.account && !replaced.has(o.id)),
        ...IMP.rows.filter((r) => r._group === g.acct && r.checked && r.status !== 'dup'),
      ];
      const qty = new Map();
      const add = (id, n) => qty.set(id, (qty.get(id) || 0) + n);
      for (const o of ops) {
        if (!o.secid || o.op_date > end) continue;
        if (o.op_type === 'buy') add(o.secid, Number(o.quantity) || 0);
        else if (o.op_type === 'sell') add(o.secid, -(Number(o.quantity) || 0));
        else if (o.op_type === 'redemption') add(o.secid, -(Number(o.quantity) || 0));
      }
      const report = new Map();
      for (const h of last.holdings) {
        const id = (KK.tbank.looksIsin(h.code) && last.isinMap[h.code]) || h.code;
        const n = h.planned ?? h.out ?? 0;
        report.set(id, { n: (report.get(id) ? report.get(id).n : 0) + n, name: h.name || id });
      }
      const mismatch = [];
      const ids = new Set([...report.keys(), ...[...qty.entries()].filter(([, n]) => Math.abs(n) > 1e-9).map(([k]) => k)]);
      for (const id of ids) {
        const rep = report.get(id) ? report.get(id).n : 0;
        const site = qty.get(id) || 0;
        if (Math.abs(rep - site) > 1e-9) mismatch.push({ id, name: (report.get(id) || {}).name || (S.info[id] || {}).shortname || id, report: rep, site });
      }
      const first = g.results.find((r) => r.holdings.length);
      const firstHasStart = first && first.holdings.some((h) => (h.in || 0) > 0);
      // сделка последнего дня прошлого месяца попадает в отчёт следующего, поэтому запас в неделю
      const opsBefore = first && ops.some((o) => o.op_date < U.addDays(first.period.from, -7) && (o.op_type === 'buy' || o.op_type === 'sell'));
      g.recon = {
        date: end,
        total: [...report.values()].filter((x) => x.n > 0).length,
        mismatch: mismatch.sort((a, b) => (a.name > b.name ? 1 : -1)),
        earlier: mismatch.length && firstHasStart && !opsBefore ? { period: MONTH_KEY(first.period.from) } : null,
      };
    }
  }

  async function saveImport() {
    const rows = IMP.rows.filter((r) => r.checked);
    const btn = $('[data-act="imp-save"]');
    btn.disabled = true;
    btn.textContent = 'Сохраняю…';
    try {
      const clean = rows.map(({ status, checked, replaces, replacesDate, _group, unresolvedHint, ...r }) => r);
      const added = await S.store.insertOps(clean);
      const toDelete = rows.filter((r) => r.replaces).map((r) => r.replaces);
      if (toDelete.length) {
        await S.store.deleteOps(toDelete);
        const del = new Set(toDelete);
        S.ops = S.ops.filter((o) => !del.has(o.id));
      }
      S.ops.push(...added);
      // запоминаем договор → счёт и загруженные месяцы
      const next = { ...S.settings, accountMap: { ...(S.settings.accountMap || {}) }, reports: { ...(S.settings.reports || {}) } };
      for (const g of IMP.groups) {
        if (g.kind !== 'tbank') continue;
        next.accountMap[g.acct] = g.account;
        const prev = next.reports[g.acct] || {};
        next.reports[g.acct] = { tail: g.tail || prev.tail || null, since: g.since || prev.since || null, account: g.account, periods: [...new Set([...(prev.periods || []), ...g.periods])].sort() };
      }
      try {
        await S.store.saveSettings(next);
        S.settings = next;
      } catch (e) {
        console.error(e);
      }
      $('#dlgImport').close();
      buildAccountFilter();
      recompute();
      renderView();
      toast(`Добавлено ${added.length} ${U.plural(added.length, ['операция', 'операции', 'операций'])}${toDelete.length ? `, заменено ручных: ${toDelete.length}` : ''}`);
      if (added.length) loadMarket();
    } catch (e) {
      const err = $('#impError');
      err.textContent = e.message;
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Добавить ' + rows.length;
    }
  }

  /* загруженные отчёты: какие месяцы уже есть, каких не хватает */
  function reportsPanel() {
    const reps = Object.values(S.settings.reports || {}).filter((r) => r.periods && r.periods.length && (S.account === 'all' || r.account === S.account));
    if (!reps.length) return '';
    const lastFull = MONTH_KEY(U.addDays(TODAY().slice(0, 8) + '01', -1));
    return `<section class="card reports"><div class="card-head"><h2>Загруженные отчёты</h2><span class="sm muted">отчёт за месяц появляется в начале следующего</span></div>
      ${reps
        .map((r) => {
          const from = r.since && MONTH_KEY(r.since) < r.periods[0] ? MONTH_KEY(r.since) : r.periods[0];
          const months = monthsBetween(from, lastFull > r.periods[r.periods.length - 1] ? lastFull : r.periods[r.periods.length - 1]);
          const have = new Set(r.periods);
          const miss = months.filter((m) => !have.has(m));
          const years = [...new Set(months.map((m) => m.slice(0, 4)))];
          return `<div class="rep">
            <div class="rep-head"><b>${esc(r.account || 'Счёт')}</b><span class="sm muted">договор …${esc(r.tail || '????')}</span>
              <span class="sm ${miss.length ? 'bad' : 'good'}">${miss.length ? `не хватает ${miss.length} ${U.plural(miss.length, ['месяца', 'месяцев', 'месяцев'])}` : 'все месяцы на месте'}</span></div>
            <div class="rep-grid">${years
              .map(
                (y) => `<div class="rep-year"><span class="y">${y}</span>${Array.from({ length: 12 }, (_, i) => {
                  const k = `${y}-${String(i + 1).padStart(2, '0')}`;
                  if (!months.includes(k)) return `<span class="m none" aria-hidden="true"></span>`;
                  return `<span class="m ${have.has(k) ? 'have' : 'miss'}" title="${monthLabel(k)}: ${have.has(k) ? 'загружен' : 'нет отчёта'}">${U.MONTHS_SHORT[i]}</span>`;
                }).join('')}</div>`
              )
              .join('')}</div></div>`;
        })
        .join('')}
    </section>`;
  }

  /* ================= ПРОГНОЗ ================= */
  function renderForecast() {
    const host = $('#view-forecast');
    const m = S.model;
    const def = E.defaultRate(m);
    const rate = S.fc.rate ?? (def ? Math.round(def * 10) / 10 : 12);
    const y1 = U.year(m.today) + 1;
    host.innerHTML = `
      <div class="view-head"><div><h1>Прогноз</h1><div class="sub">Что будет с пассивным доходом, если продолжать в том же духе</div></div></div>
      <div class="fc-layout">
        <aside class="card fc-controls" aria-label="Параметры прогноза">
          <div class="field"><span>Пополнение в день</span>
            <div class="deposit-input"><input id="fcDaily" inputmode="numeric" value="${S.fc.daily}" aria-label="Пополнение в день, ₽"><span>₽ в день</span></div>
            <input type="range" id="fcRange" min="0" max="1000" step="10" value="${Math.min(1000, S.fc.daily)}" aria-label="Пополнение в день">
            <div class="chips">${[100, 150, 200, 300, 500].map((v) => `<button class="chip" data-act="fc-daily" data-v="${v}" aria-pressed="${S.fc.daily === v}">${v}</button>`).join('')}</div>
            <span class="hint" id="fcDailyHint"></span>
            <div id="fcSaveDaily"></div>
          </div>
          <label class="field"><span>Новая сумма действует с</span><input class="input" type="date" id="fcStart" value="${esc(S.fc.start || U.addDays(m.today, 1))}" min="${U.addDays(m.today, 1)}">
            <button class="btn sm ghost" type="button" data-act="fc-jan" style="justify-self:start">с 1 января ${y1}</button></label>
          <div class="field"><span>Горизонт</span><div class="seg" role="group">${[3, 5, 10].map((v) => `<button type="button" data-act="fc-years" data-v="${v}" aria-pressed="${S.fc.years === v}">${v} лет</button>`).join('')}</div></div>
          <label class="check"><input type="checkbox" id="fcReinvest" ${S.fc.reinvest ? 'checked' : ''}> Реинвестировать купоны и дивиденды</label>
          <label class="field"><span>Доходность новых покупок, % годовых</span><input class="input num" id="fcRate" inputmode="decimal" value="${U.num(rate, 1)}">
            <span class="hint">${def ? `Сейчас средняя доходность к погашению ваших облигаций — ${U.pct(def, 1)}.` : 'Укажите, под какую доходность планируете покупать.'}${S.fc.rate != null && def ? ' <button class="btn sm ghost" data-act="fc-rate-reset" type="button">вернуть</button>' : ''}</span></label>
          <p class="note">Налог: купоны ${U.num(S.settings.couponTax)}%, дивиденды ${U.num(S.settings.dividendTax)}% — меняется в настройках.</p>
        </aside>
        <div style="display:grid;gap:var(--s5);min-width:0" id="fcResults"></div>
      </div>`;
    bindForecast();
    renderFcResults();
  }

  function bindForecast() {
    const daily = $('#fcDaily');
    const range = $('#fcRange');
    const upd = () => {
      renderFcResults();
      $$('[data-act="fc-daily"]').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.v) === S.fc.daily));
    };
    daily.addEventListener('input', () => {
      S.fc.daily = Math.max(0, Math.round(U.parseNum(daily.value) || 0));
      range.value = Math.min(1000, S.fc.daily);
      upd();
    });
    range.addEventListener('input', () => {
      S.fc.daily = Number(range.value);
      daily.value = S.fc.daily;
      upd();
    });
    $('#fcStart').addEventListener('change', (e) => {
      S.fc.start = e.target.value || null;
      renderFcResults();
    });
    $('#fcReinvest').addEventListener('change', (e) => {
      S.fc.reinvest = e.target.checked;
      renderFcResults();
    });
    $('#fcRate').addEventListener(
      'input',
      U.debounce((e) => {
        const v = U.parseNum(e.target.value);
        if (v != null && v >= 0 && v < 100) {
          S.fc.rate = v;
          renderFcResults();
        }
      }, 250)
    );
  }

  function renderFcResults() {
    const host = $('#fcResults');
    if (!host) return;
    const m = S.model;
    const def = E.defaultRate(m);
    const rate = S.fc.rate ?? (def ? Math.round(def * 10) / 10 : 12);
    const opts = { daily: S.fc.daily, start: S.fc.start, years: S.fc.years, reinvest: S.fc.reinvest, rate };
    const fc = E.forecast(m, opts);
    const current = Number(S.settings.dailyDeposit) || 0;
    const base = S.fc.daily !== current ? E.forecast(m, { ...opts, daily: current }) : null;
    const y0 = fc.years[0];
    const y1 = fc.years[1];
    const yN = fc.years[fc.years.length - 1];
    const dm = (S.fc.daily * 365) / 12;
    $('#fcDailyHint').textContent = `≈ ${U.rub(dm)} в месяц · ${U.rub(S.fc.daily * 365)} в год`;
    $('#fcSaveDaily').innerHTML =
      S.fc.daily !== current ? `<button class="btn sm" data-act="fc-save-daily" type="button">Сделать ${U.num(S.fc.daily)} ₽ моим ежедневным пополнением</button>` : `<span class="hint">Это ваше текущее пополнение.</span>`;
    const diff = y1.net - y0.net;
    const baseY1 = base ? base.years[1] : null;

    host.innerHTML = `
      <div class="card"><p class="fc-headline">Если вносить <strong>${U.rub(S.fc.daily)} в день</strong>${S.fc.reinvest ? ' и реинвестировать выплаты' : ''}, в ${y1.year} году пассивный доход составит <strong>≈ ${U.rub(y1.net)}</strong> после налога — это около ${U.rub(y1.perMonthNet)} в месяц${
      y0.net > 0 ? ` и на ${U.rub(Math.abs(diff))} ${diff >= 0 ? 'больше' : 'меньше'}, чем в ${y0.year}` : ''
    }. К ${yN.year} году — <strong>≈ ${U.rub(yN.net)}</strong> в год.${
      baseY1 ? ` При нынешних ${U.rub(current)} в день в ${y1.year} было бы ${U.rub(baseY1.net)}, разница — ${U.rub(y1.net - baseY1.net, 0, { sign: true })}.` : ''
    }</p></div>
      <div class="tiles">
        <article class="tile"><span class="label">${y1.year} год, после налога</span><span class="value">${U.rub(y1.net)}</span><span class="sub">до налога ${U.rub(y1.gross)}</span></article>
        <article class="tile"><span class="label">В месяц в ${y1.year}</span><span class="value">${U.rub(y1.perMonthNet)}</span><span class="sub">в среднем, после налога</span></article>
        <article class="tile"><span class="label">${yN.year} год, после налога</span><span class="value">${U.rub(yN.net)}</span><span class="sub">≈ ${U.rub(yN.perMonthNet)} в месяц</span></article>
        <article class="tile"><span class="label">Капитал к концу ${yN.year}</span><span class="value">${U.rub(yN.capital)}</span><span class="sub">пополнения за период ${U.rub(U.sum(fc.years, (y) => y.deposits))}</span></article>
      </div>
      <section class="card"><div class="card-head"><h2>Пассивный доход по годам, после налога</h2></div>
        <div class="legend"><span>${dot('bond')} от бумаг, которые уже есть</span><span><span class="dot new"></span> от новых покупок</span>${base ? `<span><span class="line-key" style="background:var(--ink-2)"></span> при ${U.num(current)} ₽ в день</span>` : ''}</div>
        <div class="chart" id="fcChart"></div></section>
      <section class="card"><div class="card-head"><h2>Капитал на конец года</h2></div><div class="chart" id="fcCapital"></div></section>
      <section class="card"><div class="card-head"><h2>По годам</h2></div>
        <div class="table-wrap" style="border:0"><table class="data"><thead><tr><th>Год</th><th>Пополнения</th><th>Доход до налога</th><th>После налога</th><th>В месяц</th><th>Капитал</th></tr></thead><tbody>
        ${fc.years.map((y) => `<tr style="cursor:default"><td>${y.year}${y.partial ? '<small>с учётом полученного</small>' : ''}</td><td>${U.rub(y.deposits)}</td><td>${U.rub(y.gross)}</td><td><b>${U.rub(y.net)}</b></td><td>${U.rub(y.perMonthNet)}</td><td>${U.rub(y.capital)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="note">Как считается: текущие облигации платят купоны по расписанию Мосбиржи до погашения; если купон ещё не объявлен, берётся последняя ставка. Возвращённый номинал, пополнения${S.fc.reinvest ? ' и выплаты после налога' : ''} вкладываются в новые бумаги под ${U.pct(rate, 1)} годовых. Дивиденды повторяются на уровне последних 12 месяцев, рост цен акций и фондов не учитывается. Это ориентир, а не обещание.</p></section>`;

    const ct = 1 - Number(S.settings.couponTax ?? 30) / 100;
    const portfolioNet = fc.years.map((y) => Math.max(0, y.net - y.fromNew * ct));
    const newNet = fc.years.map((y) => y.fromNew * ct);
    C.bars($('#fcChart'), {
      labels: fc.years.map((y) => String(y.year)),
      series: [
        { label: 'от бумаг, которые уже есть', color: 'var(--bond)', values: portfolioNet },
        { label: 'от новых покупок', color: 'var(--new)', values: newNet },
      ],
      line: base ? { label: `при ${current} ₽ в день`, color: 'var(--ink-2)', values: base.years.map((y) => y.net) } : null,
      height: 260,
      barWidth: 28,
      valueLabels: (i, v) => (i === 1 || i === fc.years.length - 1 ? U.compact(v) : null),
      tooltip: (i) => {
        const y = fc.years[i];
        return `<b>${y.year}${y.partial ? ' (включая полученное)' : ''}</b>
          <div class="row"><span>${dot('bond')}от текущих бумаг</span><span>${U.rub(portfolioNet[i])}</span></div>
          <div class="row"><span><span class="dot new"></span>от новых покупок</span><span>${U.rub(newNet[i])}</span></div>
          <div class="row"><span>итого после налога</span><span>${U.rub(y.net)}</span></div>
          ${base ? `<div class="row"><span>при ${U.num(current)} ₽ в день</span><span>${U.rub(base.years[i].net)}</span></div>` : ''}`;
      },
      ariaLabel: 'Прогноз пассивного дохода по годам',
    });
    C.line($('#fcCapital'), {
      labels: fc.years.map((y) => String(y.year)),
      series: [
        { label: 'Капитал', color: 'var(--bond)', values: fc.years.map((y) => y.capital), area: true },
        ...(base ? [{ label: `при ${current} ₽ в день`, color: 'var(--ink-2)', values: base.years.map((y) => y.capital), dashed: true }] : []),
      ],
      height: 220,
      tooltip: (i) => `<b>Конец ${fc.years[i].year}</b><div class="row"><span>${dot('bond')}капитал</span><span>${U.rub(fc.years[i].capital)}</span></div>${
        base ? `<div class="row"><span>при ${U.num(current)} ₽ в день</span><span>${U.rub(base.years[i].capital)}</span></div>` : ''
      }<div class="row"><span>пополнения за год</span><span>${U.rub(fc.years[i].deposits)}</span></div>`,
      ariaLabel: 'Прогноз капитала',
    });
  }

  /* ================= АНАЛИТИКА ================= */
  function renderAnalytics() {
    const host = $('#view-analytics');
    const m = S.model;
    if (!m.positions.length) {
      host.innerHTML = `<div class="view-head"><div><h1>Аналитика</h1></div></div>` + emptyPortfolio();
      return;
    }
    const t = m.totals;
    const years = E.yearly(m);
    const cy = U.year(m.today);
    const open = m.positions.filter((p) => !p.closed);
    const def = E.defaultRate(m);
    const byKind = E.KINDS.map((k) => ({ k, v: U.sum(open.filter((p) => p.kind === k), (p) => p.mv) })).filter((x) => x.v > 0);
    const accMap = new Map();
    open.forEach((p) => {
      const a = p.accounts[0] || 'без счёта';
      accMap.set(a, (accMap.get(a) || 0) + p.mv);
    });
    const byAcc = [...accMap.entries()].map(([a, v], i) => ({ a, v, color: ['var(--bond)', 'var(--share)', 'var(--fund)'][i % 3] }));
    const mvSum = U.sum(byKind, (x) => x.v) || 1;
    const ladder = new Map();
    m.expected.filter((f) => f.type === 'redemption' || f.type === 'amortization').forEach((f) => {
      const y = U.year(f.date);
      if (!ladder.has(y)) ladder.set(y, { y, redemption: 0, amortization: 0, names: new Set() });
      const r = ladder.get(y);
      r[f.type] += f.amount;
      r.names.add(f.name);
    });
    const lad = [...ladder.values()].sort((a, b) => a.y - b.y);
    const top = m.positions.filter((p) => p.incomeGross > 0).sort((a, b) => b.incomeGross - a.incomeGross).slice(0, 8);
    const topMax = top.length ? top[0].incomeGross : 1;
    const bestMonth = (() => {
      const map = new Map();
      m.received.filter((f) => E.isIncome(f.type)).forEach((f) => map.set(f.date.slice(0, 7), (map.get(f.date.slice(0, 7)) || 0) + f.net));
      let best = null;
      map.forEach((v, k) => (!best || v > best.v) && (best = { k, v }));
      return best;
    })();

    host.innerHTML = `
      <div class="view-head"><div><h1>Аналитика</h1><div class="sub">Доход по годам, структура и график погашений</div></div></div>
      <div class="tiles">
        <article class="tile"><span class="label">Всего получено после налога</span><span class="value">${U.rub(t.incomeNet)}</span><span class="sub">до налога ${U.rub(t.incomeGross)} · налог ${U.rub(t.incomeTax)}</span></article>
        <article class="tile"><span class="label">Изменение цены бумаг</span><span class="value ${sgn(t.unreal)}">${U.rub(t.unreal, 0, { sign: true })}</span><span class="sub">${t.cost ? U.pct((t.unreal / t.cost) * 100, 1, { sign: true }) + ' к цене покупки' : ''}${t.realized ? ` · продажи ${U.rub(t.realized, 0, { sign: true })}` : ''}</span></article>
        <article class="tile"><span class="label">Средняя доходность к погашению</span><span class="value">${def ? U.pct(def, 1) : '—'}</span><span class="sub">по стоимости облигаций</span></article>
        <article class="tile"><span class="label">Лучший месяц</span><span class="value">${bestMonth ? U.rub(bestMonth.v) : '—'}</span><span class="sub">${bestMonth ? U.monthTitle(U.year(bestMonth.k), U.month0(bestMonth.k + '-01')) + ', после налога' : ''}</span></article>
      </div>
      <section class="card"><div class="card-head"><h2>Доход по годам</h2></div>
        ${
          years.length
            ? `<div class="legend"><span><span class="dot" style="background:var(--accent)"></span> после налога</span><span><span class="dot" style="background:var(--line-strong)"></span> налог</span></div>
        <div class="chart" id="yearChart"></div>
        <div class="table-wrap" style="border:0;margin-top:var(--s4)"><table class="data"><thead><tr><th>Год</th><th>Облигации</th><th>Акции</th><th>Фонды</th><th>До налога</th><th>Налог</th><th>После налога</th><th>В месяц</th></tr></thead><tbody>
        ${years
          .slice()
          .reverse()
          .map(
            (y) => `<tr style="cursor:default"><td>${y.year}${y.year === cy ? '<small>пока</small>' : ''}</td><td>${U.rub(y.byKind.bond)}</td><td>${U.rub(y.byKind.share)}</td><td>${U.rub(y.byKind.fund)}</td><td>${U.rub(y.gross)}</td><td>−${U.rub(y.tax)}</td><td><b>${U.rub(y.net)}</b></td><td>${U.rub(y.net / (y.year === cy ? U.month0(m.today) + 1 : 12))}</td></tr>`
          )
          .join('')}
        </tbody><tfoot><tr><td>Всего</td><td>${U.rub(U.sum(years, (y) => y.byKind.bond))}</td><td>${U.rub(U.sum(years, (y) => y.byKind.share))}</td><td>${U.rub(U.sum(years, (y) => y.byKind.fund))}</td><td>${U.rub(t.incomeGross)}</td><td>−${U.rub(t.incomeTax)}</td><td>${U.rub(t.incomeNet)}</td><td></td></tr></tfoot></table></div>`
            : '<p class="muted sm">Выплат ещё не было.</p>'
        }
      </section>
      <div class="grid-2">
        <section class="card"><div class="card-head"><h2>Структура портфеля</h2><span class="sm muted">${U.rub(t.mv)}</span></div>
          <div style="display:grid;gap:var(--s4)">
            <div><div class="label" style="margin-bottom:8px">По видам</div>
              <div class="segbar" role="img" aria-label="${byKind.map((x) => E.KIND[x.k].label + ' ' + Math.round((x.v / mvSum) * 100) + '%').join(', ')}">${byKind.map((x) => `<div style="flex:${x.v};background:var(--${x.k})" title="${E.KIND[x.k].label}: ${U.rub(x.v)}">${x.v / mvSum > 0.12 ? Math.round((x.v / mvSum) * 100) + '%' : ''}</div>`).join('')}</div>
              <div class="legend" style="margin:8px 0 0">${byKind.map((x) => `<span>${dot(x.k)} ${E.KIND[x.k].label} · ${U.rub(x.v)}</span>`).join('')}</div></div>
            ${
              byAcc.length > 1
                ? `<div><div class="label" style="margin-bottom:8px">По счетам</div><div class="segbar">${byAcc.map((x) => `<div style="flex:${x.v};background:${x.color}" title="${esc(x.a)}: ${U.rub(x.v)}">${x.v / mvSum > 0.12 ? Math.round((x.v / mvSum) * 100) + '%' : ''}</div>`).join('')}</div>
              <div class="legend" style="margin:8px 0 0">${byAcc.map((x) => `<span><span class="dot" style="background:${x.color}"></span> ${esc(x.a)} · ${U.rub(x.v)}</span>`).join('')}</div></div>`
                : ''
            }
          </div></section>
        <section class="card"><div class="card-head"><h2>Больше всего принесли</h2><span class="sm muted">до налога</span></div>
          ${top.length ? `<div class="hbars">${top.map((p) => `<div class="hbar"><span class="n">${dot(p.kind)} ${esc(p.name)}</span><div class="track"><div class="fill" style="width:${Math.max(2, (p.incomeGross / topMax) * 100)}%;background:var(--${p.kind})"></div></div><span class="v">${U.rub(p.incomeGross)}</span></div>`).join('')}</div>` : '<p class="muted sm">Выплат ещё не было.</p>'}
        </section>
      </div>
      <section class="card"><div class="card-head"><h2>Лестница погашений</h2><span class="sm muted">сколько номинала вернётся по годам</span></div>
        ${lad.length ? `<div class="legend"><span>${dot('bond')} погашение</span><span><span class="dot" style="background:var(--fund)"></span> амортизация</span></div><div class="chart" id="ladderChart"></div>` : '<p class="muted sm">Облигаций с датой погашения нет.</p>'}
      </section>`;

    if (years.length)
      C.bars($('#yearChart'), {
        labels: years.map((y) => String(y.year)),
        series: [
          { label: 'после налога', color: 'var(--accent)', values: years.map((y) => y.net) },
          { label: 'налог', color: 'var(--line-strong)', values: years.map((y) => y.tax) },
        ],
        height: 220,
        barWidth: 28,
        valueLabels: (i) => (i === years.length - 1 ? U.compact(years[i].net) : null),
        tooltip: (i) => `<b>${years[i].year}</b><div class="row"><span>до налога</span><span>${U.rub(years[i].gross)}</span></div><div class="row"><span>налог</span><span>−${U.rub(years[i].tax)}</span></div><div class="row"><span>после налога</span><span>${U.rub(years[i].net)}</span></div>`,
        ariaLabel: 'Пассивный доход по годам',
      });
    if (lad.length)
      C.bars($('#ladderChart'), {
        labels: lad.map((r) => String(r.y)),
        series: [
          { label: 'погашение', color: 'var(--bond)', values: lad.map((r) => r.redemption) },
          { label: 'амортизация', color: 'var(--fund)', values: lad.map((r) => r.amortization) },
        ],
        height: 220,
        tooltip: (i) => `<b>${lad[i].y}</b><div class="row"><span>${dot('bond')}погашение</span><span>${U.rub(lad[i].redemption)}</span></div>${lad[i].amortization ? `<div class="row"><span><span class="dot fund"></span>амортизация</span><span>${U.rub(lad[i].amortization)}</span></div>` : ''}<div class="xs muted" style="margin-top:4px">${[...lad[i].names].map(esc).join(', ')}</div>`,
        ariaLabel: 'Погашения по годам',
      });
  }

  /* ================= НАСТРОЙКИ ================= */
  function openSettings() {
    const s = S.settings;
    const dlg = $('#dlgSettings');
    const theme = U.lsGet('kk:theme', 'system');
    dlg.innerHTML = `<form class="dlg" id="setForm" novalidate>
      <div class="dlg-head"><h2 id="dlgSettingsTitle">Настройки</h2><button type="button" class="icon-btn" data-act="close-dlg" aria-label="Закрыть">${ICON.close}</button></div>
      <div class="dlg-body">
        <div class="form-grid">
          <label class="field"><span>Пополнение в день, ₽</span><input class="input num" id="sDaily" inputmode="numeric" value="${esc(s.dailyDeposit)}"><span class="hint">Используется в прогнозе</span></label>
          <label class="field"><span>Счета</span><input class="input" id="sAccounts" value="${esc((s.accounts || []).join(', '))}"><span class="hint">Через запятую</span></label>
          <label class="field"><span>Налог на купоны, %</span><input class="input num" id="sCt" inputmode="decimal" value="${esc(s.couponTax)}"></label>
          <label class="field"><span>Налог на дивиденды, %</span><input class="input num" id="sDt" inputmode="decimal" value="${esc(s.dividendTax)}"></label>
          <label class="check full"><input type="checkbox" id="sAuto" ${s.autoPayouts !== false ? 'checked' : ''}> Считать купоны, дивиденды и погашения по расписанию Мосбиржи, если их нет в отчётах</label>
          <label class="field full"><span>Оформление</span><select class="input" id="sTheme"><option value="system" ${theme === 'system' ? 'selected' : ''}>Как в системе</option><option value="light" ${theme === 'light' ? 'selected' : ''}>Светлое</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>Тёмное</option></select></label>
        </div>
        <p class="hint">Для нерезидента РФ: купоны 30%, дивиденды 15%. Если станете налоговым резидентом РФ, поставьте 13%: пересчитаются все суммы «после налога». Если налог уже удержан и это видно в отчёте, берётся удержанная сумма.</p>
        <div class="chips"><button type="button" class="btn sm" data-act="clear-cache">Обновить справочники Мосбиржи</button><button type="button" class="btn sm" data-act="export">${ICON.download} Экспорт всех операций</button></div>
        <div class="sm muted">${S.store.mode === 'demo' ? 'Пример портфеля в этом браузере.' : 'Вы вошли как ' + esc(S.store.user && S.store.user.email)}${M.status.via === 'proxy' ? ' · Мосбиржа через Supabase' : ''}</div>
      </div>
      <div class="dlg-foot">${
        S.store.mode === 'demo'
          ? `<button type="button" class="btn sm ghost left" data-act="demo-reset">Вернуть пример как был</button>`
          : `<button type="button" class="btn sm ghost danger left" data-act="sign-out">Выйти</button>`
      }<button type="button" class="btn" data-act="close-dlg">Отмена</button><button type="submit" class="btn primary">Сохранить</button></div></form>`;
    $('#setForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const next = {
        ...S.settings,
        dailyDeposit: Math.max(0, Math.round(U.parseNum($('#sDaily').value) || 0)),
        couponTax: Math.min(100, Math.max(0, U.parseNum($('#sCt').value) ?? 30)),
        dividendTax: Math.min(100, Math.max(0, U.parseNum($('#sDt').value) ?? 15)),
        accounts: $('#sAccounts').value.split(',').map((x) => x.trim()).filter(Boolean),
        autoPayouts: $('#sAuto').checked,
      };
      applyTheme($('#sTheme').value);
      U.lsSet('kk:theme', $('#sTheme').value);
      try {
        await S.store.saveSettings(next);
        const dailyChanged = next.dailyDeposit !== S.settings.dailyDeposit;
        S.settings = next;
        if (dailyChanged) S.fc.daily = next.dailyDeposit;
        dlg.close();
        buildAccountFilter();
        recompute();
        renderView();
        toast('Настройки сохранены');
      } catch (ex) {
        toast(ex.message, true);
      }
    });
    dlg.showModal();
  }
  function applyTheme(v) {
    if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v);
    else document.documentElement.removeAttribute('data-theme');
  }

  /* ================= действия ================= */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    const row = !b && e.target.closest('#assetTable tbody tr[data-secid]');
    const th = !b && e.target.closest('#assetTable th[data-sort]');
    if (row) return openAsset(row.dataset.secid);
    if (th) {
      const k = th.dataset.sort;
      if (S.assets.sort === k) S.assets.dir *= -1;
      else {
        S.assets.sort = k;
        S.assets.dir = (ASSET_COLS.find((c) => c.key === k) || {}).dir || -1;
      }
      return renderAssets();
    }
    if (!b) return;
    const act = b.dataset.act;
    const v = b.dataset.v;
    switch (act) {
      case 'add-op':
        return openOpDialog({ type: b.dataset.type, secid: b.dataset.secid });
      case 'edit-op':
        return openOpDialog({ op: S.ops.find((o) => o.id === b.dataset.id) });
      case 'del-op':
        S.hist.confirm = b.dataset.id;
        return renderHistory();
      case 'del-no':
        S.hist.confirm = null;
        return renderHistory();
      case 'del-yes':
        try {
          await S.store.deleteOps([b.dataset.id]);
          S.ops = S.ops.filter((o) => o.id !== b.dataset.id);
          S.hist.confirm = null;
          recompute();
          renderHistory();
          toast('Операция удалена');
        } catch (ex) {
          toast(ex.message, true);
        }
        return;
      case 'hist-type':
        S.hist.type = v;
        return renderHistory();
      case 'hist-src':
        S.hist.src = v;
        return renderHistory();
      case 'dep-toggle': {
        const i = S.hist.open.indexOf(v);
        if (i >= 0) S.hist.open.splice(i, 1);
        else S.hist.open.push(v);
        return renderHistory();
      }
      case 'hist-more':
        S.hist.limit += 12;
        return renderHistory();
      case 'import':
        return openImport();
      case 'imp-back':
        IMP.step = 'pick';
        return renderImport();
      case 'imp-save':
        return saveImport();
      case 'imp-filter':
        IMP.filter = v;
        IMP.limit = 150;
        return renderImport();
      case 'imp-more':
        IMP.limit += 150;
        return renderImport();
      case 'template':
        return download('kupon-shablon.csv', I.toCSV([{ op_date: TODAY(), op_type: 'buy', secid: 'SU26238RMFS4', name: 'ОФЗ 26238', asset_type: 'bond', account: accounts()[0], quantity: 2, price: 612.3, price_pct: 61.23, accrued_interest: 14.2, fee: 3.67, amount: 1224.6 }]), 'text/csv;charset=utf-8');
      case 'export': {
        const ops = S.ops.slice().sort((a, b) => (a.op_date < b.op_date ? -1 : 1));
        return download(`kupon-operacii-${TODAY()}.csv`, I.toCSV(ops), 'text/csv;charset=utf-8');
      }
      case 'close-dlg':
        return b.closest('dialog').close();
      case 'close-drawer':
        return closeDrawer();
      case 'op-type':
        readForm();
        F.type = v;
        return renderOpDialog();
      case 'price-mode': {
        readForm();
        const c = computeTrade();
        F.priceMode = v;
        if (c.priceRub != null) F.price = v === 'pct' ? String(U.round2(c.pct)).replace('.', ',') : String(U.round2(c.priceRub)).replace('.', ',');
        return renderOpDialog();
      }
      case 'kind':
        S.assets.kind = v;
        return renderAssets();
      case 'year':
        S.year += Number(b.dataset.d);
        S.monthYear = null;
        return renderMonths();
      case 'net':
        S.net = v === '1';
        return renderMonths();
      case 'fc-daily':
        S.fc.daily = Number(v);
        $('#fcDaily').value = v;
        $('#fcRange').value = v;
        $$('[data-act="fc-daily"]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === v));
        return renderFcResults();
      case 'fc-jan':
        S.fc.start = `${U.year(TODAY()) + 1}-01-01`;
        $('#fcStart').value = S.fc.start;
        return renderFcResults();
      case 'fc-years':
        S.fc.years = Number(v);
        $$('[data-act="fc-years"]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === v));
        return renderFcResults();
      case 'fc-rate-reset':
        S.fc.rate = null;
        return renderForecast();
      case 'fc-save-daily': {
        const next = { ...S.settings, dailyDeposit: S.fc.daily };
        try {
          await S.store.saveSettings(next);
          S.settings = next;
          renderFcResults();
          toast(`Ежедневное пополнение: ${U.rub(S.fc.daily)}`);
        } catch (ex) {
          toast(ex.message, true);
        }
        return;
      }
      case 'refresh-moex':
        return loadMarket({ force: true });
      case 'clear-cache':
        M.clearCache();
        b.closest('dialog').close();
        toast('Загружаю свежие данные Мосбиржи');
        return loadMarket({ force: true });
      case 'leave-demo':
        U.lsDel('kk:demo');
        return location.reload();
      case 'demo-reset':
        S.store.reset();
        return location.reload();
      case 'sign-out':
        await S.store.signOut();
        return location.reload();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer();
    const row = e.target.closest && e.target.closest('#assetTable tbody tr[data-secid]');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openAsset(row.dataset.secid);
    }
    const th = e.target.closest && e.target.closest('#assetTable th[data-sort]');
    if (th && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      th.click();
    }
  });
  $('#settingsBtn').addEventListener('click', openSettings);

  boot();
})();
