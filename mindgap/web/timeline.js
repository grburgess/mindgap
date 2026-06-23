/* mindgap — timeline strip: histogram of node created_at + draggable playhead +
   ▶ play that animates a time cutoff, with adjustable bin resolution (day/week/month).
   Pure binning (bins) is testable in isolation; render/scrub/play own the DOM. No deps.
   Colors come from CSS theme tokens. */
'use strict';
(function () {
  const DAY = 86400000, WEEK = 7 * DAY;
  const GRANS = ['day', 'week', 'month'];
  const parse = (n) => { const t = Date.parse(n && n.created_at); return Number.isFinite(t) ? t : null; };
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);

  // bucket-start key for a timestamp at the given resolution (all UTC)
  function keyOf(t, gran) {
    const d = new Date(t);
    if (gran === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (gran === 'week') { const dow = (d.getUTCDay() + 6) % 7; return day - dow * DAY; }  // Monday start
    return day;
  }
  // start of the bucket AFTER key (for gap-fill + last-bucket end)
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

  // module state for the single mounted strip
  let root, barsEl, headEl, readoutEl, playBtn, resBtn, fromEl, toEl;
  let onCutoffCb = null, B = [], N = [], minT = null, maxT = null, total = 0;
  let cutoff = null, playing = false, raf = 0, dragging = false, gran = 'day';

  function span() { return Math.max((maxT || 0) - (minT || 0), 1); }
  function frac(t) { return Math.min(Math.max((t - minT) / span(), 0), 1); }
  function tAt(f) { return minT + f * span(); }

  function emit(T) { cutoff = T; if (onCutoffCb) onCutoffCb(T); paintHead(); }

  function visibleCount(T) {
    if (T == null) return total;
    let c = 0;
    // exact-timestamp count to match the graph's viewData filter (t <= cutoff); a
    // bucket-granular sum would overcount nodes created later in the playhead's current bucket
    for (const n of N) { const t = parse(n); if (t != null && t <= T) c++; }
    return c;
  }

  function paintHead() {
    if (!headEl) return;
    const f = cutoff == null ? 1 : frac(cutoff);
    headEl.style.left = (f * 100) + '%';
    const T = cutoff == null ? maxT : cutoff;
    const vis = cutoff == null ? total : visibleCount(cutoff);
    readoutEl.textContent = (T != null ? fmt(T) : '—') + ' · ' + vis + '/' + total + ' nodes';
  }

  function renderBars() {
    if (!barsEl) return;
    const max = B.reduce((m, b) => Math.max(m, b.count), 1);
    barsEl.innerHTML = B.map((b) =>
      `<span class="tl-bar" style="height:${Math.max(8, Math.round(b.count / max * 100))}%" title="${fmt(b.day)}: ${b.count}"></span>`).join('');
    if (headEl) barsEl.appendChild(headEl);   // head lives inside .tl-bars; re-attach after rebuild
    fromEl.textContent = minT != null ? fmt(minT) : '';
    toEl.textContent = maxT != null ? fmt(maxT) : '';
  }

  function recompute(nodes) {
    N = nodes || [];
    B = bins(N, gran);
    total = N.filter((n) => parse(n) != null).length;
    minT = B.length ? B[0].day : null;
    maxT = B.length ? nextKey(B[B.length - 1].day, gran) - 1 : null;  // include the whole last bucket
  }

  function setGran(g) {
    gran = g; if (resBtn) resBtn.textContent = g;
    recompute(N); renderBars(); paintHead();   // cutoff (a timestamp) stays valid across resolutions
  }

  function stop() { playing = false; if (raf) cancelAnimationFrame(raf), raf = 0; if (playBtn) playBtn.textContent = '▶'; }

  function play() {
    if (!B.length) return;
    playing = true; playBtn.textContent = '⏸';
    const t0 = performance.now(), DUR = 8000, from = minT, to = maxT;
    const step = (now) => {
      if (!playing) return;
      const p = Math.min((now - t0) / DUR, 1);
      if (p >= 1) { stop(); emit(null); return; }   // reached max -> show all
      emit(from + p * (to - from));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  // drag the playhead (pointer over the track) -> cutoff; pauses play
  function trackFrac(clientX) {
    const r = barsEl.getBoundingClientRect();
    return Math.min(Math.max((clientX - r.left) / Math.max(r.width, 1), 0), 1);
  }
  function onDown(e) {
    if (!B.length) return;
    stop(); dragging = true;
    try { barsEl.setPointerCapture(e.pointerId); } catch { /* no active pointer (e.g. synthetic/cancelled) */ }
    emit(tAt(trackFrac(e.clientX)));
  }
  function onMove(e) { if (dragging) emit(tAt(trackFrac(e.clientX))); }
  function onUp() { dragging = false; }

  function mount(el, { nodes, onCutoff }) {
    onCutoffCb = onCutoff || null;
    el.innerHTML = `
      <div class="tl-controls">
        <button class="tl-play" title="play (cutoff min→max)">▶</button>
        <button class="tl-res mono" title="bin resolution (day / week / month)">day</button>
        <span class="tl-readout mono"></span>
      </div>
      <div class="tl-track">
        <span class="tl-label tl-from mono dim"></span>
        <div class="tl-bars"><div class="tl-head"></div></div>
        <span class="tl-label tl-to mono dim"></span>
      </div>`;
    root = el;
    barsEl = el.querySelector('.tl-bars');
    headEl = el.querySelector('.tl-head');
    readoutEl = el.querySelector('.tl-readout');
    playBtn = el.querySelector('.tl-play');
    resBtn = el.querySelector('.tl-res');
    fromEl = el.querySelector('.tl-from');
    toEl = el.querySelector('.tl-to');
    playBtn.onclick = () => { playing ? stop() : play(); };
    resBtn.onclick = () => { stop(); setGran(GRANS[(GRANS.indexOf(gran) + 1) % GRANS.length]); };
    barsEl.addEventListener('pointerdown', onDown);
    barsEl.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    recompute(nodes);
    cutoff = null;
    renderBars();
    paintHead();
  }

  // refresh bins from a (possibly new) full node set; keep the strip stable
  function update(nodes) {
    recompute(nodes);
    renderBars();
    paintHead();
  }

  window.Timeline = { mount, update, bins };
})();
