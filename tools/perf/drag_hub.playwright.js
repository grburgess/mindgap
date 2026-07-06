async (page) => {
  // self-contained: find highest-degree hub, IN 2D ZOOM TO IT FIRST (at fit-all zoom a node is <1px
  // and cannot be pointer-hit), get screen coords, real-mouse drag 4s circle while sampling FPS.
  const pre = await page.evaluate(`(async ()=>{
    const g = window.__mm.graph;
    const { nodes, links } = g.graphData();
    const deg = {};
    links.forEach(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      deg[s] = (deg[s]||0)+1; deg[t] = (deg[t]||0)+1;
    });
    let hub = nodes[0];
    nodes.forEach(n => { if ((deg[n.id]||0) > (deg[hub.id]||0)) hub = n; });
    const is3d = typeof g.cameraPosition === 'function';
    if (!is3d) {                       // user flow: zoom to the node, then drag it
      g.centerAt(hub.x, hub.y, 300); g.zoom(1.2, 300);
      await new Promise(r=>setTimeout(r,900));
    }
    const sc = is3d ? g.graph2ScreenCoords(hub.x, hub.y, hub.z || 0)
                    : g.graph2ScreenCoords(hub.x, hub.y);
    return { id: hub.id, sx: sc.x, sy: sc.y, x: hub.x, y: hub.y, z: hub.z || 0, is3d };
  })()`);
  await page.mouse.move(pre.sx, pre.sy);
  await page.waitForTimeout(300);
  await page.evaluate('window.__mmPerf.startSampling()');
  await page.mouse.down();
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    const ang = (Date.now() - t0) / 4000 * Math.PI * 4;
    await page.mouse.move(pre.sx + Math.cos(ang) * 120, pre.sy + Math.sin(ang) * 120);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const drag = await page.evaluate(`(()=>{
    const res = window.__mmPerf.stopSampling();
    const d = res.samples.slice().sort((a,b)=>a-b);
    return { count:res.count, medianFps:res.medianFps, meanFps:res.meanFps, p5Fps:res.p5Fps, worstMs:d.slice(-5) };
  })()`);
  const moved = await page.evaluate(`(()=>{
    const n = window.__mm.graph.graphData().nodes.find(n => n.id === ${JSON.stringify(pre.id)});
    return Math.hypot(n.x - (${pre.x}), n.y - (${pre.y}), (n.z||0) - (${pre.z}));
  })()`);
  const post = await page.evaluate(`(async ()=>{
    const g = window.__mm.graph;
    if (typeof g.cameraPosition !== 'function') { g.zoomToFit(400); await new Promise(r=>setTimeout(r,600)); }
    return true;
  })()`);
  return { hubId: pre.id, zoomedIn2d: !pre.is3d, drag, movedDist: moved };
}
