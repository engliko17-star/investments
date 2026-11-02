/* Купонная книжка — расчёты: позиции, выплаты, налог, прогноз.
   Чистые функции без DOM, чтобы их можно было проверить отдельно. */
(function () {
  'use strict';
  const KK = (window.KK = window.KK || {});
  const U = KK.util;
  const E = (KK.engine = {});

  E.KIND = {
    bond: { label: 'Облигации', one: 'Облигация' },
    share: { label: 'Акции', one: 'Акция' },
    fund: { label: 'Фонды', one: 'Фонд' },
  };
  E.KINDS = ['bond', 'share', 'fund'];
  E.OP = {
    buy: 'Покупка',
    sell: 'Продажа',
    coupon: 'Купон',
    dividend: 'Дивиденды',
    amortization: 'Амортизация',
    redemption: 'Погашение',
    deposit: 'Пополнение',
    withdrawal: 'Вывод',
    tax: 'Налог',
    fee: 'Комиссия',
  };
  const PAYOUT = ['coupon', 'dividend', 'amortization', 'redemption'];
  const INCOME = ['coupon', 'dividend'];
  E.isIncome = (t) => INCOME.includes(t);

  const n0 = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };
  const r2 = U.round2;
  const cmpOps = (a, b) =>
    a.op_date < b.op_date ? -1 : a.op_date > b.op_date ? 1 : String(a.created_at || '').localeCompare(String(b.created_at || ''));
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  /* номинал на дату по графику амортизации */
  function faceOn(inf, date) {
    const initial = inf.initialFace;
    if (!initial || !inf.amorts) return inf.faceValue ?? initial ?? null;
    let face = initial;
    for (const a of inf.amorts) if (!a.maturity && a.date <= date && a.value != null) face -= a.value;
    return face;
  }
  E.faceOn = faceOn;

  /**
   * Главный расчёт портфеля.
   * ops — операции (как в базе), info — данные Мосбиржи по secid, settings — настройки.
   */
  E.build = function ({ ops, info, settings, today }) {
    today = today || U.today();
    info = info || {};
    settings = settings || {};
    const ct = n0(settings.couponTax ?? 30) / 100;
    const dt = n0(settings.dividendTax ?? 30) / 100;
    const auto = settings.autoPayouts !== false;
    const taxOf = (type, amount) => (type === 'coupon' ? amount * ct : type === 'dividend' ? amount * dt : 0);

    const positions = [];
    const received = [];
    const expected = [];
    const settle = (d) => U.addBizDays(d, 1);

    for (const [secid, list] of U.groupBy(
      ops.filter((o) => o.secid),
      (o) => o.secid
    )) {
      const inf = info[secid] || {};
      const sorted = list.slice().sort(cmpOps);
      const kind = inf.kind || sorted.find((o) => o.asset_type)?.asset_type || 'bond';
      const name = inf.shortname || sorted.find((o) => o.name)?.name || secid;
      const accounts = [...new Set(sorted.map((o) => o.account).filter(Boolean))];
      const trades = sorted.filter((o) => (o.op_type === 'buy' || o.op_type === 'sell') && n0(o.quantity) > 0);
      const pays = sorted.filter((o) => PAYOUT.includes(o.op_type));
      const firstTrade = trades.length ? trades[0].op_date : null;
      const qtyAt = (rec) => {
        let q = 0;
        for (const t of trades) if (settle(t.op_date) <= rec) q += (t.op_type === 'buy' ? 1 : -1) * n0(t.quantity);
        return Math.max(0, q);
      };
      const hasActual = (types, from, to) => pays.some((p) => types.includes(p.op_type) && p.op_date >= from && p.op_date <= to);
      const base = { secid, name, kind, account: accounts[0] || null };

      /* --- выплаты до сегодняшнего дня: из выписки/вручную + рассчитанные по расписанию --- */
      const flows = pays.map((p) => ({
        ...base,
        date: p.op_date,
        type: p.op_type,
        amount: n0(p.amount),
        qty: p.quantity ?? null,
        status: 'received',
        source: p.source || 'manual',
        opId: p.id,
        taxActual: p.tax != null && p.tax !== '' && isFinite(Number(p.tax)) ? Number(p.tax) : null,
      }));
      const coupons = inf.coupons || [];
      const amorts = inf.amorts || [];
      const divs = inf.dividends || [];

      if (auto && firstTrade) {
        if (kind === 'bond') {
          for (const c of coupons) {
            if (c.date > today || c.date < firstTrade || c.value == null) continue;
            const q = qtyAt(c.recordDate || U.prevBizDay(c.date));
            if (q <= 0 || hasActual(['coupon'], U.addDays(c.date, -10), U.addDays(c.date, 10))) continue;
            flows.push({ ...base, date: c.date, type: 'coupon', amount: r2(q * c.value), qty: q, perUnit: c.value, status: 'auto' });
          }
          for (const a of amorts) {
            if (a.date > today || a.date < firstTrade || a.value == null) continue;
            const q = qtyAt(U.prevBizDay(a.date));
            const type = a.maturity ? 'redemption' : 'amortization';
            if (q <= 0 || hasActual(['amortization', 'redemption'], U.addDays(a.date, -10), U.addDays(a.date, 10))) continue;
            flows.push({ ...base, date: a.date, type, amount: r2(q * a.value), qty: q, perUnit: a.value, status: 'auto' });
          }
        } else {
          for (const d of divs) {
            const pay = U.addDays(d.recordDate, 14);
            if (pay > today || d.recordDate < firstTrade) continue;
            const q = qtyAt(d.recordDate);
            if (q <= 0 || hasActual(['dividend'], d.recordDate, U.addDays(d.recordDate, 75))) continue;
            flows.push({ ...base, date: pay, type: 'dividend', amount: r2(q * d.value), qty: q, perUnit: d.value, status: 'auto', approxDate: true });
          }
        }
      }

      /* --- средняя цена, реализованный результат, возврат номинала --- */
      const timeline = [
        ...trades.map((t) => ({ date: t.op_date, ord: 1, t })),
        ...flows.filter((f) => f.type === 'amortization' || f.type === 'redemption').map((f) => ({ date: f.date, ord: 0, f })),
      ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ord - b.ord));
      let q = 0,
        cost = 0,
        realized = 0,
        nkdPaid = 0,
        nkdRecv = 0,
        fees = 0,
        invested = 0,
        principalBack = 0,
        redeemed = false;
      for (const ev of timeline) {
        if (ev.t) {
          const t = ev.t;
          const n = n0(t.quantity);
          const price = n0(t.price);
          const fee = n0(t.fee);
          const nkd = n0(t.accrued_interest);
          fees += fee;
          if (t.op_type === 'buy') {
            q += n;
            cost += n * price + fee;
            nkdPaid += nkd;
            invested += n * price + fee + nkd;
            redeemed = false;
          } else {
            const avg = q > 0 ? cost / q : 0;
            const sellQ = Math.min(n, q || n);
            realized += sellQ * price - fee - avg * sellQ;
            cost -= avg * sellQ;
            q -= sellQ;
            nkdRecv += nkd;
            if (q <= 1e-9) {
              q = 0;
              cost = 0;
            }
          }
        } else {
          const f = ev.f;
          principalBack += f.amount;
          if (f.type === 'amortization') {
            cost -= f.amount;
            if (cost < 0) {
              realized += -cost;
              cost = 0;
            }
          } else {
            realized += f.amount - cost;
            cost = 0;
            q = 0;
            redeemed = true;
          }
        }
      }
      // погашение без расписания: по дате погашения из карточки
      if (kind === 'bond' && q > 0 && auto && inf.matDate && inf.matDate <= today && !redeemed && !amorts.length) {
        const face = inf.faceValue || inf.initialFace || 1000;
        const amount = r2(q * face);
        flows.push({ ...base, date: inf.matDate, type: 'redemption', amount, qty: q, perUnit: face, status: 'auto' });
        realized += amount - cost;
        principalBack += amount;
        q = 0;
        cost = 0;
      }

      /* --- налог и чистый доход по каждой выплате: удержанный, если известен, иначе по ставке --- */
      for (const f of flows) {
        f.tax = E.isIncome(f.type) && f.taxActual != null ? r2(f.taxActual) : r2(taxOf(f.type, f.amount));
        f.net = r2(f.amount - f.tax);
      }
      flows.sort(byDate);
      received.push(...flows);

      /* --- текущая цена и стоимость --- */
      const faceNow = kind === 'bond' ? inf.faceValue ?? faceOn(inf, today) ?? 1000 : null;
      let priceRub = inf.priceRub ?? null;
      if (kind === 'bond' && inf.price != null) priceRub = (inf.price / 100) * faceNow;
      const hasQuote = priceRub != null;
      const mv = q > 0 ? (hasQuote ? q * priceRub : cost) : 0;
      const accrued = kind === 'bond' && q > 0 && inf.accruedInt != null ? q * inf.accruedInt : 0;
      const unreal = q > 0 && hasQuote ? mv - cost : null;

      /* --- ожидаемые выплаты по текущему количеству --- */
      const fut = [];
      let lastRate = null;
      if (kind === 'bond') {
        let lastValue = null;
        for (const c of coupons) {
          if (c.rate != null) lastRate = c.rate;
          if (c.date <= today) {
            if (c.value != null) lastValue = c.value;
            continue;
          }
          const rec = c.recordDate || U.prevBizDay(c.date);
          const qq = rec <= today ? qtyAt(rec) : q;
          if (qq <= 0) continue;
          let v = c.value;
          let est = false;
          if (v == null) {
            const rate = c.rate ?? lastRate ?? inf.couponPercent;
            const face = c.face ?? faceOn(inf, c.date) ?? faceNow;
            const days = c.startDate ? U.daysBetween(c.startDate, c.date) : inf.couponPeriod || 182;
            v = rate != null && face ? r2((face * rate * days) / 36500) : lastValue;
            est = true;
          } else lastValue = v;
          if (v == null) continue;
          fut.push({ ...base, date: c.date, type: 'coupon', amount: r2(qq * v), qty: qq, perUnit: v, status: 'expected', estimate: est });
        }
        if (q > 0) {
          for (const a of amorts) {
            if (a.date <= today || a.value == null) continue;
            fut.push({ ...base, date: a.date, type: a.maturity ? 'redemption' : 'amortization', amount: r2(q * a.value), qty: q, perUnit: a.value, status: 'expected' });
          }
          if (!amorts.length && inf.matDate && inf.matDate > today) {
            fut.push({ ...base, date: inf.matDate, type: 'redemption', amount: r2(q * (faceNow || 1000)), qty: q, perUnit: faceNow, status: 'expected' });
          }
        }
      } else {
        const known = divs.filter((d) => U.addDays(d.recordDate, 14) > today);
        for (const d of known) {
          const qq = d.recordDate <= today ? qtyAt(d.recordDate) : q;
          if (qq <= 0) continue;
          fut.push({ ...base, date: U.addDays(d.recordDate, 14), type: 'dividend', amount: r2(qq * d.value), qty: qq, perUnit: d.value, status: 'expected', approxDate: true });
        }
        if (q > 0) {
          const ttm = divs.filter((d) => d.recordDate > U.addDays(today, -365) && d.recordDate <= today);
          for (const d of ttm) {
            const rec = U.addDays(d.recordDate, 365);
            if (known.some((k) => Math.abs(U.daysBetween(k.recordDate, rec)) < 90)) continue;
            fut.push({ ...base, date: U.addDays(rec, 14), type: 'dividend', amount: r2(q * d.value), qty: q, perUnit: d.value, status: 'expected', estimate: true, projected: true });
          }
        }
      }
      for (const f of fut) {
        f.tax = r2(taxOf(f.type, f.amount));
        f.net = r2(f.amount - f.tax);
      }
      fut.sort(byDate);
      expected.push(...fut);

      const income = flows.filter((f) => E.isIncome(f.type));
      const incomeGross = U.sum(income, (f) => f.amount);
      const incomeTax = U.sum(income, (f) => f.tax);
      const in365 = U.addDays(today, 365);
      const expected12 = U.sum(fut.filter((f) => E.isIncome(f.type) && f.date <= in365), (f) => f.amount);
      const ttmDivPerUnit = kind !== 'bond' ? U.sum(divs.filter((d) => d.recordDate > U.addDays(today, -365) && d.recordDate <= today), (d) => d.value) : 0;
      const nextCoupon = fut.find((f) => f.type === 'coupon') || null;
      const offerDate = inf.offerDate || (inf.offers || []).find((o) => o.date > today)?.date || null;

      positions.push({
        ...base,
        accounts,
        fullName: inf.name || name,
        isin: inf.isin || sorted.find((o) => o.isin)?.isin || null,
        qty: q,
        closed: q <= 0,
        cost,
        avg: q > 0 ? cost / q : 0,
        realized,
        nkdPaid,
        nkdRecv,
        fees,
        invested,
        principalBack,
        hasQuote,
        priceRub,
        pricePct: kind === 'bond' ? inf.price ?? null : null,
        change: inf.change ?? null,
        faceNow,
        mv,
        accrued,
        unreal,
        unrealPct: unreal != null && cost > 0 ? (unreal / cost) * 100 : null,
        couponPct: kind === 'bond' ? inf.couponPercent ?? lastRate : null,
        nextCoupon,
        matDate: kind === 'bond' ? inf.matDate || null : null,
        daysToMat: kind === 'bond' && inf.matDate ? U.daysBetween(today, inf.matDate) : null,
        offerDate,
        ytm: kind === 'bond' ? inf.ytm ?? null : null,
        divYield: kind !== 'bond' && ttmDivPerUnit && priceRub ? (ttmDivPerUnit / priceRub) * 100 : null,
        hasAmort: inf.hasAmortization ?? (sorted.some((o) => o.has_amortization === true) || null),
        incomeGross,
        incomeTax,
        incomeNet: incomeGross - incomeTax,
        expected12,
        result: (unreal ?? 0) + realized + (incomeGross - incomeTax) - nkdPaid + nkdRecv,
        flows,
        future: fut,
        ops: sorted,
        info: inf,
      });
    }

    positions.sort((a, b) => b.mv - a.mv || (a.name > b.name ? 1 : -1));
    received.sort(byDate);
    expected.sort(byDate);

    const open = positions.filter((p) => !p.closed);
    const income = received.filter((f) => E.isIncome(f.type));
    const deposits = U.sum(ops.filter((o) => o.op_type === 'deposit'), (o) => o.amount) - U.sum(ops.filter((o) => o.op_type === 'withdrawal'), (o) => o.amount);
    const in365 = U.addDays(today, 365);
    const exp12 = expected.filter((f) => E.isIncome(f.type) && f.date <= in365);

    return {
      today,
      settings,
      positions,
      received,
      expected,
      totals: {
        mv: U.sum(open, (p) => p.mv),
        cost: U.sum(open, (p) => p.cost),
        unreal: U.sum(open, (p) => p.unreal ?? 0),
        accrued: U.sum(open, (p) => p.accrued),
        realized: U.sum(positions, (p) => p.realized),
        incomeGross: U.sum(income, (f) => f.amount),
        incomeTax: U.sum(income, (f) => f.tax),
        incomeNet: U.sum(income, (f) => f.net),
        nkdPaid: U.sum(positions, (p) => p.nkdPaid),
        deposits,
        expected12Gross: U.sum(exp12, (f) => f.amount),
        expected12Net: U.sum(exp12, (f) => f.net),
        missingQuotes: open.filter((p) => !p.hasQuote).length,
        openCount: open.length,
      },
    };
  };

  /* доход за год по месяцам: получено + ожидается */
  E.monthly = function (model, year) {
    const today = model.today;
    const months = Array.from({ length: 12 }, (_, m0) => ({
      m0,
      key: `${year}-${String(m0 + 1).padStart(2, '0')}`,
      items: [],
      received: { bond: 0, share: 0, fund: 0 },
      expected: { bond: 0, share: 0, fund: 0 },
      receivedNet: { bond: 0, share: 0, fund: 0 },
      expectedNet: { bond: 0, share: 0, fund: 0 },
    }));
    const add = (f, bucket) => {
      if (!E.isIncome(f.type) || U.year(f.date) !== year) return;
      const m = months[U.month0(f.date)];
      const k = E.KINDS.includes(f.kind) ? f.kind : 'bond';
      m[bucket][k] += f.amount;
      m[bucket + 'Net'][k] += f.net;
      m.items.push(f);
    };
    model.received.forEach((f) => add(f, 'received'));
    model.expected.forEach((f) => f.date > today && add(f, 'expected'));
    months.forEach((m) => m.items.sort(byDate));
    return months;
  };

  /* полученный доход по годам */
  E.yearly = function (model) {
    const map = new Map();
    for (const f of model.received) {
      if (!E.isIncome(f.type)) continue;
      const y = U.year(f.date);
      if (!map.has(y)) map.set(y, { year: y, gross: 0, tax: 0, net: 0, byKind: { bond: 0, share: 0, fund: 0 } });
      const r = map.get(y);
      r.gross += f.amount;
      r.tax += f.tax;
      r.net += f.net;
      r.byKind[f.kind] = (r.byKind[f.kind] || 0) + f.amount;
    }
    return [...map.values()].sort((a, b) => a.year - b.year);
  };

  /* средняя доходность к погашению по стоимости облигаций — ставка для реинвестирования */
  E.defaultRate = function (model) {
    const bonds = model.positions.filter((p) => !p.closed && p.kind === 'bond');
    const withYtm = bonds.filter((p) => p.ytm > 0 && p.mv > 0);
    const w = U.sum(withYtm, (p) => p.mv);
    if (w > 0) return U.sum(withYtm, (p) => p.ytm * p.mv) / w;
    const withC = bonds.filter((p) => p.couponPct > 0 && p.cost > 0);
    const wc = U.sum(withC, (p) => p.cost);
    if (wc > 0) return U.sum(withC, (p) => p.couponPct * p.cost) / wc;
    return null;
  };

  /**
   * Прогноз по месяцам.
   * Текущие бумаги платят по расписанию Мосбиржи; новые деньги (пополнения, возвращённый
   * номинал и, если включено, купоны после налога) вкладываются под ставку rate.
   */
  E.forecast = function (model, { daily = 100, start, years = 5, reinvest = true, rate = 12 } = {}) {
    const today = model.today;
    const ct = n0(model.settings.couponTax ?? 30) / 100;
    const dt = n0(model.settings.dividendTax ?? 30) / 100;
    const startDate = start && start > today ? start : U.addDays(today, 1);
    const y0 = U.year(today);
    const yEnd = y0 + years;
    const r = n0(rate) / 100;

    const flows = new Map();
    const add = (date, k, v) => {
      const key = date.slice(0, 7);
      if (!flows.has(key)) flows.set(key, { coupon: 0, div: 0, principal: 0 });
      flows.get(key)[k] += v;
    };
    const divBase = [];
    for (const f of model.expected) {
      if (f.date <= today || U.year(f.date) > yEnd) continue;
      if (f.type === 'coupon') add(f.date, 'coupon', f.amount);
      else if (f.type === 'dividend') {
        add(f.date, 'div', f.amount);
        if (f.date <= U.addDays(today, 365)) divBase.push(f);
      } else add(f.date, 'principal', f.amount);
    }
    // дивиденды повторяются каждый год на уровне последних 12 месяцев
    for (let k = 1; k <= years; k++) for (const f of divBase) {
      const d = U.addDays(f.date, 365 * k);
      if (U.year(d) <= yEnd) add(d, 'div', f.amount);
    }

    const receivedThisYear = model.received.filter((f) => E.isIncome(f.type) && U.year(f.date) === y0);
    const out = [];
    let B = 0;
    let existing = model.totals.mv;
    let year = null;
    const tomorrow = U.addDays(today, 1);
    for (let y = y0; y <= yEnd; y++) {
      year = {
        year: y,
        partial: y === y0,
        gross: 0,
        net: 0,
        fromPortfolio: 0,
        fromNew: 0,
        deposits: 0,
        principal: 0,
        receivedGross: 0,
        receivedNet: 0,
      };
      if (y === y0) {
        year.receivedGross = U.sum(receivedThisYear, (f) => f.amount);
        year.receivedNet = U.sum(receivedThisYear, (f) => f.net);
        year.gross += year.receivedGross;
        year.net += year.receivedNet;
      }
      for (let m0 = 0; m0 < 12; m0++) {
        const key = `${y}-${String(m0 + 1).padStart(2, '0')}`;
        const mStart = key + '-01';
        const dim = U.daysInMonth(y, m0);
        const mEnd = key + '-' + String(dim).padStart(2, '0');
        if (mEnd <= today) continue;
        const from = mStart > tomorrow ? mStart : tomorrow;
        const share = (U.daysBetween(from, mEnd) + 1) / dim;
        const depFrom = from > startDate ? from : startDate;
        const depDays = depFrom <= mEnd ? U.daysBetween(depFrom, mEnd) + 1 : 0;
        const f = flows.get(key) || { coupon: 0, div: 0, principal: 0 };
        const newInc = (B * r * share) / 12;
        const gross = f.coupon + f.div + newInc;
        const net = f.coupon * (1 - ct) + f.div * (1 - dt) + newInc * (1 - ct);
        const deposit = depDays * daily;
        existing = Math.max(0, existing - f.principal);
        B += deposit + f.principal + (reinvest ? net : 0);
        year.gross += gross;
        year.net += net;
        year.fromPortfolio += f.coupon + f.div;
        year.fromNew += newInc;
        year.deposits += deposit;
        year.principal += f.principal;
      }
      year.capital = existing + B;
      year.perMonthNet = year.net / 12;
      out.push(year);
    }
    return { years: out, rate: n0(rate), daily, reinvest, startDate };
  };
})();
