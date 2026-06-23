/* mindgap — timeline strip: histogram of node created_at + draggable playhead +
   ▶ play, adjustable resolution (day/week/month), and a before/after toggle. The kept
   side of the playhead stays lit; the other side is scrimmed; a date lozenge rides the
   playhead (Time Machine style). Pure binning (bins) is testable; render/scrub/play own
   the DOM. No deps. Colors come from CSS theme tokens. */
'use strict';
(function () {
  const DAY = 86400000, WEEK = 7 * DAY;
  const GRANS = ['day', 'week', 'month'];
  const parse = (n) => { const t = Date.parse(n && n.created_at); return Number.isFinite(t) ? t : null; };
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);

  function keyOf(t, gran) {
    const d = new Date(t);
    if (gran === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (gran === 'week') { const dow = (d.getUTCDay() + 6) % 7; return day - dow * DAY; }  // Monday start
    return day;
  }
  function nextKey(k, gran) {
    if (gran === 'week') return k + WEEK;
    if (gran === 'month') { const d = new Date(k); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
    return k + DAY;
  }

  // pure: nodes -> [{day, count}] one bucket per resolution unit, gap-filled, ascending.
  function bins(nodes, gran = 'day') {
    const counts = new Map();
    for (const n of nodes || []) { const t = parse(n); if (t == null) continue; const k = keyOf(t, gran); counts.set(k, (counts.get(k) || 0) + 1); }
    if (!counts.size) return [];
    const keys = [...counts.keys()].sort((a, b) => a - b);
    const out = []; let k = keys[0]; const last = keys[keys.length - 1];
    while (k <= last) { out.push({ day: k, count: counts.get(k) || 0 }); k = nextKey(k, gran); }
    return out;
  }

  let barsEl, barwrapEl, scrimEl, headEl, dateEl, readoutEl, playBtn, resBtn, dirBtn, fromEl, toEl;
  let onCutoffCb = null, B = [], N = [], minT = null, maxT = null, total = 0;
  let cutoff = null, playing = false, raf = 0, dragging = false, gran = 'day', dir = 'before';

  function spanMs() { return Math.max((maxT || 0) - (minT || 0), 1); }
  function frac(t) { return Math.min(Math.max((t - minT) / spanMs(), 0), 1); }
  function tAt(f) { return minT + f * spanMs(); }

  function emit(T) { cutoff = T; if (onCutoffCb) onCutoffCb(T, dir); paintHead(); }

  function visibleCount(T) {
    if (T == null) return total;
    let c = 0; const after = dir === 'after';
    // exact-timestamp count to match the graph's viewData filter
    for (const n of N) { const t = parse(n); if (t == null) continue; if (after ? t >= T : t <= T) c++; }
    return c;
  }

  function paintHead() {
    if (!headEl) return;
    const f = cutoff == null ? (dir === 'after' ? 0 : 1) : frac(cutoff);
    headEl.style.left = (f * 100) + '%';
    if (dir === 'after') { scrimEl.style.left = '0'; scrimEl.style.width = (f * 100) + '%'; }
    else { scrimEl.style.left = (f * 100) + '%'; scrimEl.style.width = ((1 - f) * 100) + '%'; }
    const T = cutoff == null ? (dir === 'after' ? minT : maxT) : cutoff;
    dateEl.textContent = T != null ? fmt(T) : '—';
    readoutEl.textContent = visibleCount(cutoff) + ' / ' + total + ' nodes';
  }

  function renderBars() {
    if (!barwrapEl) return;
    const max = B.reduce((m, b) => Math.max(m, b.count), 1), tot = spanMs();
    barwrapEl.innerHTML = B.map((b) => {
      const w = (nextKey(b.day, gran) - b.day) / tot * 100;
      const h = Math.max(7, Math.round(b.count / max * 100));
      return `<span class="tl-bar" style="width:${w}%;height:${h}%" title="${fmt(b.day)}: ${b.count}"></span>`;
    }).join('');
    fromEl.textContent = minT != null ? fmt(minT) : '';
    toEl.textContent = maxT != null ? fmt(maxT) : '';
    paintHead();
  }

  function recompute(nodes) {
    N = nodes || [];
    B = bins(N, gran);
    total = N.filter((n) => parse(n) != null).length;
    minT = B.length ? B[0].day : null;
    maxT = B.length ? nextKey(B[B.length - 1].day, gran) - 1 : null;
  }

  function setGran(g) { gran = g; if (resBtn) resBtn.textContent = g; recompute(N); renderBars(); }
  function setDir(d) { dir = d; if (dirBtn) { dirBtn.textContent = d; dirBtn.dataset.dir = d; } emit(cutoff); }

  function stop() { playing = false; if (raf) cancelAnimationFrame(raf), raf = 0; if (playBtn) playBtn.textContent = '▶'; }
  function play() {
    if (!B.length) return;
    playing = true; playBtn.textContent = '⏸';
    const t0 = performance.now(), DUR = 8000, from = minT, to = maxT;
    const step = (now) => {
      if (!playing) return;
      const p = Math.min((now - t0) / DUR, 1);
      if (p >= 1) { stop(); emit(null); return; }
      emit(from + p * (to - from));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function trackFrac(clientX) { const r = barsEl.getBoundingClientRect(); return Math.min(Math.max((clientX - r.left) / Math.max(r.width, 1), 0), 1); }
  function onDown(e) {
    if (!B.length) return;
    stop(); dragging = true;
    try { barsEl.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
    emit(tAt(trackFrac(e.clientX)));
  }
  function onMove(e) { if (dragging) emit(tAt(trackFrac(e.clientX))); }
  function onUp() { dragging = false; }

  function mount(el, { nodes, onCutoff }) {
    onCutoffCb = onCutoff || null;
    el.innerHTML = `
      <div class="tl-controls">
        <button class="tl-play" title="play the cutoff across time">▶</button>
        <button class="tl-res mono" title="resolution: day / week / month">day</button>
        <button class="tl-dir mono" data-dir="before" title="show nodes created before vs after the playhead">before</button>
        <span class="tl-readout mono"></span>
      </div>
      <div class="tl-track">
        <span class="tl-label tl-from mono dim"></span>
        <div class="tl-bars">
          <div class="tl-barwrap"></div>
          <div class="tl-scrim"></div>
          <div class="tl-head"><span class="tl-date mono"></span></div>
        </div>
        <span class="tl-label tl-to mono dim"></span>
      </div>`;
    barsEl = el.querySelector('.tl-bars');
    barwrapEl = el.querySelector('.tl-barwrap');
    scrimEl = el.querySelector('.tl-scrim');
    headEl = el.querySelector('.tl-head');
    dateEl = el.querySelector('.tl-date');
    readoutEl = el.querySelector('.tl-readout');
    playBtn = el.querySelector('.tl-play');
    resBtn = el.querySelector('.tl-res');
    dirBtn = el.querySelector('.tl-dir');
    fromEl = el.querySelector('.tl-from');
    toEl = el.querySelector('.tl-to');
    playBtn.onclick = () => { playing ? stop() : play(); };
    resBtn.onclick = () => { stop(); setGran(GRANS[(GRANS.indexOf(gran) + 1) % GRANS.length]); };
    dirBtn.onclick = () => setDir(dir === 'before' ? 'after' : 'before');
    barsEl.addEventListener('pointerdown', onDown);
    barsEl.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    recompute(nodes);
    cutoff = null;
    renderBars();
  }

  function update(nodes) { recompute(nodes); renderBars(); }

  window.Timeline = { mount, update, bins };
})();
