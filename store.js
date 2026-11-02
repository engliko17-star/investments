/* Купонная книжка — хранение операций и настроек.
   Основной режим — Supabase (таблицы inv_operations и inv_settings, см. supabase/schema.sql).
   Демо-режим — localStorage этого браузера с примером портфеля. */
(function () {
  'use strict';
  const KK = (window.KK = window.KK || {});
  const U = KK.util;

  const COLS = [
    'op_date',
    'op_type',
    'secid',
    'isin',
    'name',
    'asset_type',
    'account',
    'quantity',
    'price',
    'price_pct',
    'accrued_interest',
    'fee',
    'amount',
    'tax',
    'has_amortization',
    'source',
    'import_key',
    'note',
  ];
  /* full=true: все колонки (для вставки пачкой — у всех строк одинаковый набор полей) */
  function clean(op, full = true) {
    const o = {};
    for (const c of COLS) {
      if (op[c] !== undefined) o[c] = op[c] === '' ? null : op[c];
      else if (full) o[c] = null;
    }
    if (full && !o.source) o.source = 'manual';
    return o;
  }

  KK.DEFAULT_SETTINGS = {
    dailyDeposit: 100,
    depositStart: null,
    couponTax: 30,
    dividendTax: 15,
    accounts: ['Облигации', 'Акции'],
    accountMap: {}, // договор из отчёта Т-Банка (отпечаток) → счёт
    reports: {}, // загруженные месячные отчёты: { отпечаток: { tail, account, periods: ['2026-09', …] } }
    autoPayouts: true,
    reinvest: true,
    forecastYears: 5,
    forecastRate: null,
  };

  /* ---------------- Supabase ---------------- */
  function supabaseStore(cfg) {
    const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    let user = null;
    const T_OPS = 'inv_operations';
    const T_SET = 'inv_settings';
    const fail = (error, what) => {
      if (!error) return;
      const msg = error.message || String(error);
      if (/relation .* does not exist|Could not find the table/i.test(msg))
        throw new Error('В Supabase нет таблиц трекера. Выполните supabase/schema.sql в SQL Editor.');
      throw new Error(what + ': ' + msg);
    };
    return {
      mode: 'supabase',
      async init() {
        const { data } = await client.auth.getSession();
        user = data.session ? data.session.user : null;
        return user;
      },
      get user() {
        return user;
      },
      onAuthChange(cb) {
        client.auth.onAuthStateChange((_e, session) => {
          user = session ? session.user : null;
          cb(user);
        });
      },
      async signIn(email, password) {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          if (/invalid login credentials/i.test(error.message)) throw new Error('Неверная почта или пароль.');
          if (/email not confirmed/i.test(error.message)) throw new Error('Почта не подтверждена. Подтвердите её в Supabase → Authentication → Users.');
          throw new Error(error.message);
        }
        user = data.user;
        return user;
      },
      async signOut() {
        await client.auth.signOut();
        user = null;
      },
      async loadOps() {
        const all = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await client
            .from(T_OPS)
            .select('*')
            .order('op_date', { ascending: true })
            .order('created_at', { ascending: true })
            .range(from, from + 999);
          fail(error, 'Не удалось загрузить операции');
          all.push(...data);
          if (data.length < 1000) break;
        }
        return all;
      },
      async insertOps(ops) {
        const out = [];
        for (let i = 0; i < ops.length; i += 400) {
          const chunk = ops.slice(i, i + 400).map((o) => ({ ...clean(o), user_id: user.id }));
          const withKey = chunk.filter((o) => o.import_key);
          const without = chunk.filter((o) => !o.import_key);
          if (withKey.length) {
            const { data, error } = await client
              .from(T_OPS)
              .upsert(withKey, { onConflict: 'user_id,import_key', ignoreDuplicates: true })
              .select();
            fail(error, 'Не удалось сохранить операции');
            out.push(...(data || []));
          }
          if (without.length) {
            const { data, error } = await client.from(T_OPS).insert(without).select();
            fail(error, 'Не удалось сохранить операции');
            out.push(...(data || []));
          }
        }
        return out;
      },
      async updateOp(id, patch) {
        const { data, error } = await client.from(T_OPS).update(clean(patch, false)).eq('id', id).select().single();
        fail(error, 'Не удалось изменить операцию');
        return data;
      },
      async deleteOps(ids) {
        for (let i = 0; i < ids.length; i += 200) {
          const { error } = await client.from(T_OPS).delete().in('id', ids.slice(i, i + 200));
          fail(error, 'Не удалось удалить');
        }
      },
      async loadSettings() {
        const { data, error } = await client.from(T_SET).select('data').maybeSingle();
        fail(error, 'Не удалось загрузить настройки');
        return { ...KK.DEFAULT_SETTINGS, ...((data && data.data) || {}) };
      },
      async saveSettings(s) {
        const { error } = await client
          .from(T_SET)
          .upsert({ user_id: user.id, data: s, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        fail(error, 'Не удалось сохранить настройки');
      },
    };
  }

  /* ---------------- Демо: localStorage ---------------- */
  function demoOps() {
    const rows = [];
    const add = (o) => rows.push({ id: U.uid(), created_at: new Date(2020, 0, rows.length + 1).toISOString(), source: 'manual', ...o });
    const t = U.today();
    const y = U.year(t);
    // пример портфеля: несколько ОФЗ, облигация с амортизацией, акция и фонд
    add({ op_date: `${y - 2}-03-12`, op_type: 'buy', secid: 'SU26238RMFS4', name: 'ОФЗ 26238', asset_type: 'bond', account: 'Облигации', quantity: 5, price: 698.4, price_pct: 69.84, accrued_interest: 52.3, fee: 10.48, source: 'import' });
    add({ op_date: `${y - 2}-06-20`, op_type: 'buy', secid: 'SU26240RMFS0', name: 'ОФЗ 26240', asset_type: 'bond', account: 'Облигации', quantity: 4, price: 640.1, price_pct: 64.01, accrued_interest: 31.84, fee: 7.68, source: 'import' });
    add({ op_date: `${y - 1}-02-05`, op_type: 'buy', secid: 'SU46020RMFS2', name: 'ОФЗ 46020', asset_type: 'bond', account: 'Облигации', quantity: 3, price: 571.5, price_pct: 57.15, accrued_interest: 12.6, fee: 5.14, has_amortization: true, source: 'import' });
    add({ op_date: `${y - 1}-05-14`, op_type: 'buy', secid: 'SU26243RMFS4', name: 'ОФЗ 26243', asset_type: 'bond', account: 'Облигации', quantity: 6, price: 742.0, price_pct: 74.2, accrued_interest: 128.4, fee: 13.36, source: 'import' });
    add({ op_date: `${y - 1}-09-02`, op_type: 'buy', secid: 'SU26238RMFS4', name: 'ОФЗ 26238', asset_type: 'bond', account: 'Облигации', quantity: 4, price: 611.7, price_pct: 61.17, accrued_interest: 64.9, fee: 7.34, source: 'import' });
    add({ op_date: `${y - 1}-11-18`, op_type: 'buy', secid: 'SBER', name: 'Сбербанк', asset_type: 'share', account: 'Акции', quantity: 10, price: 251.3, fee: 7.54, source: 'import' });
    add({ op_date: `${y}-01-22`, op_type: 'buy', secid: 'TMOS', name: 'Т-Капитал Индекс МосБиржи', asset_type: 'fund', account: 'Акции', quantity: 300, price: 6.42, fee: 0, source: 'import' });
    add({ op_date: `${y}-04-09`, op_type: 'buy', secid: 'SU26248RMFS3', name: 'ОФЗ 26248', asset_type: 'bond', account: 'Облигации', quantity: 5, price: 905.2, price_pct: 90.52, accrued_interest: 21.7, fee: 13.58, source: 'import' });
    add({ op_date: `${y}-08-27`, op_type: 'buy', secid: 'SU26240RMFS0', name: 'ОФЗ 26240', asset_type: 'bond', account: 'Облигации', quantity: 3, price: 668.9, price_pct: 66.89, accrued_interest: 14.43, fee: 6.02, source: 'manual' });
    add({ op_date: U.addDays(t, -6), op_type: 'buy', secid: 'SU26243RMFS4', name: 'ОФЗ 26243', asset_type: 'bond', account: 'Облигации', quantity: 2, price: 784.5, price_pct: 78.45, accrued_interest: 41.3, fee: 4.71, source: 'manual' });
    add({ op_date: `${y - 2}-03-01`, op_type: 'deposit', amount: 3000, account: 'Облигации', source: 'import' });
    return rows;
  }

  function demoStore() {
    const K_OPS = 'kk:demo:ops';
    const K_SET = 'kk:demo:settings';
    let ops = U.lsGet(K_OPS, null);
    if (!ops) {
      ops = demoOps();
      U.lsSet(K_OPS, ops);
    }
    const save = () => U.lsSet(K_OPS, ops);
    return {
      mode: 'demo',
      user: { email: 'демо' },
      async init() {
        return this.user;
      },
      onAuthChange() {},
      async signIn() {
        return this.user;
      },
      async signOut() {},
      async loadOps() {
        return ops.slice();
      },
      async insertOps(list) {
        const keys = new Set(ops.map((o) => o.import_key).filter(Boolean));
        const added = [];
        for (const o of list) {
          if (o.import_key && keys.has(o.import_key)) continue;
          const row = { ...clean(o), id: U.uid(), created_at: new Date().toISOString() };
          ops.push(row);
          added.push(row);
          if (o.import_key) keys.add(o.import_key);
        }
        save();
        return added;
      },
      async updateOp(id, patch) {
        const i = ops.findIndex((o) => o.id === id);
        if (i < 0) throw new Error('Операция не найдена');
        ops[i] = { ...ops[i], ...clean(patch, false) };
        save();
        return ops[i];
      },
      async deleteOps(ids) {
        const s = new Set(ids);
        ops = ops.filter((o) => !s.has(o.id));
        save();
      },
      async loadSettings() {
        return { ...KK.DEFAULT_SETTINGS, ...U.lsGet(K_SET, {}) };
      },
      async saveSettings(s) {
        U.lsSet(K_SET, s);
      },
      reset() {
        U.lsDel(K_OPS);
        U.lsDel(K_SET);
      },
    };
  }

  KK.makeStore = function (demo) {
    const cfg = window.KK_CONFIG || {};
    if (!demo && cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase) return supabaseStore(cfg);
    return demoStore();
  };
  KK.storeConfigured = function () {
    const cfg = window.KK_CONFIG || {};
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey && !/ВАШ|YOUR/i.test(cfg.supabaseUrl));
  };
})();
