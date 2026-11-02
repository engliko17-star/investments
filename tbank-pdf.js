/* Купонная книжка — чтение брокерского отчёта Т-Банка в PDF.
   Отчёт формируется по месяцам, поэтому за раз можно загрузить сразу много файлов.
   Берём из отчёта:
     1.1  сделки (дата, бумага, цена, количество, НКД, комиссия брокера, номер сделки);
     2    движение денег (пополнения, купоны, амортизация, погашения, дивиденды, налог);
     3.1  остатки бумаг на конец месяца — для сверки;
     4.1  справочник бумаг (код, ISIN, тип).
   parseItems — чистая функция над текстом с координатами, её можно проверить без браузера. */
(function (root) {
  'use strict';
  const KK = (root.KK = root.KK || {});
  const T = (KK.tbank = {});

  /* ---------- мелочи ---------- */
  const norm = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();
  const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;
  const isoDate = (s) => {
    const m = String(s || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  const isoFromEng = (s) => {
    const m = String(s || '').match(/(\d{2})-([A-Z]{3})-(\d{2})/i);
    return m && MON[m[2].toUpperCase()] ? `20${m[3]}-${MON[m[2].toUpperCase()]}-${m[1]}` : null;
  };
  /* «1,000.00» и «1 000,00» → число */
  const num = (v) => {
    if (v == null) return null;
    let s = String(v).replace(/[\s ]/g, '');
    if (!s) return null;
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : null;
  };
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  T.hash = hash;
  const looksIsin = (c) => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(String(c || ''));
  T.looksIsin = looksIsin;

  /* ширина символа в долях: нужна, чтобы разрезать склеенные ячейки на слова */
  function cw(ch) {
    if (ch === ' ') return 0.55;
    if (/[.,:;/|'()\-]/.test(ch)) return 0.5;
    if (/[0-9]/.test(ch)) return 1;
    if (/[A-ZА-ЯЁ%]/.test(ch)) return 1.3;
    return 1;
  }
  /* элемент текста → слова с оценкой координат */
  function words(it) {
    const chars = [...it.s];
    const ws = chars.map(cw);
    const total = ws.reduce((a, b) => a + b, 0) || 1;
    const k = it.w / total;
    const out = [];
    let pos = 0;
    let cur = null;
    chars.forEach((ch, i) => {
      const x = it.x + pos * k;
      pos += ws[i];
      if (/\s/.test(ch)) {
        if (cur) out.push(cur);
        cur = null;
        return;
      }
      if (!cur) cur = { s: '', x0: x, x1: x, y: it.y };
      cur.s += ch;
      cur.x1 = it.x + pos * k;
    });
    if (cur) out.push(cur);
    out.forEach((w) => (w.xc = (w.x0 + w.x1) / 2));
    return out;
  }

  /* строки страницы: горизонтальный текст, сгруппированный по высоте */
  function pageLines(items) {
    const hz = items.filter((i) => Math.abs(i.rot || 0) < 5 && i.s && i.s.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of hz) {
      let ln = lines.length ? lines[lines.length - 1] : null;
      if (!ln || Math.abs(ln.y - it.y) > 1.5) {
        ln = { y: it.y, items: [] };
        lines.push(ln);
      }
      ln.items.push(it);
    }
    for (const ln of lines) {
      ln.items.sort((a, b) => a.x - b.x);
      ln.text = ln.items.map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim();
      ln.x = ln.items[0].x;
      ln.words = ln.items.flatMap(words);
    }
    return lines;
  }

  /* ---------- колонки ---------- */
  function colOf(cols, xc) {
    let c = null;
    for (const col of cols) if (col.left <= xc) c = col;
    return c;
  }
  /* колонки по горизонтальной шапке: ищем первые слова подписей по порядку */
  function hzColumns(headerLines, spec) {
    const ws = headerLines.flatMap((l) => l.words).sort((a, b) => a.x0 - b.x0);
    const cols = [];
    let from = 0;
    let lastX = -Infinity;
    for (const [key, first] of spec) {
      const f = norm(first);
      let idx = -1;
      for (let i = from; i < ws.length; i++) {
        if (ws[i].x0 > lastX + 4 && norm(ws[i].s).startsWith(f)) {
          idx = i;
          break;
        }
      }
      if (idx < 0) return null;
      cols.push({ key, left: ws[idx].x0 - 2.5 });
      lastX = ws[idx].x0;
      from = idx + 1;
    }
    return cols;
  }
  /* колонки по вертикальной шапке таблицы сделок */
  const TRADE_COLS = [
    ['dealNo', /^номер сделки/],
    ['orderNo', /^номер поручения/],
    ['flag', /^признак/],
    ['date', /^дата заключения/],
    ['time', /^время/],
    ['venue', /^торговая/],
    ['side', /^вид сделки/],
    ['name', /^наименование/],
    ['code', /^код актива/],
    ['price', /^цена за единицу/],
    ['priceCur', /^валюта цены/],
    ['qty', /^количество/],
    ['sum', /^сумма \(без нкд\)|^сумма без нкд/],
    ['nkd', /^нкд/],
    ['total', /^сумма сделки/],
    ['settleCur', /^валюта расчетов/],
    ['feeBroker', /^комиссия брокера/],
    ['feeExch', /^комиссия биржи/],
    ['feeClear', /^комиссия клир/],
    ['settleDate', /^дата расчетов/],
    ['deliveryDate', /^дата поставки/],
  ];
  function vtColumns(vItems) {
    const v = vItems.slice().sort((a, b) => a.x - b.x);
    const groups = [];
    for (const it of v) {
      const g = groups.length ? groups[groups.length - 1] : null;
      if (g && it.x - g.maxX < 11) {
        g.parts.push(it.s);
        g.maxX = it.x;
      } else groups.push({ minX: it.x, maxX: it.x, parts: [it.s] });
    }
    return groups.map((g) => {
      const label = norm(g.parts.join(' '));
      const hit = TRADE_COLS.find(([, re]) => re.test(label));
      return { key: hit ? hit[0] : 'x:' + label, label, left: g.minX - 6 };
    });
  }

  /* текст ячеек строки таблицы: слова раскладываются по колонкам сверху вниз */
  const GLUE = new Set(['dealNo', 'orderNo', 'code', 'isin']);
  function cells(lines, cols) {
    const out = {};
    for (const ln of lines.slice().sort((a, b) => a.y - b.y))
      for (const w of ln.words.slice().sort((a, b) => a.x0 - b.x0)) {
        const c = colOf(cols, w.xc);
        if (!c) continue;
        const prev = out[c.key];
        if (prev == null) out[c.key] = w.s;
        else if (GLUE.has(c.key) || /-$/.test(prev)) out[c.key] = prev + w.s;
        else out[c.key] = prev + ' ' + w.s;
      }
    return out;
  }

  /* ---------- главный разбор ---------- */
  const SECTION = [
    [/^1\.1\s/, 'trades'],
    [/^1\.[2-9]\s/, 'skip'],
    [/^2\.\s/, 'cash'],
    [/^3\.1\s/, 'holdings'],
    [/^3\.[2-9]\s/, 'skip'],
    [/^4\.1\s/, 'secref'],
    [/^4\.[2-9]\s/, 'skip'],
    [/^[5-9]\.\s/, 'skip'],
  ];
  const CASH_SPEC = [
    ['date', 'Дата'],
    ['time', 'Время'],
    ['execDate', 'Дата'],
    ['op', 'Операция'],
    ['in', 'Сумма'],
    ['out', 'Сумма'],
    ['note', 'Примечание'],
  ];
  const HOLD_SPEC = [
    ['name', 'Наименование'],
    ['code', 'Код'],
    ['isin', 'ISIN'],
    ['place', 'Место'],
    ['in', 'Входящий'],
    ['credit', 'Зачисление'],
    ['debit', 'Списание'],
    ['out', 'Исходящий'],
    ['planned', 'Плановый'],
  ];
  const REF_SPEC = [
    ['name', 'Наименование'],
    ['code', 'Код'],
    ['isin', 'ISIN'],
    ['reg', 'Код'],
    ['type', 'Тип'],
    ['issuer', 'Наименование'],
  ];

  T.parseItems = function (pages) {
    const res = { period: null, contract: null, tradeRows: [], cash: [], holdings: [], secRef: [] };
    const st = { section: null, tradeCols: null, cashCols: null, cashCur: null, holdCols: null, refCols: null, lastTrade: null, lastCash: null };

    pages.forEach((page) => {
      const lines = pageLines(page.items).filter((l) => !/^\d+ из \d+$/.test(l.text));
      const vItems = page.items.filter((i) => Math.abs(Math.abs(i.rot || 0) - 90) < 5 && i.s && i.s.trim());

      for (const ln of lines) {
        if (!res.period) {
          const m = ln.text.match(/за период\s+(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/i);
          if (m) res.period = { from: isoDate(m[1]), to: isoDate(m[2]) };
        }
        if (!res.contract) {
          const m = ln.text.match(/Инвестор:.*\/\s*([0-9A-Za-z-]{5,})\s+от\s+(\d{2}\.\d{2}\.\d{4})/);
          if (m) res.contract = { key: hash('tb:' + m[1]), tail: m[1].slice(-4), since: isoDate(m[2]) };
        }
      }

      // участки страницы между заголовками разделов
      const segs = [];
      let cur = { section: st.section, lines: [], fresh: false, titleY: -Infinity };
      for (const ln of lines) {
        const hit = ln.x < 20 && SECTION.find(([re]) => re.test(ln.text));
        if (hit) {
          segs.push(cur);
          st.section = hit[1];
          cur = { section: hit[1], lines: [], fresh: true, titleY: ln.y };
          continue;
        }
        cur.lines.push(ln);
      }
      segs.push(cur);

      for (const seg of segs) {
        if (seg.fresh) {
          if (seg.section === 'trades') (st.tradeCols = null), (st.lastTrade = null);
          if (seg.section === 'cash') (st.cashCols = null), (st.cashCur = null), (st.lastCash = null);
          if (seg.section === 'holdings') st.holdCols = null;
          if (seg.section === 'secref') st.refCols = null;
        }
        if (!seg.lines.length) continue;
        if (seg.section === 'trades') doTrades(seg, vItems, st, res);
        else if (seg.section === 'cash') doCash(seg, st, res);
        else if (seg.section === 'holdings') doTable(seg, st, res, 'holdCols', HOLD_SPEC, res.holdings, holdRow);
        else if (seg.section === 'secref') doTable(seg, st, res, 'refCols', REF_SPEC, res.secRef, refRow);
      }
    });
    return finish(res);
  };

  function doTrades(seg, vItems, st, res) {
    const L = seg.lines;
    const yEnd = L[L.length - 1].y + 1;
    const vh = vItems.filter((v) => v.y > seg.titleY && v.y <= yEnd);
    if (vh.length >= 8) {
      const c = vtColumns(vh);
      if (c.some((x) => x.key === 'date') && c.some((x) => x.key === 'code')) st.tradeCols = c;
    }
    const cols = st.tradeCols;
    if (!cols) return;
    const dateCol = cols.find((c) => c.key === 'date');
    const anchors = L.filter((ln) => ln.words.some((w) => colOf(cols, w.xc) === dateCol && DATE_RE.test(w.s)));
    const firstY = anchors.length ? anchors[0].y : Infinity;
    if (!seg.fresh && st.lastTrade) st.lastTrade.lines.push(...L.filter((ln) => ln.y < firstY - 1));
    anchors.forEach((a, k) => {
      const end = k + 1 < anchors.length ? anchors[k + 1].y - 1 : Infinity;
      const row = { lines: L.filter((ln) => ln.y >= a.y - 1 && ln.y < end), cols };
      res.tradeRows.push(row);
      st.lastTrade = row;
    });
  }

  function doCash(seg, st, res) {
    let buf = [];
    let atTop = !seg.fresh; // строки в начале страницы продолжают таблицу с прошлой страницы
    const flush = () => {
      if (buf.length && st.cashCols) parseCash(buf, st, res, atTop);
      buf = [];
      atTop = false;
    };
    const L = seg.lines;
    for (let k = 0; k < L.length; k++) {
      const ln = L[k];
      const t = ln.text.trim();
      if (/^(RUB|USD|EUR|CNY|HKD|GBP|CHF|TRY|KZT|BYN|AMD)$/.test(t)) {
        flush();
        st.cashCur = t;
        st.cashCols = null;
        continue;
      }
      const bal = !st.cashCols && t.match(/^RUB\s+(-?[\d.,]+)\s+(-?[\d.,]+)/);
      if (bal && !res.balance) {
        res.balance = { opening: num(bal[1]), closing: num(bal[2]) };
        continue;
      }
      const tl = norm(t);
      if (/(^| )дата( |$)/.test(tl) && tl.includes('операция') && tl.includes('сумма зачисления')) {
        flush();
        const head = [ln];
        const nx = L[k + 1];
        if (nx && nx.y - ln.y < 13 && !nx.words.some((w) => DATE_RE.test(w.s))) head.push(nx);
        st.cashCols = hzColumns(head, CASH_SPEC);
        k += head.length - 1;
        continue;
      }
      if (st.cashCols) buf.push(ln);
    }
    flush();
  }

  /* таблица движения денег */
  function parseCash(L, st, res, continued) {
    const cols = st.cashCols;
    const col = (k) => cols.find((c) => c.key === k);
    const execCol = col('execDate');
    const noteCol = col('note');
    const opCol = col('op');
    const anchors = L.filter((ln) => ln.words.some((w) => colOf(cols, w.xc) === execCol && DATE_RE.test(w.s)));
    const rows = anchors.map((a) => {
      const onLine = (key) =>
        a.words
          .filter((w) => {
            const c = colOf(cols, w.xc);
            return c && c.key === key;
          })
          .map((w) => w.s)
          .join(' ');
      const opWords = L.filter((ln) => Math.abs(ln.y - a.y) <= 10)
        .flatMap((ln) => ln.words)
        .filter((w) => colOf(cols, w.xc) === opCol)
        .sort((p, q) => p.y - q.y || p.x0 - q.x0)
        .map((w) => w.s);
      return {
        y: a.y,
        date: onLine('date'),
        time: onLine('time'),
        execDate: onLine('execDate'),
        op: opWords.join(' '),
        in: num(onLine('in')),
        out: num(onLine('out')),
        note: '',
        cur: st.cashCur || 'RUB',
      };
    });
    // примечания: блоки строк в последней колонке
    const noteLines = L.map((ln) => ({
      y: ln.y,
      s: ln.words
        .filter((w) => colOf(cols, w.xc) === noteCol)
        .map((w) => w.s)
        .join(' '),
    })).filter((x) => x.s);
    const blocks = [];
    for (const nl of noteLines) {
      const b = blocks.length ? blocks[blocks.length - 1] : null;
      if (!b || /^Тип КД/i.test(nl.s) || nl.y - b.y1 > 15) blocks.push({ y0: nl.y, y1: nl.y, parts: [nl.s] });
      else {
        b.parts.push(nl.s);
        b.y1 = nl.y;
      }
    }
    for (const b of blocks) {
      const mid = (b.y0 + b.y1) / 2;
      let best = null;
      for (const r of rows) if (r.y >= b.y0 - 8 && r.y <= b.y1 + 8 && (!best || Math.abs(r.y - mid) < Math.abs(best.y - mid))) best = r;
      const text = b.parts.join(' ').replace(/\s+/g, ' ').trim();
      if (best) best.note = best.note ? best.note + ' ' + text : text;
      else if (continued && st.lastCash && !rows.some((r) => r.y < b.y0)) st.lastCash.note = (st.lastCash.note + ' ' + text).trim();
    }
    for (const r of rows) {
      res.cash.push(r);
      st.lastCash = r;
    }
  }

  function doTable(seg, st, res, colKey, spec, out, toRow) {
    const L = seg.lines;
    let start = 0;
    const headIdx = L.findIndex((ln) => /наименование актива/.test(norm(ln.text)) && /код актива/.test(norm(ln.text)));
    if (headIdx >= 0) {
      const head = [L[headIdx]];
      const nx = L[headIdx + 1];
      if (nx && nx.y - L[headIdx].y < 13 && !nx.words.some((w) => /^[A-Z]{2}[A-Z0-9]{6,}/.test(w.s))) head.push(nx);
      const c = hzColumns(head, spec);
      if (c) st[colKey] = c;
      start = headIdx + head.length;
    } else if (seg.fresh) return;
    const cols = st[colKey];
    if (!cols) return;
    const codeCol = cols.find((c) => c.key === 'code');
    const body = L.slice(start);
    const anchors = body.filter((ln) => ln.words.some((w) => colOf(cols, w.xc) === codeCol && /^[A-Z0-9]{3,}/.test(w.s)));
    anchors.forEach((a, k) => {
      const end = k + 1 < anchors.length ? anchors[k + 1].y - 1 : a.y + 26;
      const c = cells(
        body.filter((ln) => ln.y >= a.y - 1 && ln.y < end),
        cols
      );
      if (c.code) out.push(toRow(c));
    });
  }
  const holdRow = (c) => ({ name: c.name || '', code: c.code, isin: c.isin || '', in: num(c.in), credit: num(c.credit), debit: num(c.debit), out: num(c.out), planned: num(c.planned) });
  const refRow = (c) => ({ name: c.name || '', code: c.code, isin: c.isin || '', type: norm(c.type), issuer: c.issuer || '' });

  /* тип бумаги по справочнику Т-Банка */
  function kindOfType(t) {
    t = norm(t);
    if (!t) return null;
    if (/обл/.test(t)) return 'bond';
    if (/пай|фонд|etf|бпиф|паи|ипиф|зпиф/.test(t)) return 'fund';
    if (/акц|ао|ап|депозитар|расписк/.test(t)) return 'share';
    return null;
  }
  T.kindOfType = kindOfType;

  /* вид операции по «Тип КД» из примечания */
  function payoutType(text) {
    const t = norm(text);
    if (/частичн\S* погаш|амортиз/.test(t)) return 'amortization';
    if (/погаш/.test(t)) return 'redemption';
    if (/дивиденд/.test(t)) return 'dividend';
    if (/купон|дохода? по облигац|процент/.test(t)) return 'coupon';
    return null;
  }
  T.payoutType = payoutType;

  /* ---------- сборка операций ---------- */
  function finish(res) {
    const acct = res.contract ? res.contract.key : 'nokey';
    const ops = [];
    const skipped = [];
    const ignored = { trades: 0, transfers: 0 };

    /* справочник: ISIN → код, код → тип */
    const isinMap = {};
    const types = {};
    const names = {};
    const remember = (code, isin, name, type) => {
      if (!code) return;
      if (isin) {
        const prev = isinMap[isin];
        if (!prev || (looksIsin(prev) && !looksIsin(code))) isinMap[isin] = code;
      }
      if (type && kindOfType(type)) types[code] = kindOfType(type);
      if (name && !names[code]) names[code] = name;
    };
    res.holdings.forEach((h) => remember(h.code, h.isin, h.name));
    res.secRef.forEach((s) => remember(s.code, s.isin, s.name, s.type));

    /* 1.1 сделки */
    for (const row of res.tradeRows) {
      const c = cells(row.lines, row.cols);
      const date = isoDate(c.date);
      const side = norm(c.side);
      const type = /покуп/.test(side) ? 'buy' : /прода/.test(side) ? 'sell' : null;
      const qty = num(c.qty);
      if (!date || !type || !(qty > 0) || !c.code) {
        skipped.push({ date, text: `Сделка ${c.dealNo || ''} ${c.name || ''}`.trim(), reason: 'не удалось прочитать строку' });
        continue;
      }
      const priceCur = norm(c.priceCur);
      const settleCur = norm(c.settleCur);
      if (settleCur && !/rub|руб|sur/.test(settleCur)) {
        skipped.push({ date, text: `${c.name || c.code} — сделка не в рублях`, reason: 'валюта' });
        continue;
      }
      const price = num(c.price);
      const sum = num(c.sum);
      const nkd = num(c.nkd) || 0;
      const bond = priceCur === '%';
      const priceRub = sum != null ? sum / qty : bond ? null : price;
      ops.push({
        op_date: date,
        op_type: type,
        code: c.code,
        name: (c.name || '').replace(/\s+/g, ' ').trim() || null,
        quantity: qty,
        price: priceRub != null ? Math.round(priceRub * 1e4) / 1e4 : null,
        price_pct: bond ? price : null,
        accrued_interest: Math.abs(nkd),
        fee: Math.abs(num(c.feeBroker) || 0),
        amount: sum != null ? Math.abs(sum) : priceRub != null ? r2(priceRub * qty) : null,
        asset_hint: bond ? 'bond' : null,
        import_key: c.dealNo ? 'tb:' + c.dealNo : 'tb:' + hash([acct, date, type, c.code, qty, price, sum].join('|')),
        settle: isoDate(c.settleDate),
      });
    }

    /* 2 движение денег */
    const seen = new Map();
    for (const r of res.cash) {
      const date = isoDate(r.date) || isoDate(r.execDate);
      if (!date) continue;
      const op = norm(r.op);
      const note = r.note || '';
      const amountIn = r.in || 0;
      const amountOut = r.out || 0;
      const base = [date, r.time, isoDate(r.execDate), op, amountIn, amountOut, note.slice(0, 120)].join('|');
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      const key = 'tbc:' + acct + ':' + hash(base) + (n > 1 ? '#' + n : '');
      if (r.cur && r.cur !== 'RUB') {
        if (amountIn || amountOut) skipped.push({ date, text: r.op + ' (' + r.cur + ')', amount: amountIn - amountOut, reason: 'не рубли' });
        continue;
      }
      if (/покупка\/продажа|комиссия за сделк|^dfp|^rfp|^dvp|^rvp|^net\//.test(op)) {
        ignored.trades++;
        continue;
      }
      if (/перевод/.test(op)) {
        ignored.transfers++;
        skipped.push({ date, text: r.op, amount: amountIn - amountOut, reason: 'перевод между счетами' });
        continue;
      }
      if (/пополнение/.test(op)) {
        ops.push({ op_date: date, op_type: 'deposit', amount: amountIn, note: null, import_key: key });
        continue;
      }
      if (/вывод/.test(op)) {
        ops.push({ op_date: date, op_type: 'withdrawal', amount: amountOut, note: r.op, import_key: key });
        continue;
      }
      if (/налог|ндфл/.test(op) || /налог|ндфл/i.test(note.slice(0, 40))) {
        ops.push({ op_date: date, op_type: 'tax', amount: amountOut || amountIn, note: (r.op + (note ? ' — ' + note : '')).slice(0, 300), import_key: key, refund: !amountOut && amountIn > 0 });
        continue;
      }
      if (/выплата|корпоратив|купон|дивиденд|погашен/.test(op)) {
        const kd = (note.match(/Тип КД:\s*([^,]+)/i) || [])[1] || r.op;
        const t = payoutType(kd) || payoutType(r.op);
        if (!t) {
          skipped.push({ date, text: r.op + (note ? ' — ' + note.slice(0, 80) : ''), amount: amountIn, reason: 'неизвестный вид выплаты' });
          continue;
        }
        const isin = (note.match(/ISIN:\s*([A-Z]{2}[A-Z0-9]{9}\d)/) || [])[1] || null;
        const name = ((note.match(/Наименование:\s*(.+?),\s*(ISIN|Референс|Дата|Количество)/) || [])[1] || '').trim() || null;
        const qty = num((note.match(/Количество:\s*(\d+(?:[.,]\d+)?)\s*шт/) || [])[1]);
        const per = num((note.match(/Выплата на 1 бумагу:\s*(\d+(?:[.,]\d+)?)/) || [])[1]);
        const ref = (note.match(/Референс КД:\s*(\d+)/) || [])[1] || null;
        const record = isoFromEng((note.match(/Дата фиксации:\s*(\d{2}-[A-Za-z]{3}-\d{2})/) || [])[1]);
        let amount = amountIn;
        let tax = null;
        if (per && qty && per * qty > amountIn + 0.5 && (t === 'coupon' || t === 'dividend')) {
          amount = r2(per * qty);
          tax = r2(amount - amountIn);
        }
        ops.push({
          op_date: date,
          op_type: t,
          code: isin ? isinMap[isin] || isin : null,
          isin,
          name,
          quantity: qty,
          amount,
          tax,
          per,
          record,
          note: kd.trim() + (record ? ', фиксация ' + record.split('-').reverse().join('.') : ''),
          import_key: ref ? 'tbkd:' + acct + ':' + ref + ':' + t : key,
          unresolved: !isin && !name,
        });
        continue;
      }
      if (/комисси|обслуживан|плата за/.test(op)) {
        ops.push({ op_date: date, op_type: 'fee', amount: amountOut, note: r.op, import_key: key });
        continue;
      }
      if (amountIn || amountOut) skipped.push({ date, text: r.op + (note ? ' — ' + note.slice(0, 80) : ''), amount: amountIn - amountOut, reason: 'не распознано' });
    }

    /* коды: ISIN → код биржи, типы и названия из справочника */
    for (const o of ops) {
      if (!o.code) continue;
      if (looksIsin(o.code) && isinMap[o.code]) o.code = isinMap[o.code];
      if (!o.isin) {
        const isin = Object.keys(isinMap).find((k) => isinMap[k] === o.code);
        if (isin) o.isin = isin;
      }
      if (types[o.code]) o.asset_hint = types[o.code];
      else if (!o.asset_hint && (o.op_type === 'coupon' || o.op_type === 'amortization' || o.op_type === 'redemption')) o.asset_hint = 'bond';
      if (names[o.code] && !o.name) o.name = names[o.code];
    }
    ops.sort((a, b) => (a.op_date < b.op_date ? -1 : a.op_date > b.op_date ? 1 : 0));

    /* самопроверка: входящий остаток + зачисления − списания = исходящий остаток */
    let cashCheck = null;
    if (res.balance && res.balance.opening != null && res.balance.closing != null) {
      const rub = res.cash.filter((r) => (r.cur || 'RUB') === 'RUB');
      const computed = r2(res.balance.opening + rub.reduce((a, r) => a + (r.in || 0) - (r.out || 0), 0));
      cashCheck = { opening: res.balance.opening, closing: res.balance.closing, computed, ok: Math.abs(computed - res.balance.closing) < 0.05 };
    }

    return {
      format: 'tbank-pdf',
      period: res.period,
      contract: res.contract,
      cashCheck,
      cashRows: res.cash.length,
      acct,
      ops,
      skipped,
      ignored,
      holdings: res.holdings,
      secRef: res.secRef,
      isinMap,
      types,
      names,
    };
  }

  /* ---------- PDF → текст с координатами (pdf.js, лежит рядом с сайтом) ---------- */
  let pdfjsPromise = null;
  function loadPdfjs() {
    if (!pdfjsPromise) {
      const base = typeof document !== 'undefined' ? document.baseURI : '';
      // файлы pdf.js лежат рядом с сайтом; на всякий случай проверяем и папку vendor/pdfjs
      const dirs = ['', 'vendor/pdfjs/'];
      pdfjsPromise = (async () => {
        let err;
        for (const d of dirs) {
          try {
            const m = await import(new URL(d + 'pdf.min.mjs', base).href);
            m.GlobalWorkerOptions.workerSrc = new URL(d + 'pdf.worker.min.mjs', base).href;
            return m;
          } catch (e) {
            err = e;
          }
        }
        pdfjsPromise = null;
        throw new Error('Не загрузилась программа для чтения PDF: проверьте, что на GitHub лежат файлы pdf.min.mjs и pdf.worker.min.mjs. ' + (err ? err.message : ''));
      })();
    }
    return pdfjsPromise;
  }
  T.loadPdfjs = loadPdfjs;

  T.extractItems = async function (data, pdfjs) {
    pdfjs = pdfjs || (await loadPdfjs());
    const task = pdfjs.getDocument({ data, isEvalSupported: false });
    const doc = await task.promise;
    const pages = [];
    try {
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const items = [];
        for (const it of tc.items) {
          if (!it.str || !it.str.trim()) continue;
          const m = pdfjs.Util.transform(vp.transform, it.transform);
          items.push({ s: it.str, x: m[4], y: m[5], w: it.width, rot: Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI) });
        }
        pages.push({ items });
        if (page.cleanup) page.cleanup();
      }
    } finally {
      try {
        await task.destroy();
      } catch (e) {}
    }
    return pages;
  };

  T.parse = async function (file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const pages = await T.extractItems(buf);
    const text = pages.map((p) => p.items.map((i) => i.s).join(' ')).join(' ');
    if (!/ТБАНК|ТБанк|Т-Банк|Тинькофф/i.test(text) || !/Отчет о сделках и операциях/i.test(text)) {
      const e = new Error('Это не похоже на брокерский отчёт Т-Банка.');
      e.code = 'not_tbank';
      throw e;
    }
    return T.parseItems(pages);
  };

  T._internals = { pageLines, words, hzColumns, vtColumns, cells, colOf, norm, num, isoDate, isoFromEng };
})(typeof window !== 'undefined' ? window : globalThis);
