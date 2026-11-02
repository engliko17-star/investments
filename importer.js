/* Купонная книжка — разбор выписок.
   Понимает: брокерский отчёт Т-Банка (xlsx), CSV/XLSX, выгруженные с этого сайта,
   и простые таблицы с колонками «Дата / Операция / Тикер / Количество / Цена / Сумма». */
(function () {
  'use strict';
  const KK = (window.KK = window.KK || {});
  const U = KK.util;
  const I = (KK.importer = {});

  const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  let xlsxPromise = null;
  I.loadXLSX = () => {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxPromise)
      xlsxPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = XLSX_SRC;
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => {
          xlsxPromise = null;
          reject(new Error('Не загрузилась библиотека для чтения Excel. Проверьте интернет.'));
        };
        document.head.appendChild(s);
      });
    return xlsxPromise;
  };

  /* ---------- колонки нашего CSV (экспорт и шаблон) ---------- */
  I.CSV_COLUMNS = [
    ['op_date', 'Дата'],
    ['op_type', 'Тип'],
    ['secid', 'Код'],
    ['isin', 'ISIN'],
    ['name', 'Название'],
    ['asset_type', 'Вид актива'],
    ['account', 'Счёт'],
    ['quantity', 'Количество'],
    ['price', 'Цена, ₽'],
    ['price_pct', 'Цена, %'],
    ['accrued_interest', 'НКД, ₽'],
    ['fee', 'Комиссия, ₽'],
    ['amount', 'Сумма, ₽'],
    ['tax', 'Налог, ₽'],
    ['note', 'Примечание'],
    ['import_key', 'Ключ'],
  ];
  const ASSET_RU = { bond: 'Облигация', share: 'Акция', fund: 'Фонд' };

  I.toCSV = (ops) => {
    const E = KK.engine;
    const q = (v) => {
      if (v == null) return '';
      const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
      return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [I.CSV_COLUMNS.map((c) => c[1]).join(';')];
    for (const o of ops) {
      lines.push(
        I.CSV_COLUMNS.map(([k]) => {
          if (k === 'op_type') return q(E.OP[o.op_type] || o.op_type);
          if (k === 'asset_type') return q(ASSET_RU[o.asset_type] || o.asset_type);
          if (k === 'op_date') return q(U.date(o.op_date));
          return q(o[k]);
        }).join(';')
      );
    }
    return '﻿' + lines.join('\r\n');
  };

  /* CSV без сторонних библиотек: кавычки, переносы внутри кавычек, ; или , */
  function parseCSV(text, FS) {
    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else q = false;
        } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === FS) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        cell = '';
        if (row.some((c) => c !== '')) rows.push(row.map((c) => (c === '' ? null : c)));
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some((c) => c !== '')) rows.push(row.map((c) => (c === '' ? null : c)));
    return rows;
  }
  I.parseCSV = parseCSV;

  /* ---------- чтение файла в таблицы ---------- */
  async function readSheets(file) {
    const buf = await file.arrayBuffer();
    if (/\.(csv|txt)$/i.test(file.name)) {
      let text = new TextDecoder('utf-8').decode(buf);
      if ((text.match(/�/g) || []).length > 3) text = new TextDecoder('windows-1251').decode(buf);
      text = text.replace(/^﻿/, '');
      const firstLine = text.split(/\r?\n/)[0] || '';
      const FS = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
      return [{ name: file.name, rows: parseCSV(text, FS) }];
    }
    const XLSX = await I.loadXLSX();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    return wb.SheetNames.map((n) => ({
      name: n,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: true, blankrows: false }),
    }));
  }

  const norm = (v) =>
    String(v ?? '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[\s ]+/g, ' ')
      .trim();

  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return U.iso(new Date(v.getFullYear(), v.getMonth(), v.getDate(), 12));
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 864e5));
      return U.iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  I.toDate = toDate;
  const num = (v) => U.parseNum(v);

  /* строка похожа на заголовок новой таблицы или раздела — текущая таблица закончилась */
  function isBoundary(r) {
    const cells = (r || []).map(norm).filter(Boolean);
    if (!cells.length) return true;
    if (cells.length === 1 && /^\d+(\.\d+)*\.?\s/.test(cells[0])) return true;
    return cells.filter((c) => /^(дата|операция|номер сделки|сокращенное наименование|код актива|вид сделки|сумма зачисления|количество)/.test(c)).length >= 2;
  }

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  /* индекс колонки по списку шаблонов; первый совпавший шаблон выигрывает */
  function findCol(header, ...patterns) {
    for (const p of patterns) {
      const i = header.findIndex((h) => p.test(h));
      if (i >= 0) return i;
    }
    return -1;
  }

  /* ---------- распознавание операции по тексту ---------- */
  I.classify = (text) => {
    const t = norm(text);
    if (!t) return null;
    if (/налог|ндфл|удержан/.test(t)) return 'tax';
    if (/частичн\S* погашен|амортизац/.test(t)) return 'amortization';
    if (/погашени/.test(t)) return 'redemption';
    if (/купон/.test(t)) return 'coupon';
    if (/дивиденд/.test(t)) return 'dividend';
    if (/перевод/.test(t)) return 'transfer';
    if (/пополнен|ввод денеж|зачислени\S* денеж|^пополнение/.test(t)) return 'deposit';
    if (/вывод|снятие/.test(t)) return 'withdrawal';
    if (/комисси|плата за|тариф|обслуживан/.test(t)) return 'fee';
    if (/^покупка|покупка ценн|^buy/.test(t)) return 'buy';
    if (/^продажа|продажа ценн|^sell/.test(t)) return 'sell';
    return null;
  };

  /* ---------- главный разбор ---------- */
  I.parse = async (file) => {
    const sheets = await readSheets(file);
    const trades = [];
    const cash = [];
    const secRef = []; // {name, code, isin, type}
    const skipped = [];
    let format = 'generic';

    for (const sh of sheets) {
      const rows = sh.rows;
      let section = '';
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i] || [];
        const cells = raw.map(norm);
        const filled = cells.filter(Boolean);
        if (filled.length === 1 && /^\d+(\.\d+)*\.?\s/.test(filled[0])) {
          section = filled[0];
          continue;
        }
        if (filled.length < 3) continue;

        /* наш собственный CSV */
        const ownIdx = (label) => cells.indexOf(norm(label));
        if (ownIdx('Тип') >= 0 && ownIdx('Код') >= 0 && ownIdx('Дата') >= 0 && ownIdx('Сумма, ₽') >= 0) {
          format = 'kupon';
          const map = {};
          I.CSV_COLUMNS.forEach(([k, label]) => (map[k] = ownIdx(label)));
          for (let j = i + 1; j < rows.length; j++) {
            const r = rows[j] || [];
            const get = (k) => (map[k] >= 0 ? r[map[k]] : null);
            const date = toDate(get('op_date'));
            if (!date) continue;
            const typeText = String(get('op_type') || '');
            const type = Object.keys(KK.engine.OP).find((k) => norm(KK.engine.OP[k]) === norm(typeText) || k === typeText.trim()) || I.classify(typeText);
            if (!type || type === 'transfer') {
              skipped.push({ date, text: typeText, reason: 'неизвестный тип' });
              continue;
            }
            const assetText = norm(get('asset_type'));
            const op = {
              op_date: date,
              op_type: type,
              code: get('secid') ? String(get('secid')).trim() : null,
              isin: get('isin') || null,
              name: get('name') || null,
              asset_type: /облиг|bond/.test(assetText) ? 'bond' : /акци|share/.test(assetText) ? 'share' : /фонд|пай|fund/.test(assetText) ? 'fund' : null,
              account: get('account') || null,
              quantity: num(get('quantity')),
              price: num(get('price')),
              price_pct: num(get('price_pct')),
              accrued_interest: num(get('accrued_interest')),
              fee: num(get('fee')),
              amount: num(get('amount')),
              tax: num(get('tax')),
              note: get('note') || null,
            };
            const ownKey = get('import_key') ? String(get('import_key')).trim() : '';
            op.import_key = ownKey || 'kk:' + hash([op.op_date, op.op_type, op.code, op.quantity, op.price, op.amount, op.note].join('|'));
            (type === 'buy' || type === 'sell' ? trades : cash).push(op);
          }
          i = rows.length;
          continue;
        }

        /* сделки: «Дата заключения / Вид сделки / Код актива / Цена / Количество» */
        const cDate = findCol(cells, /^дата заключения/, /^дата сделки/, /^дата( и время)?$/, /^дата/);
        const cKind = findCol(cells, /^вид сделки/, /^тип сделки/, /^направление/, /^операция$/, /^тип операции/);
        const cQty = findCol(cells, /^количество/, /^кол-во/);
        const cPrice = findCol(cells, /^цена за единицу/, /^цена/);
        const cCode = findCol(cells, /^код актива/, /^тикер/, /^isin/, /^код бумаги/, /^код инструмента/);
        if (cDate >= 0 && cKind >= 0 && cQty >= 0 && cPrice >= 0 && cCode >= 0 && /вид сделки|тип сделки|направление/.test(cells[cKind])) {
          if (/прекращен/.test(section)) continue;
          if (/^1\.\d/.test(section) || cells.some((c) => /номер сделки/.test(c))) format = 'tbank';
          const col = {
            name: findCol(cells, /^сокращенное наименование/, /^наименование/, /^инструмент/),
            sum: findCol(cells, /сумма \(без нкд\)/, /сумма без нкд/),
            nkd: findCol(cells, /^нкд/),
            total: findCol(cells, /^сумма сделки/, /^сумма$/),
            fees: cells.map((c, k) => (/^комиссия/.test(c) && !/валюта/.test(c) ? k : -1)).filter((k) => k >= 0),
            deal: findCol(cells, /^номер сделки/, /^id сделки/),
            currency: findCol(cells, /^валюта цены/, /^валюта расчетов/, /^валюта$/),
          };
          for (let j = i + 1; j < rows.length; j++) {
            const r = rows[j] || [];
            const date = toDate(r[cDate]);
            const kindText = norm(r[cKind]);
            if (!date) {
              if (isBoundary(r)) break;
              continue;
            }
            const type = /покуп|buy/.test(kindText) ? 'buy' : /прода|sell/.test(kindText) ? 'sell' : null;
            if (!type) continue;
            const cur = col.currency >= 0 ? norm(r[col.currency]) : '';
            if (cur && !/rub|руб|sur/.test(cur)) {
              skipped.push({ date, text: `${r[cCode]} — сделка не в рублях`, reason: 'валюта' });
              continue;
            }
            const qty = num(r[cQty]);
            const p = num(r[cPrice]);
            const sum = col.sum >= 0 ? num(r[col.sum]) : null;
            const nkd = col.nkd >= 0 ? num(r[col.nkd]) : null;
            const total = col.total >= 0 ? num(r[col.total]) : null;
            const fee = col.fees.reduce((a, k) => a + (num(r[k]) || 0), 0);
            const gross = sum ?? (total != null ? total - (nkd || 0) : null);
            const priceRub = qty && gross ? Math.abs(gross) / qty : p;
            const code = String(r[cCode] ?? '').trim();
            const looksBond = /^(SU\d{5}RMFS|RU000A|RU\d{3})/i.test(code) || (p && priceRub && p <= 200 && priceRub > p * 3);
            const deal = col.deal >= 0 && r[col.deal] != null ? String(r[col.deal]).trim() : '';
            trades.push({
              op_date: date,
              op_type: type,
              code,
              name: col.name >= 0 ? String(r[col.name] ?? '').trim() || null : null,
              quantity: qty,
              price: priceRub != null ? U.round2(priceRub * 1e4) / 1e4 : null,
              price_pct: looksBond && p != null && p <= 200 ? p : null,
              accrued_interest: nkd ? Math.abs(nkd) : 0,
              fee: Math.abs(fee) || 0,
              amount: gross != null ? Math.abs(gross) : qty && p ? qty * p : null,
              asset_hint: looksBond ? 'bond' : null,
              import_key: deal ? 'tb:' + deal : 'tb:' + hash([date, type, code, qty, p, sum].join('|')),
            });
          }
          continue;
        }

        /* справочник бумаг: «Сокращенное наименование актива / Код актива / Тип» */
        const cSecName = findCol(cells, /^сокращенное наименование актива/);
        const cSecCode = findCol(cells, /^код актива/);
        if (cSecName >= 0 && cSecCode >= 0 && cKind < 0) {
          const cIsin = findCol(cells, /код государственной регистрации/, /^isin/);
          const cType = findCol(cells, /^тип$/, /^вид/);
          for (let j = i + 1; j < rows.length; j++) {
            const r = rows[j] || [];
            const name = String(r[cSecName] ?? '').trim();
            const code = String(r[cSecCode] ?? '').trim();
            if (!name && !code) break;
            if (!code) continue;
            secRef.push({ name, code, isin: cIsin >= 0 ? String(r[cIsin] ?? '').trim() : '', type: cType >= 0 ? norm(r[cType]) : '' });
          }
          continue;
        }

        /* движение денег: «Дата / Операция / Сумма зачисления / Сумма списания / Примечание» */
        const cOp = findCol(cells, /^операция/, /^тип операции/, /^вид операции/, /^описание операции/);
        const cIn = findCol(cells, /сумма зачисления/, /^зачислено/, /^приход/);
        const cOut = findCol(cells, /сумма списания/, /^списано/, /^расход/);
        const cAmt = findCol(cells, /^сумма операции/, /^сумма$/, /^сумма/);
        const cD = findCol(cells, /^дата исполнения/, /^дата операции/, /^дата$/, /^дата/);
        if (cOp >= 0 && cD >= 0 && (cIn >= 0 || cOut >= 0 || cAmt >= 0)) {
          const cNote = findCol(cells, /^примечание/, /^комментарий/, /^описание$/, /^назначение/);
          const cTick = findCol(cells, /^тикер/, /^isin/, /^код актива/, /^инструмент/);
          const cQ = findCol(cells, /^количество/);
          const cP = findCol(cells, /^цена/);
          const cF = findCol(cells, /^комиссия/);
          for (let j = i + 1; j < rows.length; j++) {
            const r = rows[j] || [];
            const date = toDate(r[cD]) || toDate(r[findCol(cells, /^дата$/)]);
            if (!date) {
              if (isBoundary(r)) break;
              continue;
            }
            const opText = String(r[cOp] ?? '').trim();
            const type = I.classify(opText);
            const inc = cIn >= 0 ? num(r[cIn]) || 0 : 0;
            const out = cOut >= 0 ? num(r[cOut]) || 0 : 0;
            const amt = cIn >= 0 || cOut >= 0 ? inc - out : num(r[cAmt]) || 0;
            const note = cNote >= 0 ? String(r[cNote] ?? '').trim() : '';
            if (!type || type === 'transfer' || type === 'fee') {
              if (amt) skipped.push({ date, text: opText + (note ? ' — ' + note : ''), amount: amt, reason: type === 'transfer' ? 'перевод между счетами' : type === 'fee' ? 'комиссия (учтена в сделках)' : 'не распознано' });
              continue;
            }
            cash.push({
              op_date: date,
              op_type: type,
              code: cTick >= 0 && r[cTick] ? String(r[cTick]).trim() : null,
              quantity: cQ >= 0 ? num(r[cQ]) : null,
              price: cP >= 0 ? num(r[cP]) : null,
              fee: cF >= 0 ? Math.abs(num(r[cF]) || 0) : null,
              amount: Math.abs(amt),
              note: note || opText,
              opText,
              baseKey: [date, norm(opText), U.round2(amt), norm(note).slice(0, 80)].join('|'),
            });
          }
          continue;
        }
      }
    }

    /* в отчёте брокера покупки/продажи уже есть в разделе сделок */
    let cashOps = cash;
    if (trades.length && format !== 'kupon') {
      const dropped = cash.filter((c) => c.op_type === 'buy' || c.op_type === 'sell');
      cashOps = cash.filter((c) => c.op_type !== 'buy' && c.op_type !== 'sell');
      if (dropped.length) skipped.push({ text: `${dropped.length} строк(и) движения денег по сделкам`, reason: 'уже учтены в разделе сделок' });
    }

    /* ключи для защиты от повторной загрузки */
    const seen = new Map();
    for (const c of cashOps) {
      if (c.import_key) continue;
      const n = (seen.get(c.baseKey) || 0) + 1;
      seen.set(c.baseKey, n);
      c.import_key = 'tbc:' + hash(c.baseKey) + (n > 1 ? '#' + n : '');
    }

    /* к какой бумаге относится выплата: ISIN, код или название в примечании */
    const known = [];
    const addKnown = (code, name, isin) => code && known.push({ code, name: norm(name), isin: String(isin || '').toUpperCase() });
    secRef.forEach((s) => addKnown(s.code, s.name, s.isin));
    trades.forEach((t) => addKnown(t.code, t.name, null));
    const refByCode = new Map(secRef.map((s) => [s.code, s]));
    for (const c of cashOps) {
      if (!['coupon', 'dividend', 'amortization', 'redemption', 'tax'].includes(c.op_type)) continue;
      if (c.code) continue;
      const text = c.note || '';
      const up = text.toUpperCase();
      const isin = (up.match(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/) || [])[0];
      let hit = isin && known.find((k) => k.isin === isin || k.code.toUpperCase() === isin);
      if (!hit) hit = known.find((k) => k.code.length >= 4 && up.includes(k.code.toUpperCase()));
      if (!hit) {
        const t = norm(text);
        hit = known
          .filter((k) => k.name && k.name.length >= 3 && t.includes(k.name))
          .sort((a, b) => b.name.length - a.name.length)[0];
      }
      if (hit) c.code = hit.code;
      else if (isin) c.code = isin;
      else c.unresolved = c.op_type !== 'tax';
    }

    /* налог в той же дате и по той же бумаге — прикрепляем к выплате */
    const taxes = cashOps.filter((c) => c.op_type === 'tax');
    for (const t of taxes) {
      const pay = cashOps.find((c) => (c.op_type === 'coupon' || c.op_type === 'dividend') && c.op_date === t.op_date && (!t.code || c.code === t.code) && c.tax == null);
      if (pay) pay.tax = t.amount;
    }

    const all = [...trades, ...cashOps].map((o) => {
      const ref = o.code && refByCode.get(o.code);
      if (ref && !o.name) o.name = ref.name;
      if (ref && !o.asset_hint) o.asset_hint = /облиг/.test(ref.type) ? 'bond' : /акци/.test(ref.type) ? 'share' : /пай|фонд|etf/.test(ref.type) ? 'fund' : null;
      if (ref && ref.isin && !o.isin) o.isin = ref.isin;
      return o;
    });
    all.sort((a, b) => (a.op_date < b.op_date ? -1 : a.op_date > b.op_date ? 1 : 0));
    return { ops: all, skipped, format, sheets: sheets.length };
  };
})();
