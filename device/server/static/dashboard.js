/**
 * AuralAI Dev Dashboard — dashboard.js
 *
 * MOCK_MODE = true  → Simulasi fisik di browser (tanpa MaixCAM)
 * MOCK_MODE = false → Sambung ke MaixCAM via HTTP (production mode)
 *
 * Arsitektur Simulasi:
 *   Setiap objek di canvas adalah "entity" dengan posisi fisik nyata (x, y, w, h).
 *   Detection list dan bounding box di-derive DARI posisi fisik entity tersebut.
 *   Posisi label (kiri/kanan/tengah) dihitung dari koordinat pusat entity.
 *   Audio hanya trigger saat objek memasuki zona atau confidence naik signifikan.
 */

const MOCK_MODE = true;
const DEVICE_URL = '';
const SNAPSHOT_INTERVAL = 500;
const STATUS_INTERVAL = 1000;

// Canvas dimensions (harus sinkron dengan HTML)
const CW = 340;
const CH = 238;

// =====================================================================
// STATE
// =====================================================================
const state = {
  mode: 'explorer',
  aiFocusActive: false,
  aiFocusRemaining: 0,
  detections: [],
  latency: { camera: 32, inference: 88, postproc: 6, total: 126, fps: 7.9 },
  overlayVisible: true,
  frameCount: 0,
  lastFpsTime: Date.now(),
  fps: 0,
  tick: 0,
};

// =====================================================================
// ENTITY DEFINITIONS (tipe objek di scene)
// =====================================================================
const ENTITY_TYPES = {
  motorcycle: {
    icon: '🏍', color: '#ef4444',
    bw: 52, bh: 30,          // ukuran bounding box (px)
    speed: 1.6,               // px per frame (horizontal)
    y_range: [0.58, 0.72],   // vertical range (fraksi CH)
    label_id: 'motor',
    draw: drawMotorcycle,
  },
  car: {
    icon: '🚗', color: '#ef4444',
    bw: 78, bh: 44,
    speed: 1.1,
    y_range: [0.54, 0.68],
    label_id: 'mobil',
    draw: drawCar,
  },
  bus: {
    icon: '🚌', color: '#dc2626',
    bw: 100, bh: 54,
    speed: 0.75,
    y_range: [0.52, 0.64],
    label_id: 'bus',
    draw: drawBus,
  },
  person: {
    icon: '🚶', color: '#f59e0b',
    bw: 22, bh: 58,
    speed: 0.35,
    y_range: [0.30, 0.70],
    label_id: 'orang',
    draw: drawPerson,
  },
  bicycle: {
    icon: '🚲', color: '#22c55e',
    bw: 34, bh: 44,
    speed: 0.55,
    y_range: [0.40, 0.68],
    label_id: 'sepeda',
    draw: drawBicycle,
  },
  dog: {
    icon: '🐕', color: '#22c55e',
    bw: 32, bh: 24,
    speed: 0.45,
    y_range: [0.55, 0.72],
    label_id: 'anjing',
    draw: drawDog,
  },
};

// Urutan spawn untuk simulasi realistis (tidak random)
const SPAWN_SEQUENCE = [
  { type: 'motorcycle', dir: 1,  delay: 60  },
  { type: 'person',     dir: -1, delay: 130 },
  { type: 'car',        dir: 1,  delay: 220 },
  { type: 'bicycle',    dir: -1, delay: 320 },
  { type: 'motorcycle', dir: 1,  delay: 420 },
  { type: 'bus',        dir: 1,  delay: 500 },
  { type: 'person',     dir: 1,  delay: 580 },
  { type: 'dog',        dir: -1, delay: 650 },
  { type: 'car',        dir: -1, delay: 730 },
];
let spawnIdx = 0;

// =====================================================================
// ENTITIES (objek yang sedang aktif di scene)
// =====================================================================
let entities = [];
let nextEntityId = 0;

function spawnEntity(typeName, dir) {
  const def = ENTITY_TYPES[typeName];
  if (!def) return;

  const fy = def.y_range[0] + Math.random() * (def.y_range[1] - def.y_range[0]);
  const startX = dir > 0 ? -def.bw - 10 : CW + 10;

  entities.push({
    id: nextEntityId++,
    type: typeName,
    def,
    x: startX,        // kiri atas bounding box
    y: fy * CH - def.bh / 2,
    w: def.bw,
    h: def.bh,
    vx: def.speed * dir,
    dir,
    opacity: 0,       // fade in
    age: 0,
    lastZone: null,   // zone terakhir untuk audio trigger
    lastAudioTick: -999,
    conf: 0.50 + Math.random() * 0.20,  // confidence awal rendah
  });
}

function updateEntities() {
  const toRemove = [];

  entities.forEach(e => {
    e.x += e.vx;
    e.age++;

    // Fade in saat masuk frame
    if (e.opacity < 1) e.opacity = Math.min(1, e.opacity + 0.08);

    // Confidence naik saat objek semakin masuk ke frame
    const cx = e.x + e.w / 2;
    const inFramePct = Math.max(0, Math.min(1, cx / CW));
    const distFromEdge = Math.min(cx, CW - cx) / CW;
    e.conf = Math.min(0.97, 0.52 + distFromEdge * 1.2 + Math.sin(e.age * 0.05) * 0.02);

    // Hapus jika sudah keluar frame
    if (e.dir > 0 && e.x > CW + e.w + 20) toRemove.push(e.id);
    if (e.dir < 0 && e.x < -e.w - 20) toRemove.push(e.id);
  });

  entities = entities.filter(e => !toRemove.includes(e.id));
}

// =====================================================================
// POSISI GRID 3×3 dari koordinat fisik
// =====================================================================
function positionFromEntity(e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;

  const col = cx < CW * 0.33 ? 'kiri' : cx > CW * 0.67 ? 'kanan' : 'tengah';
  const row = cy < CH * 0.33 ? 'atas' : cy > CH * 0.67 ? 'bawah' : 'tengah';

  if (row === 'tengah') return col;
  if (col === 'tengah') return row;
  return `${col}-${row}`;
}

function isDangerZone(e) {
  const area = (e.w * e.h) / (CW * CH);
  return area > 0.12;  // > 12% frame area = danger
}

// =====================================================================
// SYNC ENTITIES → DETECTIONS
// =====================================================================
function syncDetections() {
  if (state.mode !== 'explorer' || state.aiFocusActive) {
    state.detections = [];
    return;
  }

  state.detections = entities
    .filter(e => {
      // Hanya tampilkan jika objek sudah cukup masuk frame
      const cx = e.x + e.w / 2;
      return cx > 20 && cx < CW - 20 && e.opacity > 0.5;
    })
    .map(e => ({
      id: e.id,
      label: e.type,
      icon: e.def.icon,
      color: e.def.color,
      label_id: e.def.label_id,
      position: positionFromEntity(e),
      confidence: parseFloat(e.conf.toFixed(2)),
      isDanger: isDangerZone(e),
      // Koordinat dalam fraksi canvas (untuk overlay)
      fx: e.x / CW,
      fy: e.y / CH,
      fw: e.w / CW,
      fh: e.h / CH,
    }));
}

// =====================================================================
// AUDIO COOLDOWN (per entity, per zone)
// =====================================================================
const audioCooldown = new Map(); // key: `${id}_${zone}` → last tick

function triggerAudio() {
  if (state.mode !== 'explorer' || state.aiFocusActive) return;

  state.detections.forEach(det => {
    if (!det.isDanger && det.confidence < 0.70) return;

    const key = `${det.id}_${det.position}`;
    const lastTick = audioCooldown.get(key) || -999;

    // Cooldown: 5 detik (300 ticks @ 60fps) atau 8 detik untuk yang sama
    const cooldownTicks = 300;
    if (state.tick - lastTick < cooldownTicks) return;

    audioCooldown.set(key, state.tick);

    const phrase = `${det.label_id} ${posToAudioPhrase(det.position)}`;
    playAudio(phrase);
    log('info', `Detected: <strong>${det.label}</strong> (${det.confidence}) @ ${det.position}${det.isDanger ? ' <span style="color:var(--red)">⚠ BAHAYA</span>' : ''}`);
  });
}

function posToAudioPhrase(pos) {
  const map = {
    'kiri':        'di sebelah kiri',
    'kanan':       'di sebelah kanan',
    'tengah':      'di depan',
    'kiri-atas':   'di kiri atas',
    'kanan-atas':  'di kanan atas',
    'kiri-bawah':  'di kiri bawah',
    'kanan-bawah': 'di kanan bawah',
    'atas':        'di atas',
    'bawah':       'di bawah',
  };
  return map[pos] || pos;
}

// =====================================================================
// LATENCY SIMULATION (smooth, realistic — bukan random tiap frame)
// =====================================================================
const latTarget = { camera: 32, inference: 88, postproc: 6 };
const latCurrent = { camera: 32, inference: 88, postproc: 6 };

function updateLatency() {
  // Slow random walk toward ± jitter
  latTarget.camera    = clamp(latTarget.camera    + (Math.random() - 0.5) * 3, 22, 48);
  latTarget.inference = clamp(latTarget.inference + (Math.random() - 0.5) * 4, 72, 130);
  latTarget.postproc  = clamp(latTarget.postproc  + (Math.random() - 0.5) * 1.5, 4, 12);

  // Exponential moving average → nilai halus, tidak loncat
  const α = 0.08;
  latCurrent.camera    += α * (latTarget.camera    - latCurrent.camera);
  latCurrent.inference += α * (latTarget.inference - latCurrent.inference);
  latCurrent.postproc  += α * (latTarget.postproc  - latCurrent.postproc);

  const total = latCurrent.camera + latCurrent.inference + latCurrent.postproc;
  const fps   = 1000 / total;

  state.latency = {
    camera:    Math.round(latCurrent.camera),
    inference: Math.round(latCurrent.inference),
    postproc:  Math.round(latCurrent.postproc),
    total:     Math.round(total),
    fps:       fps.toFixed(1),
  };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// =====================================================================
// CANVAS DRAWING
// =====================================================================
let canvas, ctx;

function initCanvas() {
  canvas = document.getElementById('cameraCanvas');
  ctx    = canvas.getContext('2d');
}

function drawScene() {
  ctx.clearRect(0, 0, CW, CH);

  if (state.mode === 'qris') {
    drawQrisScene();
    return;
  }

  // --- Sky ---
  const sky = ctx.createLinearGradient(0, 0, 0, CH * 0.48);
  sky.addColorStop(0, '#0f1a2e');
  sky.addColorStop(1, '#1a2f4a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CW, CH * 0.48);

  // --- Distant buildings ---
  drawBuildings();

  // --- Road surface ---
  const road = ctx.createLinearGradient(0, CH * 0.48, 0, CH);
  road.addColorStop(0, '#1c1c20');
  road.addColorStop(1, '#111114');
  ctx.fillStyle = road;
  ctx.fillRect(0, CH * 0.48, CW, CH * 0.52);

  // --- Road markings ---
  drawRoadMarkings();

  // --- Sidewalk (trotoar kiri) ---
  ctx.fillStyle = '#2a2a2e';
  ctx.fillRect(0, CH * 0.70, CW * 0.18, CH * 0.30);
  ctx.fillStyle = '#222226';
  for (let x = 0; x < CW * 0.18; x += 12) {
    ctx.fillRect(x, CH * 0.70, 1, CH * 0.30);
  }

  // --- Sort entities by y (perspektif — yang lebih bawah di depan) ---
  const sorted = [...entities].sort((a, b) => (a.y + a.h) - (b.y + b.h));
  sorted.forEach(e => {
    ctx.save();
    ctx.globalAlpha = e.opacity;
    e.def.draw(ctx, e);
    ctx.restore();
  });

  // --- Ground shadow untuk entities ---
  sorted.forEach(e => {
    if (e.opacity < 0.3) return;
    ctx.save();
    ctx.globalAlpha = e.opacity * 0.25;
    ctx.fillStyle = '#000';
    const sx = e.x + e.w * 0.1;
    const sy = e.y + e.h + 2;
    const sw = e.w * 0.8;
    const sh = 5;
    ctx.beginPath();
    ctx.ellipse(sx + sw/2, sy, sw/2, sh/2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // --- Resolution watermark ---
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#fff';
  ctx.font = '9px monospace';
  ctx.fillText('320×224', 6, CH - 6);
  ctx.globalAlpha = 1;

  // --- AI Focus overlay ---
  if (state.aiFocusActive) {
    ctx.fillStyle = 'rgba(245, 158, 11, 0.06)';
    ctx.fillRect(0, 0, CW, CH);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, CW - 2, CH - 2);

    ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('⚡ AI FOCUS', CW / 2 - 38, 20);
  }
}

function drawBuildings() {
  const buildings = [
    { x: 10,  w: 30, h: 55, c: '#151d2e' },
    { x: 45,  w: 50, h: 40, c: '#12192a' },
    { x: 100, w: 25, h: 65, c: '#161e30' },
    { x: 130, w: 40, h: 45, c: '#111828' },
    { x: 210, w: 35, h: 70, c: '#151d2e' },
    { x: 255, w: 55, h: 48, c: '#12192a' },
    { x: 300, w: 30, h: 58, c: '#151d2e' },
  ];
  const horizon = CH * 0.48;
  buildings.forEach(b => {
    ctx.fillStyle = b.c;
    ctx.fillRect(b.x, horizon - b.h, b.w, b.h);

    // Windows
    ctx.fillStyle = 'rgba(255, 230, 100, 0.15)';
    for (let wx = b.x + 4; wx < b.x + b.w - 4; wx += 8) {
      for (let wy = horizon - b.h + 6; wy < horizon - 6; wy += 10) {
        if (Math.sin(wx * 3 + wy * 7) > 0.1) {
          ctx.fillRect(wx, wy, 4, 5);
        }
      }
    }
  });
}

function drawRoadMarkings() {
  const roadTop = CH * 0.52;

  // Center dashed line
  ctx.strokeStyle = 'rgba(255,255,255, 0.25)';
  ctx.setLineDash([18, 14]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, CH * 0.60);
  ctx.lineTo(CW, CH * 0.60);
  ctx.stroke();
  ctx.setLineDash([]);

  // Lane edges
  ctx.strokeStyle = 'rgba(255,255,255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, CH * 0.72);
  ctx.lineTo(CW, CH * 0.72);
  ctx.stroke();

  // Reflective road spots (ambient light)
  ctx.fillStyle = 'rgba(100, 150, 200, 0.04)';
  for (let x = 20; x < CW; x += 60) {
    ctx.fillRect(x, CH * 0.74, 30, 4);
  }
}

// ─── Object Drawers ───────────────────────────────────────────────────────────

function drawMotorcycle(ctx, e) {
  const { x, y, w, h } = e;
  // Body
  ctx.fillStyle = '#cc3030';
  ctx.beginPath();
  ctx.roundRect(x + w*0.15, y + h*0.25, w*0.65, h*0.45, 3);
  ctx.fill();
  // Seat
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + w*0.25, y + h*0.15, w*0.40, h*0.18);
  // Handlebar
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w*0.65, y + h*0.18);
  ctx.lineTo(x + w*0.65, y + h*0.05);
  ctx.lineTo(x + w*0.80, y + h*0.05);
  ctx.stroke();
  // Wheels
  ctx.fillStyle = '#1a1a1a';
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  [[x + w*0.18, y+h], [x + w*0.78, y+h]].forEach(([wx, wy]) => {
    ctx.beginPath(); ctx.arc(wx, wy, w*0.14, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
  });
  // Headlight
  if (e.dir < 0) {
    ctx.fillStyle = 'rgba(255,230,100,0.8)';
    ctx.beginPath(); ctx.ellipse(x+2, y+h*0.35, 3, 2.5, 0, 0, Math.PI*2); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,100,80,0.8)';
    ctx.beginPath(); ctx.ellipse(x+w-2, y+h*0.35, 3, 2.5, 0, 0, Math.PI*2); ctx.fill();
  }
}

function drawCar(ctx, e) {
  const { x, y, w, h } = e;
  const bodyColor = e.dir > 0 ? '#2255cc' : '#994422';
  // Body lower
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.roundRect(x, y + h*0.45, w, h*0.55, 4);
  ctx.fill();
  // Cabin
  ctx.fillStyle = adjustColor(bodyColor, 15);
  ctx.beginPath();
  ctx.roundRect(x + w*0.15, y + h*0.10, w*0.70, h*0.42, 5);
  ctx.fill();
  // Windows
  ctx.fillStyle = 'rgba(160,220,255,0.35)';
  ctx.beginPath(); ctx.roundRect(x+w*0.18, y+h*0.14, w*0.30, h*0.25, 3); ctx.fill();
  ctx.beginPath(); ctx.roundRect(x+w*0.52, y+h*0.14, w*0.30, h*0.25, 3); ctx.fill();
  // Wheels
  ctx.fillStyle = '#111';
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1.5;
  [[x+w*0.16, y+h], [x+w*0.80, y+h]].forEach(([wx, wy]) => {
    ctx.beginPath(); ctx.arc(wx, wy, w*0.13, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(wx, wy, w*0.06, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#111';
  });
  // Lights
  if (e.dir < 0) {
    ctx.fillStyle = 'rgba(255,230,100,0.9)';
    ctx.beginPath(); ctx.ellipse(x+3, y+h*0.55, 4, 3, 0, 0, Math.PI*2); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,90,70,0.9)';
    ctx.beginPath(); ctx.ellipse(x+w-3, y+h*0.55, 4, 3, 0, 0, Math.PI*2); ctx.fill();
  }
}

function drawBus(ctx, e) {
  const { x, y, w, h } = e;
  ctx.fillStyle = '#e8a020';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
  // Windows
  ctx.fillStyle = 'rgba(180,230,255,0.3)';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.roundRect(x + w*0.08 + i*(w*0.22), y + h*0.12, w*0.18, h*0.32, 2);
    ctx.fill();
  }
  // Door
  ctx.fillStyle = '#c08018';
  ctx.fillRect(x + (e.dir < 0 ? w*0.75 : w*0.05), y + h*0.45, w*0.14, h*0.52);
  // Wheels
  ctx.fillStyle = '#111';
  [[x+w*0.12, y+h+2], [x+w*0.50, y+h+2], [x+w*0.85, y+h+2]].forEach(([wx,wy]) => {
    ctx.beginPath(); ctx.arc(wx, wy, w*0.10, 0, Math.PI*2); ctx.fill();
  });
}

function drawPerson(ctx, e) {
  const { x, y, w, h } = e;
  const cx = x + w / 2;
  const walkPhase = Math.sin(e.age * 0.18);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(cx, y+h, w*0.5, 3, 0, 0, Math.PI*2); ctx.fill();

  // Legs
  ctx.strokeStyle = '#445577';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, y + h*0.65);
  ctx.lineTo(cx - w*0.3 + walkPhase*4, y + h);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, y + h*0.65);
  ctx.lineTo(cx + w*0.3 - walkPhase*4, y + h);
  ctx.stroke();

  // Body
  ctx.fillStyle = '#445577';
  ctx.beginPath(); ctx.roundRect(cx - w*0.35, y + h*0.32, w*0.70, h*0.35, 3); ctx.fill();

  // Arms
  ctx.strokeStyle = '#556688';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx - w*0.30, y + h*0.37);
  ctx.lineTo(cx - w*0.55, y + h*0.60 + walkPhase*3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + w*0.30, y + h*0.37);
  ctx.lineTo(cx + w*0.55, y + h*0.60 - walkPhase*3);
  ctx.stroke();

  // Head
  ctx.fillStyle = '#c8a87a';
  ctx.beginPath(); ctx.arc(cx, y + h*0.18, w*0.40, 0, Math.PI*2); ctx.fill();
}

function drawBicycle(ctx, e) {
  const { x, y, w, h } = e;
  const cx = x + w / 2;
  const wheelR = h * 0.38;
  const lx = x + wheelR, rx = x + w - wheelR, midY = y + h - wheelR;

  ctx.strokeStyle = '#448844';
  ctx.lineWidth = 2;

  // Wheels
  [[lx, midY], [rx, midY]].forEach(([wx, wy]) => {
    ctx.beginPath(); ctx.arc(wx, wy, wheelR, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(wx, wy, 2, 0, Math.PI*2);
    ctx.fillStyle = '#448844'; ctx.fill();
  });

  // Frame
  ctx.beginPath();
  ctx.moveTo(lx, midY);
  ctx.lineTo(cx - 2, y + h*0.20);
  ctx.lineTo(rx, midY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 2, y + h*0.20);
  ctx.lineTo(lx + wheelR * 0.5, midY);
  ctx.stroke();

  // Handlebar + seat
  ctx.beginPath();
  ctx.moveTo(rx - 3, midY - wheelR*0.8);
  ctx.lineTo(rx + 6, midY - wheelR*1.1);
  ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(cx - 7, y + h*0.18, 12, 4);

  // Rider silhouette
  ctx.fillStyle = '#556688';
  ctx.beginPath(); ctx.arc(cx + 4, y + h*0.05, 7, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(cx - 4, y + h*0.12, 14, 14, 3); ctx.fill();
}

function drawDog(ctx, e) {
  const { x, y, w, h } = e;
  const walkPhase = Math.sin(e.age * 0.22);

  // Body
  ctx.fillStyle = '#a0724a';
  ctx.beginPath(); ctx.ellipse(x + w*0.52, y + h*0.45, w*0.35, h*0.28, -0.1, 0, Math.PI*2); ctx.fill();

  // Head
  ctx.beginPath(); ctx.ellipse(x + (e.dir > 0 ? w*0.82 : w*0.18), y + h*0.35, w*0.22, h*0.25, 0, 0, Math.PI*2); ctx.fill();

  // Ear
  ctx.fillStyle = '#8a5c34';
  const earX = e.dir > 0 ? x + w*0.78 : x + w*0.22;
  ctx.beginPath(); ctx.ellipse(earX, y + h*0.22, 5, 9, e.dir > 0 ? 0.4 : -0.4, 0, Math.PI*2); ctx.fill();

  // Legs
  ctx.strokeStyle = '#8a5c34';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  [[x+w*0.28, x+w*0.22+walkPhase*4], [x+w*0.42, x+w*0.42-walkPhase*4],
   [x+w*0.62, x+w*0.62+walkPhase*4], [x+w*0.76, x+w*0.76-walkPhase*4]].forEach(([fx, tx]) => {
    ctx.beginPath();
    ctx.moveTo(fx, y + h*0.65);
    ctx.lineTo(tx, y + h);
    ctx.stroke();
  });

  // Tail
  ctx.beginPath();
  const tx2 = e.dir > 0 ? x + w*0.18 : x + w*0.82;
  ctx.moveTo(tx2, y + h*0.38);
  ctx.quadraticCurveTo(tx2 - e.dir*8, y, tx2 - e.dir*12, y + h*0.28);
  ctx.strokeStyle = '#a0724a';
  ctx.lineWidth = 3;
  ctx.stroke();
}

// ─── QRIS Mode scene ──────────────────────────────────────────────────────────
function drawQrisScene() {
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 0, CW, CH);

  const qx = CW/2 - 60, qy = CH/2 - 60, qs = 120;

  // Grid background
  ctx.strokeStyle = 'rgba(168,85,247,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < CW; i += 16) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, CH); ctx.stroke();
  }
  for (let j = 0; j < CH; j += 16) {
    ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(CW, j); ctx.stroke();
  }

  // Corner brackets (scan area)
  const bLen = 20;
  ctx.strokeStyle = 'rgba(168,85,247,0.9)';
  ctx.lineWidth = 2.5;
  const corners = [
    [qx, qy, 1, 1], [qx+qs, qy, -1, 1],
    [qx, qy+qs, 1, -1], [qx+qs, qy+qs, -1, -1],
  ];
  corners.forEach(([cx2, cy2, dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(cx2, cy2 + dy*bLen);
    ctx.lineTo(cx2, cy2);
    ctx.lineTo(cx2 + dx*bLen, cy2);
    ctx.stroke();
  });

  // Scan line animation
  const scanY = qy + ((state.tick * 1.5) % qs);
  const scanGrad = ctx.createLinearGradient(qx, scanY-10, qx, scanY+10);
  scanGrad.addColorStop(0, 'transparent');
  scanGrad.addColorStop(0.5, 'rgba(168,85,247,0.7)');
  scanGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = scanGrad;
  ctx.fillRect(qx, scanY-10, qs, 20);

  // Mock QR pattern
  ctx.fillStyle = 'rgba(168,85,247,0.12)';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r*7 + c*3) % 3 !== 0) {
        ctx.fillRect(qx + 10 + c*12, qy + 10 + r*12, 10, 10);
      }
    }
  }

  // Label
  ctx.fillStyle = 'rgba(168,85,247,0.8)';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('QRIS SCAN AREA', CW/2, qy - 10);
  ctx.fillText('Arahkan kamera ke kode QRIS', CW/2, qy + qs + 18);
  ctx.textAlign = 'left';
}

// =====================================================================
// CONTEXT MODE scene overlay
// =====================================================================
function drawContextOverlay() {
  ctx.fillStyle = 'rgba(0,150,255,0.04)';
  ctx.fillRect(0, 0, CW, CH);
  ctx.strokeStyle = 'rgba(0,150,255,0.3)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(1, 1, CW-2, CH-2);
  ctx.fillStyle = 'rgba(0,150,255,0.7)';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CONTEXT MODE — STANDBY', CW/2, 18);
  ctx.textAlign = 'left';
}

// =====================================================================
// HELPER
// =====================================================================
function adjustColor(hex, amount) {
  const r = clamp(parseInt(hex.slice(1,3),16) + amount, 0, 255);
  const g = clamp(parseInt(hex.slice(3,5),16) + amount, 0, 255);
  const b = clamp(parseInt(hex.slice(5,7),16) + amount, 0, 255);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// =====================================================================
// MAIN SIMULATION LOOP
// =====================================================================
function simLoop() {
  state.tick++;

  if (MOCK_MODE) {
    // Spawn entities berdasarkan sequence
    if (!state.aiFocusActive && state.mode === 'explorer') {
      const seq = SPAWN_SEQUENCE[spawnIdx % SPAWN_SEQUENCE.length];
      if (state.tick >= seq.delay + Math.floor(spawnIdx / SPAWN_SEQUENCE.length) * 800) {
        // Cek apakah tipe ini sudah ada di scene
        const typeExists = entities.some(e => e.type === seq.type);
        if (!typeExists) {
          spawnEntity(seq.type, seq.dir);
          spawnIdx++;
        } else {
          spawnIdx++;  // skip, coba next
        }
      }
    }

    updateEntities();
    syncDetections();

    // Gambar scene
    drawScene();
    if (state.mode === 'context') drawContextOverlay();

    // Update latency setiap 10 frame
    if (state.tick % 10 === 0) {
      updateLatency();
      renderLatency();
    }

    // Trigger audio setiap 30 frame (~0.5 detik)
    if (state.tick % 30 === 0 && !state.aiFocusActive) {
      triggerAudio();
    }

    // Render detections ke panel
    if (state.tick % 4 === 0) {
      renderDetections();
    }

    // FPS counter
    state.frameCount++;
    const now = Date.now();
    if (now - state.lastFpsTime >= 1000) {
      state.fps = state.frameCount;
      state.frameCount = 0;
      state.lastFpsTime = now;
      document.getElementById('fpsCounter').textContent = `${state.fps} fps`;
    }
  }

  requestAnimationFrame(simLoop);
}

// =====================================================================
// RENDER UI
// =====================================================================
function renderDetections() {
  const list     = document.getElementById('detectionList');
  const overlay  = document.getElementById('overlayDetections');
  const countEl  = document.getElementById('detectionCount');

  const dets = state.detections;
  countEl.textContent = dets.length;

  if (dets.length === 0) {
    list.innerHTML = '<div class="detection-empty">Waiting for detections...</div>';
    overlay.innerHTML = '';
    return;
  }

  // Sort: danger dulu, lalu confidence
  const sorted = [...dets].sort((a, b) => {
    if (a.isDanger !== b.isDanger) return a.isDanger ? -1 : 1;
    return b.confidence - a.confidence;
  });

  list.innerHTML = sorted.map(d => {
    const cls = d.isDanger ? 'danger' : d.confidence > 0.75 ? 'normal' : 'warning';
    const confPct = Math.round(d.confidence * 100);
    const dangerTag = d.isDanger
      ? '<span class="det-danger">⚠ BAHAYA</span>'
      : '';
    return `<div class="detection-item ${cls}">
      <span class="det-icon">${d.icon}</span>
      <span class="det-label">${d.label}</span>
      <span class="det-pos">${d.position}</span>
      <span class="det-conf">${confPct}%</span>
      ${dangerTag}
    </div>`;
  }).join('');

  if (!state.overlayVisible) {
    overlay.innerHTML = '';
    return;
  }

  const W = canvas.offsetWidth  || CW;
  const H = canvas.offsetHeight || CH;
  const scaleX = W / CW;
  const scaleY = H / CH;

  overlay.innerHTML = dets.map(d => {
    const bx = Math.round(d.fx * CW * scaleX);
    const by = Math.round(d.fy * CH * scaleY);
    const bw = Math.round(d.fw * CW * scaleX);
    const bh = Math.round(d.fh * CH * scaleY);
    const confPct = Math.round(d.confidence * 100);
    const borderColor = d.isDanger ? '#ef4444' : d.color;
    return `<div class="detection-box" style="
        left:${bx}px; top:${by}px; width:${bw}px; height:${bh}px;
        border-color:${borderColor};
        ${d.isDanger ? 'animation: box-pulse 0.6s ease-in-out infinite;' : ''}
      ">
      <div class="detection-box-label" style="background:${borderColor}; color:#000;">
        ${d.label} ${confPct}%
      </div>
    </div>`;
  }).join('');
}

function renderLatency() {
  const l = state.latency;
  document.getElementById('latCamera').textContent    = `${l.camera}ms`;
  document.getElementById('latInference').textContent = `${l.inference}ms`;
  document.getElementById('latPostproc').textContent  = `${l.postproc}ms`;
  document.getElementById('latTotal').textContent     = `${l.total}ms`;
  document.getElementById('latFps').textContent       = l.fps;

  colorizeLatency('latCamera',    l.camera,    35, 55);
  colorizeLatency('latInference', l.inference, 100, 140);
  colorizeLatency('latTotal',     l.total,     150, 220);

  const maxW = 120;
  document.getElementById('barCamera').style.width    = Math.round((l.camera    / 250) * maxW) + 'px';
  document.getElementById('barInference').style.width = Math.round((l.inference / 250) * maxW) + 'px';
  document.getElementById('barPostproc').style.width  = Math.round((l.postproc  / 250) * maxW) + 'px';
}

function colorizeLatency(id, val, warnThresh, errThresh) {
  const el = document.getElementById(id);
  if (!el) return;
  if (val > errThresh)       el.style.color = 'var(--red)';
  else if (val > warnThresh) el.style.color = 'var(--orange)';
  else                       el.style.color = 'var(--accent)';
}

// =====================================================================
// AUDIO
// =====================================================================
let audioQueue   = [];
let audioPlaying = false;

function playAudio(text) {
  // Jangan duplikasi jika teks sama sudah ada di queue
  if (audioQueue.includes(text)) return;
  audioQueue.push(text);
  processAudioQueue();
}

function processAudioQueue() {
  if (audioPlaying || audioQueue.length === 0) return;
  audioPlaying = true;

  const text = audioQueue.shift();
  document.getElementById('audioText').textContent = text;
  document.getElementById('audioStatus').textContent  = 'Playing';
  document.getElementById('audioStatus').className    = 'badge badge-green';

  renderAudioQueue();

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = 'id-ID';
    utt.rate   = 0.95;
    utt.pitch  = 1.0;

    const voices  = window.speechSynthesis.getVoices();
    const idVoice = voices.find(v => v.lang.startsWith('id') || v.lang.startsWith('ms'));
    if (idVoice) utt.voice = idVoice;

    utt.onend = () => {
      audioPlaying = false;
      document.getElementById('audioStatus').textContent = 'Ready';
      document.getElementById('audioStatus').className   = 'badge badge-green';
      processAudioQueue();
    };
    utt.onerror = () => {
      audioPlaying = false;
      processAudioQueue();
    };
    window.speechSynthesis.speak(utt);
  } else {
    setTimeout(() => {
      audioPlaying = false;
      document.getElementById('audioStatus').textContent = 'Ready';
      document.getElementById('audioStatus').className   = 'badge badge-green';
      processAudioQueue();
    }, 1500);
  }
}

function renderAudioQueue() {
  const el = document.getElementById('audioQueue');
  el.innerHTML = audioQueue.length > 0
    ? audioQueue.slice(0, 3).map(t => `<span style="opacity:0.6">⬦ ${t}</span>`).join('')
    : '';
}

function setAudioBusy() {
  document.getElementById('audioStatus').textContent = 'Processing...';
  document.getElementById('audioStatus').className   = 'badge badge-orange';
}

// =====================================================================
// COMMANDS
// =====================================================================
function setMode(mode) {
  state.mode = mode;
  state.detections = [];
  renderDetections();

  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const modeMap = { explorer: 'btnExplorer', context: 'btnContext', qris: 'btnQris' };
  document.getElementById(modeMap[mode])?.classList.add('active');

  const modeNames = { explorer: 'Explorer Mode', context: 'Context Mode', qris: 'QRIS Scan Mode' };
  log('info', `Mode diubah: <strong>${modeNames[mode]}</strong>`);

  if (mode !== 'explorer') {
    entities = [];  // clear entities saat ganti mode
    document.getElementById('overlayDetections').innerHTML = '';
  }

  const phrases = { explorer: 'mode penjelajah aktif', context: 'mode konteks aktif', qris: 'mode scan bayar aktif' };
  playAudio(phrases[mode]);

  if (!MOCK_MODE) sendLiveCommand('set_mode', { mode });
}

function cmdAIFocus() {
  if (!state.aiFocusActive) {
    if (MOCK_MODE) startAiFocus();
    else sendLiveCommand('focus');
  }
}
function cmdCapture() {
  flashCamera();
  log('ok', `Frame captured — /root/captures/capture_${Date.now()}.jpg`);
  if (!MOCK_MODE) sendLiveCommand('capture');
}
function cmdQris() {
  log('info', 'Memindai QRIS...');
  setAudioBusy();
  if (MOCK_MODE) {
    setTimeout(() => {
      const results = [
        'MERCHANT: Warung Bu Siti, NOMINAL: Rp 25.000',
        'MERCHANT: Alfamart Jl. Sudirman, NOMINAL: Rp 47.500',
        'BUKAN QRIS — objek yang terdeteksi bukan kode QRIS',
        'MERCHANT: GoFood Partner, NOMINAL: tidak tertera',
      ];
      const r = results[Math.floor(state.tick / 100) % results.length];
      playAudio(r);
      log('ok', `QRIS: ${r}`);
    }, 1800);
  } else {
    sendLiveCommand('qris');
  }
}
function cmdDescribe() {
  log('info', 'Mengirim frame ke OpenAI Vision...');
  setAudioBusy();
  if (MOCK_MODE) {
    const scenes = [
      'Jalan raya dengan beberapa kendaraan bermotor. Sepeda motor di sebelah kiri, pejalan kaki di tengah.',
      'Area parkir dengan mobil terparkir. Tidak ada pergerakan signifikan terdeteksi.',
      'Trotoar dengan pejalan kaki. Terdapat tiang listrik di latar belakang.',
      'Persimpangan jalan. Terlihat beberapa kendaraan dan pejalan kaki.',
    ];
    // Pilih deskripsi berdasarkan entitas yang ada di scene saat ini
    let desc;
    const types = entities.map(e => e.type);
    if (types.includes('motorcycle') && types.includes('person')) {
      desc = 'Jalan raya. Sepeda motor bergerak dari kiri, ada orang berjalan di sebelah kanan.';
    } else if (types.includes('bus')) {
      desc = 'Bus besar terlihat mendekati dari depan. Waspadai kendaraan besar.';
    } else if (types.includes('car')) {
      desc = 'Satu atau dua mobil terlihat di jalan. Kondisi lalu lintas relatif sepi.';
    } else {
      desc = scenes[Math.floor(state.tick / 150) % scenes.length];
    }
    setTimeout(() => {
      playAudio(desc);
      log('ok', `Scene: ${desc}`);
    }, 2200);
  } else {
    sendLiveCommand('describe');
  }
}
function cmdBenchmark() {
  log('info', 'Menjalankan benchmark semua subsistem...');
  setTimeout(() => {
    const l = state.latency;
    const pre = 7;
    const aq  = 2;
    const total = l.camera + pre + l.inference + l.postproc + aq;
    const fps   = (1000 / total).toFixed(1);

    log('ok', 'Benchmark selesai:');
    log('info', `  Camera capture: <strong>${l.camera}ms</strong>`);
    log('info', `  Preprocessing:  <strong>${pre}ms</strong>`);
    log('info', `  Inference:      <strong>${l.inference}ms</strong>`);
    log('info', `  Postprocessing: <strong>${l.postproc}ms</strong>`);
    log('info', `  Audio queue:    <strong>${aq}ms</strong>`);
    log('ok',   `  Total pipeline: <strong>${total}ms</strong> | FPS Est: <strong>${fps}</strong>`);
  }, 1200);
}

// =====================================================================
// AI FOCUS
// =====================================================================
let focusTimer = null;

function startAiFocus() {
  if (state.aiFocusActive) return;

  const DURATION = 5;
  state.aiFocusActive = true;

  const btn = document.getElementById('btnAiFocus');
  btn.classList.add('running');

  document.getElementById('focusSection').style.display = '';
  document.getElementById('focusProgress').style.width  = '100%';
  document.getElementById('focusTimer').textContent     = `${DURATION}s`;

  log('warn', 'AI Focus aktif — inferensi fokus, snapshot web dijeda');
  playAudio('sedang menganalisis');

  let elapsed = 0;
  focusTimer = setInterval(() => {
    elapsed++;
    const pct = ((DURATION - elapsed) / DURATION) * 100;
    document.getElementById('focusProgress').style.width = pct + '%';
    document.getElementById('focusTimer').textContent    = `${DURATION - elapsed}s`;

    if (elapsed >= DURATION) {
      clearInterval(focusTimer);
      state.aiFocusActive = false;
      btn.classList.remove('running');
      btn.innerHTML = '<span class="ctrl-icon">⚡</span> AI Focus 5s';
      document.getElementById('focusSection').style.display = 'none';
      log('ok', 'AI Focus selesai — mode normal dilanjutkan');
    }
  }, 1000);
}

// =====================================================================
// LIVE MODE (MaixCAM)
// =====================================================================
function initLiveMode() {
  const img    = document.getElementById('cameraImg');
  const cvs    = document.getElementById('cameraCanvas');
  cvs.style.display = 'none';
  img.style.display = 'block';

  function refreshSnapshot() {
    if (!state.aiFocusActive) {
      img.onload = () => {
        state.frameCount++;
        const now = Date.now();
        if (now - state.lastFpsTime >= 1000) {
          state.fps = state.frameCount;
          state.frameCount = 0;
          state.lastFpsTime = now;
          document.getElementById('fpsCounter').textContent = `${state.fps} fps`;
        }
      };
      img.src = `${DEVICE_URL}/snapshot?t=${Date.now()}`;
    }
    setTimeout(refreshSnapshot, SNAPSHOT_INTERVAL);
  }
  refreshSnapshot();
  pollLiveStatus();
}

async function pollLiveStatus() {
  try {
    const res  = await fetch(`${DEVICE_URL}/status`);
    const data = await res.json();

    setStatus('connected', 'Connected');
    state.mode       = data.mode || state.mode;
    state.detections = data.detections || [];
    state.latency    = data.latency    || state.latency;
    renderDetections();
    renderLatency();
    if (data.audio_text) playAudio(data.audio_text);
  } catch {
    setStatus('error', 'Disconnected');
  }
  setTimeout(pollLiveStatus, STATUS_INTERVAL);
}

async function sendLiveCommand(cmd, extra = {}) {
  try {
    await fetch(`${DEVICE_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd, ...extra }),
    });
  } catch (e) {
    log('error', `Command failed: ${cmd}`);
  }
}

// =====================================================================
// UI HELPERS
// =====================================================================
function setStatus(type, text) {
  document.getElementById('statusDot').className  = `status-dot ${type}`;
  document.getElementById('statusText').textContent = text;
}

function flashCamera() {
  const frame = document.getElementById('cameraFrame');
  frame.style.transition = 'filter 0.08s';
  frame.style.filter = 'brightness(4) saturate(0)';
  setTimeout(() => { frame.style.filter = ''; }, 120);
}

// =====================================================================
// LOGGING
// =====================================================================
const MAX_LOGS = 200;

function log(level, message) {
  const now  = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  const body  = document.getElementById('logBody');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">[${time}]</span>
    <span class="log-level ${level}">${level.toUpperCase()}</span>
    <span class="log-msg">${message}</span>
  `;
  body.appendChild(entry);

  // Trim jika terlalu panjang
  while (body.children.length > MAX_LOGS) body.removeChild(body.firstChild);

  if (document.getElementById('autoScrollToggle').checked) {
    body.scrollTop = body.scrollHeight;
  }
}

function clearLogs() {
  document.getElementById('logBody').innerHTML = '';
  log('info', 'Log dibersihkan');
}

// =====================================================================
// INIT
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  log('info', 'AuralAI Dev Dashboard v1.0 dimuat');

  if (MOCK_MODE) {
    setStatus('mock', 'Mock Mode');
    log('info', 'MOCK MODE aktif — simulasi fisik berjalan di browser');
    log('info', 'Thread AI Loop : running (simulated)');
    log('info', 'Web Server     : running (simulated)');
    log('info', `Mode aktif     : Explorer`);
    renderLatency();

    // Spawn 1 entity awal agar tidak kosong
    setTimeout(() => spawnEntity('motorcycle', 1), 500);
    setTimeout(() => spawnEntity('person', -1),    1200);
  } else {
    log('info', `Menghubungkan ke: ${DEVICE_URL || window.location.origin}`);
    initLiveMode();
  }

  document.getElementById('overlayToggle').addEventListener('change', e => {
    state.overlayVisible = e.target.checked;
    if (!e.target.checked) document.getElementById('overlayDetections').innerHTML = '';
  });

  // Preload speech synthesis voices
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener('voiceschanged', () => window.speechSynthesis.getVoices());
  }

  // Mulai loop
  requestAnimationFrame(simLoop);
});
