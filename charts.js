/* Купонная книжка — графики на SVG без библиотек.
   Столбцы до 24px, скругление 4px только сверху, зазор 2px между сегментами,
   волосяная сетка, подсказка при наведении, выбор столбца кликом и клавиатурой. */
(function () {
  'use strict';
  const KK = (window.KK = window.KK || {});
  const U = KK.util;
  const C = (KK.charts = {});
  const NS = 'http://www.w3.org/2000/svg';

  function niceStep(max, count) {
    if (max <= 0) return 1;
    const raw = max / count;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function scaleFor(max, ticks = 4) {
    const step = niceStep(max || 1, ticks);
    const top = Math.max(step, Math.ceil((max || 1) / step) * step);
    const vals = [];
    for (let v = 0; v <= top + step / 2; v += step) vals.push(v);
    return { top, vals };
  }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null) continue;
      // CSS-переменные надёжно работают только через style
      if ((k === 'fill' || k === 'stroke') && String(v).includes('var(')) e.style[k] = v;
      else e.setAttribute(k, v);
    }
    if (parent) parent.appendChild(e);
    return e;
  }
  function barPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    if (h <= 0) return '';
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function textWidth(s, px = 11) {
    return String(s).length * px * 0.58;
  }

  function tooltipLayer(host) {
    let tip = host.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.hidden = true;
      tip.setAttribute('role', 'status');
      host.appendChild(tip);
    }
    return {
      show(html, x, y) {
        tip.innerHTML = html;
        tip.hidden = false;
        const hw = host.clientWidth;
        const tw = tip.offsetWidth;
        let left = x + 12;
        if (left + tw > hw - 4) left = Math.max(4, x - tw - 12);
        tip.style.left = left + 'px';
        tip.style.top = Math.max(0, y - tip.offsetHeight - 8) + 'px';
      },
      hide() {
        tip.hidden = true;
      },
    };
  }

  /**
   * Столбчатый график (с накоплением).
   * series: [{label, color, values[], opacity?}] — нижний сегмент первым.
   * line: {label, color, values[]} — точки поверх (тот же масштаб).
   */
  C.bars = function (host, o) {
    host.classList.add('chart');
    host.querySelectorAll('svg').forEach((s) => s.remove());
    const n = o.labels.length;
    const W = Math.max(280, host.clientWidth || 600);
    const H = o.height || 240;
    const totals = o.labels.map((_, i) => o.series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0));
    const lineMax = o.line ? Math.max(0, ...o.line.values.filter((v) => v != null)) : 0;
    const { top, vals } = scaleFor(Math.max(...totals, lineMax, 0), o.ticks || 4);
    const yFmt = o.yFormat || U.compact;
    const padL = Math.max(...vals.map((v) => textWidth(yFmt(v)))) + 10;
    const pad = { l: padL, r: 6, t: 12, b: 24 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    const band = pw / n;
    const bw = Math.min(o.barWidth || 24, Math.max(4, band * 0.62));
    const y = (v) => pad.t + ph - (v / top) * ph;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': o.ariaLabel || '' });
    svg.style.display = 'block';
    const gGrid = el('g', { class: 'grid' }, svg);
    vals.forEach((v) => {
      el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'gridline' }, gGrid);
      const t = el('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, gGrid);
      t.textContent = yFmt(v);
    });
    const every = Math.ceil((textWidth(o.labels.reduce((a, l) => (l.length > a.length ? l : a), ''), 11) + 8) / band);
    const gSel = el('g', {}, svg);
    const gBars = el('g', {}, svg);
    const gHit = el('g', {}, svg);
    const tip = tooltipLayer(host);

    o.labels.forEach((lab, i) => {
      const cx = pad.l + band * i + band / 2;
      if (i % every === 0 || i === o.selected) {
        const t = el('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'tick' + (i === o.selected ? ' tick-on' : '') + (o.mutedLabels && o.mutedLabels[i] ? ' tick-muted' : '') }, svg);
        t.textContent = lab;
      }
      if (i === o.selected) el('rect', { x: pad.l + band * i + 1, y: pad.t - 6, width: band - 2, height: ph + 6, rx: 6, class: 'band-on' }, gSel);
      let acc = 0;
      const segs = o.series.map((s) => ({ s, v: Math.max(0, s.values[i] || 0) })).filter((x) => x.v > 0);
      segs.forEach((seg, k) => {
        const y0 = y(acc);
        const y1 = y(acc + seg.v);
        acc += seg.v;
        const isTop = k === segs.length - 1;
        let h = y0 - y1;
        if (!isTop && h > 3) h -= 2; // зазор между сегментами
        const yTop = isTop ? y1 : y0 - h;
        const d = isTop ? barPath(cx - bw / 2, yTop, bw, Math.max(h, 1.5), 4) : `M${cx - bw / 2},${yTop}h${bw}v${h}h${-bw}Z`;
        if (d) el('path', { d, fill: seg.s.color, 'fill-opacity': seg.s.opacity ?? 1 }, gBars);
      });
    });

    if (o.line) {
      const pts = o.line.values.map((v, i) => (v == null ? null : [pad.l + band * i + band / 2, y(v)]));
      const d = pts.reduce((a, p, i) => (p ? a + (a && pts[i - 1] ? 'L' : 'M') + p[0] + ',' + p[1] : a), '');
      el('path', { d, fill: 'none', stroke: o.line.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': o.line.dashed ? '1 5' : null }, svg);
      pts.forEach((p) => p && el('circle', { cx: p[0], cy: p[1], r: 4, fill: o.line.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg));
    }

    if (o.valueLabels) {
      o.labels.forEach((_, i) => {
        const s = o.valueLabels(i, totals[i]);
        if (!s) return;
        const t = el('text', { x: pad.l + band * i + band / 2, y: y(totals[i]) - 6, 'text-anchor': 'middle', class: 'val' }, svg);
        t.textContent = s;
      });
    }

    o.labels.forEach((lab, i) => {
      const r = el('rect', { x: pad.l + band * i, y: pad.t, width: band, height: ph + pad.b, fill: 'transparent', tabindex: o.onSelect ? 0 : null, role: o.onSelect ? 'button' : null, 'aria-label': o.aria ? o.aria(i) : lab, class: 'hit' }, gHit);
      const show = () => o.tooltip && tip.show(o.tooltip(i), pad.l + band * i + band / 2, y(Math.max(totals[i], o.line ? o.line.values[i] || 0 : 0)));
      r.addEventListener('mouseenter', show);
      r.addEventListener('focus', show);
      r.addEventListener('mouseleave', () => tip.hide());
      r.addEventListener('blur', () => tip.hide());
      if (o.onSelect) {
        r.addEventListener('click', () => o.onSelect(i));
        r.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            o.onSelect(i);
          }
        });
      }
    });
    host.insertBefore(svg, host.firstChild);
  };

  /* Линия с заливкой и перекрестием */
  C.line = function (host, o) {
    host.classList.add('chart');
    host.querySelectorAll('svg').forEach((s) => s.remove());
    const n = o.labels.length;
    const W = Math.max(280, host.clientWidth || 600);
    const H = o.height || 220;
    const max = Math.max(0, ...o.series.flatMap((s) => s.values.filter((v) => v != null)));
    const { top, vals } = scaleFor(max, 4);
    const yFmt = o.yFormat || U.compact;
    const pad = { l: Math.max(...vals.map((v) => textWidth(yFmt(v)))) + 10, r: 12, t: 12, b: 24 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    const x = (i) => pad.l + (n === 1 ? pw / 2 : (pw * i) / (n - 1));
    const y = (v) => pad.t + ph - (v / top) * ph;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': o.ariaLabel || '' });
    svg.style.display = 'block';
    vals.forEach((v) => {
      el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'gridline' }, svg);
      const t = el('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, svg);
      t.textContent = yFmt(v);
    });
    const every = Math.ceil((textWidth(o.labels[0] || '', 11) + 12) / (pw / Math.max(1, n - 1)));
    o.labels.forEach((lab, i) => {
      if (i % every && i !== n - 1) return;
      const t = el('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', class: 'tick' }, svg);
      t.textContent = lab;
    });
    o.series.forEach((s) => {
      const pts = s.values.map((v, i) => [x(i), y(v || 0)]);
      if (s.area) el('path', { d: `M${pts[0][0]},${y(0)}` + pts.map((p) => `L${p[0]},${p[1]}`).join('') + `L${pts[n - 1][0]},${y(0)}Z`, fill: s.color, 'fill-opacity': 0.1 }, svg);
      el('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(''), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dashed ? '4 4' : null }, svg);
      const last = pts[n - 1];
      el('circle', { cx: last[0], cy: last[1], r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
    });
    const cross = el('line', { y1: pad.t, y2: pad.t + ph, class: 'cross', visibility: 'hidden' }, svg);
    const dots = o.series.map((s) => el('circle', { r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
    const tip = tooltipLayer(host);
    const hit = el('rect', { x: pad.l, y: pad.t, width: pw, height: ph, fill: 'transparent', tabindex: 0, class: 'hit' }, svg);
    let cur = n - 1;
    const showAt = (i) => {
      cur = Math.max(0, Math.min(n - 1, i));
      const xx = x(cur);
      cross.setAttribute('x1', xx);
      cross.setAttribute('x2', xx);
      cross.setAttribute('visibility', 'visible');
      dots.forEach((d, k) => {
        d.setAttribute('cx', xx);
        d.setAttribute('cy', y(o.series[k].values[cur] || 0));
        d.setAttribute('visibility', 'visible');
      });
      if (o.tooltip) tip.show(o.tooltip(cur), xx, y(Math.max(...o.series.map((s) => s.values[cur] || 0))));
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      tip.hide();
    };
    hit.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      showAt(Math.round(((px - pad.l) / pw) * (n - 1)));
    });
    hit.addEventListener('mouseleave', hide);
    hit.addEventListener('focus', () => showAt(cur));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') showAt(cur - 1);
      if (e.key === 'ArrowRight') showAt(cur + 1);
    });
    host.insertBefore(svg, host.firstChild);
  };
})();
