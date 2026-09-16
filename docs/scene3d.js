/* 睇樓資料庫 · 3D 引擎 v1 (Three.js r128 UMD)
   S3D.init({canvas, model, furniture, layout, onSelect, onChange, imgProxy})
   座標：模型 cm，x 向右、y 向下（平面圖）→ Three：X=x/100，Z=y/100，Y=高度 */
(function () {
  const S3D = {};
  const M = 0.01; // cm → m
  const FLOORS = {
    oak:    { base: '#c9a26a', line: '#a9834f', plank: 12, name: '橡木' },
    walnut: { base: '#7a5335', line: '#5c3d25', plank: 12, name: '胡桃木' },
    grey:   { base: '#b9b6b0', line: '#9e9b95', plank: 14, name: '灰木' },
    white:  { base: '#e7e2d8', line: '#cfc9bd', plank: 12, name: '白蠟木' },
    tile:   { base: '#e4e2dd', line: '#c8c5be', tile: 40, name: '瓷磚' },
    dark:   { base: '#4c4a47', line: '#3a3836', tile: 60, name: '深灰磚' },
  };
  S3D.FLOORS = FLOORS;
  S3D.WALLS = { 白: '#f4f1ea', 米: '#e9e2d0', 灰: '#cfd2d6', 鼠尾草: '#c9d3c5', 藍灰: '#b9c6d2', 暖粉: '#e8d5cf', 炭: '#5b5a57' };

  let st = null; // scene state

  function texFloor(kind) {
    const f = FLOORS[kind] || FLOORS.oak; const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = f.base; g.fillRect(0, 0, 256, 256); g.strokeStyle = f.line; g.lineWidth = 2;
    if (f.tile) { const n = 256 / (f.tile / 100 * 256 / 2.56); const step = 256 / Math.max(2, Math.round(2.56 / (f.tile / 100))); for (let i = 0; i <= 256; i += step) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); } }
    else { const ph = 256 / Math.round(2.56 / (f.plank / 100)); for (let y = 0; y < 256; y += ph) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); const off = ((y / ph) % 2) * 128; for (let x = off; x < 256; x += 160) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + ph); g.stroke(); } }
      g.globalAlpha = .12; for (let i = 0; i < 60; i++) { g.fillStyle = i % 2 ? '#000' : '#fff'; g.fillRect(Math.random() * 256, Math.random() * 256, 40, 2); } g.globalAlpha = 1; }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  function label(text, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = 'rgba(28,27,24,.78)'; g.fillRect(0, 0, 256, 64); g.fillStyle = color || '#efe2b8'; g.font = 'bold 30px -apple-system,PingFang TC,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text.slice(0, 9), 128, 32);
    const t = new THREE.CanvasTexture(c); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); sp.scale.set(0.9, 0.225, 1); return sp;
  }
  function box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; }

  // 邊：房間各矩形四邊，扣除同房其他矩形共邊
  function roomEdges(room) {
    const out = [];
    room.rects.forEach((r, ri) => {
      const [x1, y1, x2, y2] = r;
      const edges = [{ side: 'N', a: x1, b: x2, at: y1, horiz: true }, { side: 'S', a: x1, b: x2, at: y2, horiz: true }, { side: 'W', a: y1, b: y2, at: x1, horiz: false }, { side: 'E', a: y1, b: y2, at: x2, horiz: false }];
      for (const e of edges) {
        let segs = [[e.a, e.b]];
        room.rects.forEach((o, oi) => { if (oi === ri) return; const [ox1, oy1, ox2, oy2] = o;
          const touches = e.horiz ? (oy1 === e.at || oy2 === e.at) : (ox1 === e.at || ox2 === e.at); if (!touches) return;
          const lo = e.horiz ? ox1 : oy1, hi = e.horiz ? ox2 : oy2;
          segs = segs.flatMap(([a, b]) => { const s = Math.max(a, lo), t = Math.min(b, hi); if (t <= s) return [[a, b]]; const r2 = []; if (s > a) r2.push([a, s]); if (b > t) r2.push([t, b]); return r2; }); });
        segs.forEach(([a, b]) => out.push({ side: e.side, a, b, at: e.at, horiz: e.horiz, rect: ri }));
      }
    });
    return out;
  }

  S3D.init = function (opt) {
    if (st && st.renderer) { st.renderer.dispose(); st.raf && cancelAnimationFrame(st.raf); }
    const canvas = opt.canvas; const model = opt.model; const H = (model.ceiling || 240) * M;
    const W = canvas.clientWidth || 360, Hc = Math.round(W * 0.78);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W, Hc, false); canvas.style.height = Hc + 'px';
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf6f3ec);
    const camera = new THREE.PerspectiveCamera(55, W / Hc, 0.05, 100);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d1c0, 0.9));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.9); sun.position.set(6, 9, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -8; sun.shadow.camera.right = 8; sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8; scene.add(sun);
    st = { renderer, scene, camera, model, H, layout: opt.layout || { items: [], mat: {} }, furniture: opt.furniture || [], onSelect: opt.onSelect, onChange: opt.onChange, imgProxy: opt.imgProxy, canvas, W, Hc, mode: 'orbit', sel: null, meshes: [], walls: [], ceilOn: false, texCache: {} };
    st.layout.mat = st.layout.mat || {}; st.layout.items = st.layout.items || [];
    buildFlat(); buildFurniture(); setupControls(); fitCamera(); loop();
    return S3D;
  };

  // 全屋幾何
  function buildFlat() {
    const { scene, model, H } = st; const g = new THREE.Group(); g.name = 'flat'; st.flatGroup = g;
    const wallColor = st.layout.mat.wall || '#f4f1ea';
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: .9 }); st.wallMat = wallMat;
    const extMat = new THREE.MeshStandardMaterial({ color: 0xbdb7aa, roughness: .95 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf7f5ef, roughness: .6 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xbfd8e8, transparent: true, opacity: .35, roughness: .05, metalness: 0 });
    const acMat = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: .5 });
    const sockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .4 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a8, roughness: .7 });
    const tExt = (model.wall && model.wall.ext || 15) * M, tInt = (model.wall && model.wall.int || 10) * M;
    // 樓板
    model.rooms.forEach(room => {
      const kind = (st.layout.mat.floor && st.layout.mat.floor[room.id]) || room.floor || 'oak';
      const tex = st.texCache[kind] || (st.texCache[kind] = texFloor(kind));
      room.rects.forEach(([x1, y1, x2, y2]) => {
        const w = (x2 - x1) * M, d = (y2 - y1) * M; const t = tex.clone(); t.needsUpdate = true; t.repeat.set(w / 2.56, d / 2.56);
        const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: t, roughness: .8 })); f.rotation.x = -Math.PI / 2; f.position.set((x1 + x2) / 2 * M, 0, (y1 + y2) / 2 * M); f.receiveShadow = true; f.userData = { room: room.id, floor: true }; g.add(f);
        const c = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0xfbfaf6, side: THREE.DoubleSide })); c.rotation.x = Math.PI / 2; c.position.set((x1 + x2) / 2 * M, H, (y1 + y2) / 2 * M); c.visible = st.ceilOn; c.userData.ceiling = true; g.add(c);
      });
      const lb = label(room.name, '#f6f3ec'); const [x1, y1, x2, y2] = room.rects[0]; lb.position.set((x1 + x2) / 2 * M, 0.02, (y1 + y2) / 2 * M); lb.scale.set(0.8, 0.2, 1); lb.userData.roomLabel = true; g.add(lb);
    });
    // 牆（每房每邊，扣門窗）
    const openingsFor = (room, e) => {
      const doors = (model.doors || []).filter(d => d.room === room.id && d.side === e.side && (d.rect == null || d.rect === e.rect) && d.to > e.a && d.from < e.b);
      const wins = (model.windows || []).filter(w => w.room === room.id && w.side === e.side && (w.rect == null || w.rect === e.rect) && w.to > e.a && w.from < e.b);
      return { doors, wins };
    };
    model.rooms.forEach(room => roomEdges(room).forEach(e => {
      const t = tInt; const half = t / 2;
      const { doors, wins } = openingsFor(room, e);
      // 沿邊切段
      const cuts = [e.a]; [...doors, ...wins].forEach(o => { cuts.push(Math.max(e.a, o.from), Math.min(e.b, o.to)); }); cuts.push(e.b); cuts.sort((a, b) => a - b);
      const place = (a, b, y0, y1, mat) => { if (b - a < 1 || y1 - y0 < 0.01) return; const len = (b - a) * M; const h = y1 - y0; const cx = e.horiz ? (a + b) / 2 * M : e.at * M + (e.side === 'W' ? -half : half); const cz = e.horiz ? e.at * M + (e.side === 'N' ? -half : half) : (a + b) / 2 * M;
        const m = box(e.horiz ? len : t, h, e.horiz ? t : len, mat, cx, y0 + h / 2, cz); m.userData.wall = { room: room.id, side: e.side }; g.add(m); st.walls.push({ mesh: m, a, b, side: e.side, at: e.at, horiz: e.horiz, room: room.id }); };
      for (let i = 0; i < cuts.length - 1; i++) {
        const a = cuts[i], b = cuts[i + 1]; if (b <= a) continue; const mid = (a + b) / 2;
        const d = doors.find(o => mid > o.from && mid < o.to), w = wins.find(o => mid > o.from && mid < o.to);
        if (d) { place(a, b, d.h * M, H, wallMat); if (!d.open) { // 門框＋半開門扇
            const fw = (b - a) * M; const leaf = box(e.horiz ? fw * 0.96 : 0.04, d.h * M - 0.02, e.horiz ? 0.04 : fw * 0.96, doorMat, 0, d.h * M / 2, 0);
            const piv = new THREE.Group(); const hx = e.horiz ? a * M : e.at * M, hz = e.horiz ? e.at * M : a * M; piv.position.set(hx, 0, hz);
            leaf.position.set(e.horiz ? fw / 2 : 0, d.h * M / 2, e.horiz ? 0 : fw / 2); piv.add(leaf); piv.rotation.y = e.horiz ? (e.side === 'N' ? -0.6 : 0.6) : (e.side === 'W' ? 0.6 : -0.6); g.add(piv);
            const fr1 = box(e.horiz ? 0.05 : t + 0.02, d.h * M, e.horiz ? t + 0.02 : 0.05, frameMat, e.horiz ? a * M : e.at * M, d.h * M / 2, e.horiz ? e.at * M : a * M); g.add(fr1);
            const fr2 = fr1.clone(); fr2.position.set(e.horiz ? b * M : e.at * M, d.h * M / 2, e.horiz ? e.at * M : b * M); g.add(fr2); } }
        else if (w) { const s = w.sill * M, top = (w.sill + w.h) * M; place(a, b, 0, s, wallMat); place(a, b, top, H, wallMat);
          const len = (b - a) * M; const cx = e.horiz ? (a + b) / 2 * M : e.at * M, cz = e.horiz ? e.at * M : (a + b) / 2 * M;
          const glass = box(e.horiz ? len : 0.02, top - s, e.horiz ? 0.02 : len, glassMat, cx, (s + top) / 2, cz); g.add(glass);
          const sill = box(e.horiz ? len + 0.1 : t + 0.12, 0.04, e.horiz ? t + 0.12 : len + 0.1, frameMat, cx, s, cz); g.add(sill);
          const fr = box(e.horiz ? len + 0.06 : 0.05, 0.05, e.horiz ? 0.05 : len + 0.06, frameMat, cx, top, cz); g.add(fr);
          if (w.ac) { const aw = w.ac.w * M, ah = w.ac.h * M; const ay = top - (w.ac.fromTop || 0) * M - ah / 2; const along = w.ac.fromEnd != null ? (w.to - w.ac.fromEnd - w.ac.w / 2) : (w.from + (w.ac.fromStart || 0) + w.ac.w / 2);
            const ac = box(e.horiz ? aw : 0.42, ah, e.horiz ? 0.42 : aw, acMat, e.horiz ? along * M : e.at * M + (e.side === 'W' ? 0.1 : -0.1), ay, e.horiz ? e.at * M + (e.side === 'N' ? 0.1 : -0.1) : along * M); g.add(ac); const l = label('冷氣', '#fff'); l.position.set(ac.position.x, ay + ah / 2 + 0.12, ac.position.z); l.scale.set(0.5, 0.125, 1); g.add(l); } }
        else place(a, b, 0, H, wallMat);
      }
    }));
    // 插座
    (model.sockets || []).forEach(sk => { const room = model.rooms.find(r => r.id === sk.room); if (!room) return; const rect = room.rects[0]; const at = sk.at * M; const [x1, y1, x2, y2] = rect;
      const inset = 0.006; let x, z; if (sk.side === 'N') { x = at; z = y1 * M + inset; } else if (sk.side === 'S') { x = at; z = y2 * M - inset; } else if (sk.side === 'W') { x = x1 * M + inset; z = at; } else { x = x2 * M - inset; z = at; }
      const horiz = sk.side === 'N' || sk.side === 'S'; const s = box(horiz ? 0.086 * (sk.n || 1) : 0.008, 0.086, horiz ? 0.008 : 0.086 * (sk.n || 1), sockMat, x, 0.3, z); g.add(s); });
    scene.add(g);
    // 地基陰影板
    const bounds = st.bounds = computeBounds(); const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: .12 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.002; ground.receiveShadow = true; scene.add(ground);
    st.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }
  function computeBounds() { let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; st.model.rooms.forEach(r => r.rects.forEach(([a, b, c, d]) => { x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, d); })); return { x1, y1, x2, y2, cx: (x1 + x2) / 2 * M, cz: (y1 + y2) / 2 * M, w: (x2 - x1) * M, d: (y2 - y1) * M }; }

  // 傢俬
  const CAT_COLOR = { 客廳: 0x8a6d1e, 睡房: 0x2f4f7a, 書房: 0x4f6b3c, BB: 0xb06a7c, 廚房: 0x8c5a3c, 其他: 0x6b6760 };
  function furnMat(f, tex) { const col = f.顏色 && /白|white/i.test(f.顏色) ? 0xf2efe8 : f.顏色 && /黑|black/i.test(f.顏色) ? 0x2b2a28 : f.顏色 && /木|oak|橡|樺|birch/i.test(f.顏色) ? 0xc9a26a : (CAT_COLOR[f.所屬] || 0x6b6760);
    const side = new THREE.MeshStandardMaterial({ color: col, roughness: .75 }); if (!tex) return side;
    const front = new THREE.MeshStandardMaterial({ map: tex, roughness: .7 }); return [side, side, side, side, front, side]; } // +Z face = 正面
  function buildFurniture() {
    st.meshes.forEach(m => st.scene.remove(m)); st.meshes = [];
    st.layout.items.forEach((it, idx) => { const f = st.furniture.find(x => x.id === it.f); if (!f || !f.長 || !f.闊) return;
      const w = f.長 * M, d = f.闊 * M, h = (f.高 || 75) * M; const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), furnMat(f)); m.position.set(0, h / 2, 0);
      const grp = new THREE.Group(); grp.add(m); grp.position.set((it.x + f.長 / 2) * M, 0, (it.y + f.闊 / 2) * M); grp.rotation.y = -(it.rot || 0) * Math.PI / 180; grp.userData = { idx, f }; m.castShadow = m.receiveShadow = true;
      const lb = label(f.名稱 + (f.價錢 ? ' $' + f.價錢 : ''), f.品牌 === 'IKEA' ? '#ffd23f' : '#efe2b8'); lb.position.y = h + 0.18; grp.add(lb);
      st.scene.add(grp); st.meshes.push(grp);
      if (f.圖片 && st.imgProxy) st.imgProxy(f.圖片).then(dataUrl => { if (!dataUrl) return; new THREE.TextureLoader().load(dataUrl, t => { t.encoding = THREE.sRGBEncoding; m.material = furnMat(f, t); }); }).catch(() => {}); });
    highlight();
  }
  function highlight() { st.meshes.forEach(g => { const m = g.children[0]; const mats = Array.isArray(m.material) ? m.material : [m.material]; mats.forEach(mt => { mt.emissive = new THREE.Color(g.userData.idx === st.sel ? 0x3a3a10 : 0x000000); }); }); }

  // 相機
  function fitCamera() { const b = st.bounds; st.orbit = { target: new THREE.Vector3(b.cx, 0.6, b.cz), dist: Math.max(b.w, b.d) * 1.15, az: 0.6, el: 0.95 }; applyOrbit(); }
  function applyOrbit() { const o = st.orbit; const c = st.camera; c.position.set(o.target.x + o.dist * Math.cos(o.el) * Math.sin(o.az), o.target.y + o.dist * Math.sin(o.el), o.target.z + o.dist * Math.cos(o.el) * Math.cos(o.az)); c.lookAt(o.target); }
  function applyWalk() { const w = st.walk; const c = st.camera; c.position.set(w.x, 1.6, w.z); c.rotation.set(0, 0, 0); c.rotation.order = 'YXZ'; c.rotation.y = w.yaw; c.rotation.x = w.pitch; }
  S3D.setMode = function (mode) { st.mode = mode; if (mode === 'walk') { const b = st.bounds; const L = st.model.rooms.find(r => r.type === '客廳') || st.model.rooms[0]; const [x1, y1, x2, y2] = L.rects[0]; st.walk = { x: (x1 + x2) / 2 * M, z: (y1 + y2) / 2 * M, yaw: Math.PI, pitch: 0, vx: 0, vz: 0 }; applyWalk(); } else applyOrbit(); };
  S3D.joystick = function (dx, dy) { if (!st.walk) return; st.walk.vx = dx; st.walk.vz = dy; };
  S3D.toggleCeiling = function () { st.ceilOn = !st.ceilOn; st.flatGroup.traverse(o => { if (o.userData && o.userData.ceiling) o.visible = st.ceilOn; }); return st.ceilOn; };

  // 互動
  function setupControls() {
    const c = st.canvas; let ptrs = new Map(); let last = null; let pinch0 = 0; let dragging = null; let moved = false;
    const ray = new THREE.Raycaster(); const v2 = new THREE.Vector2();
    const pick = (px, py) => { const r = c.getBoundingClientRect(); v2.set((px - r.left) / r.width * 2 - 1, -((py - r.top) / r.height) * 2 + 1); ray.setFromCamera(v2, st.camera); const hits = ray.intersectObjects(st.meshes.map(g => g.children[0])); return hits.length ? hits[0].object.parent : null; };
    const floorPt = (px, py) => { const r = c.getBoundingClientRect(); v2.set((px - r.left) / r.width * 2 - 1, -((py - r.top) / r.height) * 2 + 1); ray.setFromCamera(v2, st.camera); const p = new THREE.Vector3(); return ray.ray.intersectPlane(st.plane, p) ? p : null; };
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
      if (ptrs.size === 1) { last = { x: e.clientX, y: e.clientY }; const hit = pick(e.clientX, e.clientY); if (hit && st.sel === hit.userData.idx) { const p = floorPt(e.clientX, e.clientY); dragging = { grp: hit, off: p ? new THREE.Vector3().subVectors(hit.position, p) : new THREE.Vector3() }; } }
      if (ptrs.size === 2) { const a = [...ptrs.values()]; pinch0 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); dragging = null; } });
    c.addEventListener('pointermove', e => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1 && last) { const dx = e.clientX - last.x, dy = e.clientY - last.y; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; last = { x: e.clientX, y: e.clientY };
        if (dragging) { const p = floorPt(e.clientX, e.clientY); if (p) { dragging.grp.position.set(p.x + dragging.off.x, 0, p.z + dragging.off.z); } return; }
        if (st.mode === 'orbit') { st.orbit.az -= dx * 0.006; st.orbit.el = Math.min(1.5, Math.max(0.15, st.orbit.el + dy * 0.005)); applyOrbit(); }
        else { st.walk.yaw -= dx * 0.005; st.walk.pitch = Math.min(0.9, Math.max(-0.9, st.walk.pitch - dy * 0.004)); applyWalk(); } }
      if (ptrs.size === 2) { const a = [...ptrs.values()]; const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); if (pinch0) { const k = pinch0 / d; if (st.mode === 'orbit') { st.orbit.dist = Math.min(30, Math.max(1.5, st.orbit.dist * k)); } } pinch0 = d;
        const cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2; if (last && st.mode === 'orbit') { const pdx = cx - last.x, pdy = cy - last.y; const right = new THREE.Vector3().crossVectors(st.camera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(0, 1, 0)).normalize(); const fwd = new THREE.Vector3(-right.z, 0, right.x); st.orbit.target.addScaledVector(right, -pdx * 0.004 * st.orbit.dist * 0.3).addScaledVector(fwd, -pdy * 0.004 * st.orbit.dist * 0.3); applyOrbit(); } last = { x: cx, y: cy }; } });
    const up = e => { ptrs.delete(e.pointerId); if (dragging) { const g = dragging.grp; const it = st.layout.items[g.userData.idx]; const f = g.userData.f; it.x = Math.round(g.position.x / M - f.長 / 2); it.y = Math.round(g.position.z / M - f.闊 / 2); dragging = null; st.onChange && st.onChange(); }
      else if (!moved && ptrs.size === 0) { const hit = pick(e.clientX, e.clientY); st.sel = hit ? hit.userData.idx : null; highlight(); st.onSelect && st.onSelect(st.sel); } if (ptrs.size === 0) last = null; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { e.preventDefault(); if (st.mode === 'orbit') { st.orbit.dist = Math.min(30, Math.max(1.5, st.orbit.dist * (1 + e.deltaY * 0.001))); applyOrbit(); } }, { passive: false });
  }
  function loop() { st.raf = requestAnimationFrame(loop); if (st.mode === 'walk' && st.walk && (st.walk.vx || st.walk.vz)) { const w = st.walk; const sp = 0.03; w.x += (Math.sin(w.yaw) * -w.vz + Math.cos(w.yaw) * w.vx) * sp; w.z += (Math.cos(w.yaw) * -w.vz - Math.sin(w.yaw) * w.vx) * sp; applyWalk(); } st.renderer.render(st.scene, st.camera); }

  // 對外操作
  S3D.add = function (fid, roomId) { const f = st.furniture.find(x => x.id === fid); if (!f) return; const room = st.model.rooms.find(r => r.id === roomId) || st.model.rooms[0]; const [x1, y1, x2, y2] = room.rects[0];
    st.layout.items.push({ f: fid, x: Math.round((x1 + x2) / 2 - f.長 / 2), y: Math.round((y1 + y2) / 2 - f.闊 / 2), rot: 0 }); st.sel = st.layout.items.length - 1; buildFurniture(); st.onChange && st.onChange(); st.onSelect && st.onSelect(st.sel); };
  S3D.rotate = function () { if (st.sel == null) return; const it = st.layout.items[st.sel]; it.rot = ((it.rot || 0) + 90) % 360; buildFurniture(); st.onChange && st.onChange(); };
  S3D.remove = function () { if (st.sel == null) return; st.layout.items.splice(st.sel, 1); st.sel = null; buildFurniture(); st.onChange && st.onChange(); st.onSelect && st.onSelect(null); };
  S3D.setWall = function (hex) { st.layout.mat.wall = hex; st.wallMat.color.set(hex); st.onChange && st.onChange(); };
  S3D.setFloor = function (roomId, kind) { st.layout.mat.floor = st.layout.mat.floor || {}; if (roomId === '*') st.model.rooms.forEach(r => { st.layout.mat.floor[r.id] = kind; }); else st.layout.mat.floor[roomId] = kind; rebuild(); st.onChange && st.onChange(); };
  function rebuild() { st.scene.remove(st.flatGroup); st.walls = []; buildFlat(); buildFurniture(); }
  S3D.layout = () => st.layout; S3D.selected = () => (st.sel == null ? null : st.layout.items[st.sel]);
  S3D.setLayout = function (layout) { st.layout = layout; st.layout.mat = st.layout.mat || {}; st.layout.items = st.layout.items || []; rebuild(); };
  S3D.snapshot = () => st.renderer.domElement.toDataURL('image/png');
  S3D.arSpec = function () { const walls = st.walls.map(w => { const p = w.mesh.position, g = w.mesh.geometry.parameters; return { n: 'wall', w: Math.round(g.width * 100), d: Math.round(g.depth * 100), h: Math.round(g.height * 100), x: Math.round(p.x * 100 - g.width * 50), z: Math.round(p.z * 100 - g.depth * 50), y0: Math.round(p.y * 100 - g.height * 50), rot: 0, c: [0.92, 0.9, 0.86] }; });
    const items = st.layout.items.map((it, k) => { const f = st.furniture.find(x => x.id === it.f); return f ? { n: 'F' + k, w: f.長, d: f.闊, h: f.高 || 75, x: it.x, z: it.y, rot: it.rot || 0 } : null; }).filter(Boolean);
    const b = st.bounds; return { room: { l: b.x2 - b.x1, w: b.y2 - b.y1 }, items: [...items, ...walls].map(o => ({ ...o, x: o.x - b.x1, z: o.z - b.y1 })) }; };
  S3D.resize = function () { if (!st) return; const W = st.canvas.clientWidth || 360, Hc = Math.round(W * 0.78); st.renderer.setSize(W, Hc, false); st.canvas.style.height = Hc + 'px'; st.camera.aspect = W / Hc; st.camera.updateProjectionMatrix(); };
  window.S3D = S3D;
})();
