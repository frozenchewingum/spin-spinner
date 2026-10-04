(function () {
  if (customElements.get('fidget-spinner')) return;
  const loadThree = () => import((window.__resources && window.__resources.three) || 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js');
  const parseBool = v => !(v === false || v === 'off' || v === 'false' || v === '0');

  const SKINS = {
    plum: { body: '#5b3a78', cap: '#eaa3c4' },
    rose: { body: '#c9708f', cap: '#ffd6c0' },
    ink: { body: '#2a2f5c', cap: '#a9b4ff' },
    chrome: { body: '#d9d6e6', cap: '#5b3a78', metal: 1, rough: 0.12 },
    gold: { body: '#d6a55c', cap: '#2a1f40', metal: 1, rough: 0.28 },
    glass: { body: '#f3d9ff', cap: '#eaa3c4', glass: true },
    matte: { body: '#1d1a26', cap: '#ff8fb6', rough: 0.95, coat: 0 },
  };
  const SHAPES = {
    tri: { n: 3, base: 0.86, amp: 0.5, p: 0.8, min: 0.56, lobe: 0.95, lr: 0.36 },
    bar: { n: 2, base: 0.86, amp: 0.5, p: 0.8, min: 0.5, lobe: 0.95, lr: 0.36 },
    quad: { n: 4, base: 0.82, amp: 0.48, p: 0.8, min: 0.58, lobe: 0.9, lr: 0.32 },
    star: { n: 5, base: 0.78, amp: 0.5, p: 0.6, min: 0.55, lobe: 0.88, lr: 0.26 },
    wheel: { n: 6, disc: 1.3, lobe: 0.88, lr: 0.22 },
  };
  const parseSkin = v => {
    if (SKINS[v]) return SKINS[v];
    const m = /^custom:(#[0-9a-f]{6}):(#[0-9a-f]{6})$/i.exec(v || ''); return m ? { body: m[1], cap: m[2] } : null;
  };


  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  let _silentEl = null;
  function silentWavURL() {
    const sr = 8000, n = sr / 2, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  function playSilentEl() {
    if (window.__dsSilentAudio) return;
    try {
      const el = _silentEl = window.__dsSilentAudio = document.createElement('audio');
      el.setAttribute('x-webkit-airplay', 'deny'); el.preload = 'auto'; el.loop = true; el.playsInline = true;
      el.src = silentWavURL(); el.volume = 0.01;
      const p = el.play(); if (p && p.catch) p.catch(() => { window.__dsSilentAudio = null; });
    } catch (e) {}
  }
  const A = { ctx: null };
  function audio() {
    if (!A.ctx) {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
      const c = A.ctx = new C();
      A.master = c.createGain(); A.master.gain.value = 0.7; A.master.connect(c.destination);
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const n = c.createBufferSource(); n.buffer = buf; n.loop = true;
      A.bp = c.createBiquadFilter(); A.bp.type = 'bandpass'; A.bp.Q.value = 3; A.bp.frequency.value = 300;
      A.am = c.createGain(); A.am.gain.value = 0.5;
      A.lfo = c.createOscillator(); A.lfo.frequency.value = 1; A.lfoD = c.createGain(); A.lfoD.gain.value = 0.5;
      A.lfo.connect(A.lfoD); A.lfoD.connect(A.am.gain);
      A.whirr = c.createGain(); A.whirr.gain.value = 0;
      n.connect(A.bp); A.bp.connect(A.am); A.am.connect(A.whirr); A.whirr.connect(A.master);
      A.hum = c.createOscillator(); A.hum.type = 'sine'; A.hum.frequency.value = 60;
      A.humF = c.createBiquadFilter(); A.humF.type = 'lowpass'; A.humF.frequency.value = 500;
      A.humG = c.createGain(); A.humG.gain.value = 0;
      A.hum.connect(A.humF); A.humF.connect(A.humG); A.humG.connect(A.master);
      n.start(); A.lfo.start(); A.hum.start();
    }
    if (A.ctx.state !== 'running' && !_asleep && !document.hidden) A.ctx.resume();
    return A.ctx;
  }

  let _unlocked = false, _soundOn = true, _asleep = false;
  // Stop everything that makes the phone treat the page as a media player: the looping silent track,
  // the always-running whirr/hum oscillators, and the 'playback' audio session. Woken by the next tap.
  function sleepAudio() {
    _asleep = true; _unlocked = false;
    try { if (_silentEl) { _silentEl.pause(); _silentEl.removeAttribute('src'); _silentEl.load(); } } catch (e) {}
    _silentEl = window.__dsSilentAudio = null;
    try { if (A.ctx && A.ctx.state === 'running') A.ctx.suspend(); } catch (e) {}
    try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch (e) {}
    try { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'none'; } catch (e) {}
  }
  function unlockAudio() {
    if (!_soundOn || document.hidden) return;
    _asleep = false;
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) {}
    playSilentEl();
    const c = audio(); if (!c) return;
    if (c.state !== 'running') c.resume();
    if (_unlocked && c.state === 'running') return;
    const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0);
    if (c.state === 'running') _unlocked = true;
  }
  ['touchend', 'pointerup', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, unlockAudio, { capture: true, passive: true }));
  // Screen off, app switched, tab hidden or page closing: go fully silent. Sound returns on the next tap.
  document.addEventListener('visibilitychange', () => { if (document.hidden) sleepAudio(); });
  window.addEventListener('pagehide', sleepAudio);
  document.addEventListener('freeze', sleepAudio);
  window.addEventListener('blur', () => { if (document.hidden) sleepAudio(); });
  function click(gain) {
    const c = A.ctx; if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(380, t + 0.05);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g); g.connect(A.master); o.start(t); o.stop(t + 0.1);
  }

  const MODES = {
    endurance: { unit: 'turns', budget: 3, fmt: v => String(Math.floor(v)) },
    zone: { unit: 'seconds in zone', budget: 20, fmt: v => v.toFixed(1) },
    speed: { unit: 'rev/s peak', budget: 5, fmt: v => v.toFixed(1) },
  };
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093];
  function ping(f, dur, gain, type = 'sine', f1) {
    const c = A.ctx; if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain(); o.type = type;
    o.frequency.setValueAtTime(f, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(A.master); o.start(t); o.stop(t + dur + 0.05);
  }
  const SND = {
    perfect: i => { const f = SCALE[Math.min(i, SCALE.length - 1)]; ping(f, 0.7, 0.09); ping(f * 2, 0.45, 0.03); ping(f * 1.5, 0.5, 0.02); },
    good: () => ping(440, 0.25, 0.05, 'triangle'),
    miss: () => { ping(140, 0.35, 0.14, 'triangle', 60); },
    start: () => ping(392, 0.35, 0.06),
  };
  const zoneAt = t => Math.min(5.5, Math.max(1.5, 3.2 + 1.5 * Math.sin(t * 0.26) + 0.7 * Math.sin(t * 0.11 + 0.8)));
  const ZONE_HALF = 0.85, ZONE_LEN = 30;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class FidgetSpinner extends HTMLElement {
    static get observedAttributes() { return ['sound', 'color', 'mode', 'shape', 'studio', 'remote', 'locked', 'noskip']; }
    // remote: a watch-only replica driven by applyRemote(); no input, no sound, no HUD, never fires spinend.
    set remote(v) { this._remote = parseBool(v) && v !== null; if (this._hud) this._applyRemoteUi(); } get remote() { return !!this._remote; }
    // locked: ignore swipes (e.g. before a VS countdown ends). noskip: hide 'Skip to end'.
    set locked(v) { this._locked = v !== null && parseBool(v); } get locked() { return !!this._locked; }
    set noskip(v) { this._noskip = v !== null && parseBool(v); } get noskip() { return !!this._noskip; }
    set studio(v) { this._studio = parseBool(v); if (this._hud) this._hud.style.opacity = this._studio ? 0 : 1; } get studio() { return !!this._studio; }
    set shape(v) { if (SHAPES[v] && v !== this._p.shape) { this._p.shape = v; this._buildBody(); } } get shape() { return this._p.shape; }
    constructor() {
      super(); this._p = { sound: true, color: 'plum', mode: 'endurance', shape: 'tri' };
      this.omega = 0; this.angle = 0; this._run = null; this._combo = 0; this._wob = 0;
      this._flash = 0; this._shake = 0; this._beat = 0; this._judgeT = -9; this._last = null; this._swKey = '';
    }
    set mode(v) { if (MODES[v] && v !== this._p.mode) { this._p.mode = v; this.omega = 0; this._run = null; this._combo = 0; this._wob = 0; this._lastScore = null; this._swKey = ''; } }
    get mode() { return this._p.mode; }
    set sound(v) { this._p.sound = parseBool(v); if (this._remote) return; _soundOn = this._p.sound; if (!_soundOn) sleepAudio(); } get sound() { return this._p.sound; }
    set color(v) { if (parseSkin(v)) { this._p.color = v; this._applyColor(); } } get color() { return this._p.color; }
    attributeChangedCallback(n, o, v) { if (v === null && (n === 'remote' || n === 'locked' || n === 'noskip')) { this[n] = null; return; } this[n] = v; }

    connectedCallback() {
      if (this._root) return;
      this.style.display = 'block'; this.style.position = 'relative';
      if (!this.style.width) this.style.width = '100%';
      if (!this.style.height) this.style.height = '100%';
      const root = this._root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <div id="stage" style="position:absolute;inset:0;touch-action:none;cursor:grab;-webkit-tap-highlight-color:transparent"></div>
        <div id="flash" style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(55% 45% at 50% 58%,rgba(255,214,230,.5),rgba(255,214,230,0) 70%);opacity:0"></div>
        <div id="hud" style="position:absolute;top:calc(max(20px,env(safe-area-inset-top)) + 58px);left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;transition:opacity .4s ease">
          <div id="score" style="font:400 60px/1 'Instrument Serif',Georgia,serif;color:#e9e7ff;font-variant-numeric:tabular-nums">0</div>
          <div id="unit" style="font:500 10px/1 'Geist Mono',ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:#9a90ae"></div>
          <div id="gauge" style="position:relative;width:220px;height:6px;margin-top:10px;border-radius:3px;background:rgba(255,255,255,.08);display:none">
            <div id="band" style="position:absolute;top:-4px;bottom:-4px;border-radius:7px;background:rgba(234,163,196,.18);box-shadow:inset 0 0 0 1px rgba(234,163,196,.5)"></div>
            <div id="needle" style="position:absolute;top:-6px;width:2px;height:18px;margin-left:-1px;border-radius:1px;background:#e9e7ff"></div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;margin-top:10px">
            <div id="sw" style="display:flex;gap:6px"></div>
            <div id="rpm" style="font:400 10px/1 'Geist Mono',ui-monospace,monospace;letter-spacing:.18em;color:#c9bfd8;min-width:70px"></div>
          </div>
          <button id="skip" style="display:none;pointer-events:auto;min-height:44px;margin-top:4px;padding:0 20px;border:1px solid rgba(255,214,192,.55);border-radius:999px;background:rgba(234,163,196,.16);color:#ffd6c0;font:500 12px/1 'Geist Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;-webkit-tap-highlight-color:transparent">Skip to end ›</button>
          <div id="judge" style="height:52px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;opacity:0">
            <div id="jw" style="font:italic 400 30px/1 'Instrument Serif',Georgia,serif;color:#ffd6c0"></div>
            <div id="cb" style="font:500 10px/1 'Geist Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#eaa3c4"></div>
          </div>
        </div>
        <div id="hint" style="position:absolute;bottom:calc(max(28px,env(safe-area-inset-bottom)) + 76px);left:0;right:0;text-align:center;font:500 10px/1.6 'Geist Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:#9aa0c8;pointer-events:none;transition:opacity 1.2s ease">flick along the edge<br>swipe again as the ring lands</div>`;
      const $ = id => root.getElementById(id);
      this._stage = $('stage'); this._hint = $('hint'); this._rpm = $('rpm');
      this._sw = $('sw'); this._scoreEl = $('score'); this._unitEl = $('unit'); this._gauge = $('gauge'); this._band = $('band'); this._needle = $('needle');
      this._skipEl = $('skip'); this._skipEl.addEventListener('click', () => this.skip());
      this._hud = $('hud'); this._hud.style.opacity = this._studio ? 0 : 1;
      this._judgeEl = $('judge'); this._jw = $('jw'); this._cb = $('cb'); this._flashEl = $('flash');
      this._applyRemoteUi();
      loadThree().then(T => { if (this.isConnected) this._init(T); });
    }
    disconnectedCallback() {
      cancelAnimationFrame(this._raf); this._ro && this._ro.disconnect();
      if (this._renderer) { this._renderer.dispose(); this._renderer.forceContextLoss(); }
      if (A.ctx) { const t = A.ctx.currentTime; [A.whirr.gain, A.humG.gain].forEach(p => { p.cancelScheduledValues(t); p.setValueAtTime(0, t); }); }
      if (!this._remote) sleepAudio();
      this._renderer = null; this._root = null; if (this.shadowRoot) this.shadowRoot.innerHTML = '';
    }

    _init(T) {
      this.T = T;
      const r = this._renderer = new T.WebGLRenderer({ antialias: true });
      r.setPixelRatio(this._remote ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2));
      r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
      r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.2;
      r.domElement.style.cssText = 'display:block;width:100%;height:100%';
      this._stage.appendChild(r.domElement);
      const scene = this._scene = new T.Scene();
      scene.background = new T.Color('#110b1d');
      this._cam = new T.PerspectiveCamera(30, 1, 0.1, 100);

      const pm = new T.PMREMGenerator(r), es = new T.Scene();
      es.add(new T.Mesh(new T.BoxGeometry(12, 12, 12), new T.MeshBasicMaterial({ color: 0x0b0714, side: T.BackSide })));
      const panel = (rgb, x, y, z, w, h) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color().setRGB(...rgb), side: T.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m); };
      panel([3.2, 3.0, 3.1], 0, 5, 1.5, 5, 2.5);
      panel([2.2, 0.9, 1.5], 4, 1.2, -4, 3, 3);
      panel([0.7, 0.85, 1.8], -4.5, 1, 1.5, 2.5, 3);
      scene.environment = pm.fromScene(es, 0.04).texture;

      const sun = new T.DirectionalLight(0xfff2f6, 1.5); sun.position.set(1.8, 6, 2.2); sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 8; sun.shadow.bias = -0.0005;
      Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 15 });
      scene.add(sun, new T.HemisphereLight(0x8a78c0, 0x1a1028, 0.7));

      const ground = new T.Mesh(new T.CircleGeometry(3.2, 96), new T.MeshStandardMaterial({ color: '#2a1f40', roughness: 0.9 }));
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

      const grp = this._spin = new T.Group(); grp.position.y = 0.32;
      const tilt = this._tilt = new T.Group(); tilt.add(grp); scene.add(tilt);

      this._bodyMat = new T.MeshPhysicalMaterial({ color: '#5b3a78', roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.35, sheen: 0.5, sheenColor: new T.Color('#ffd6e6') });
      this._steel = new T.MeshStandardMaterial({ color: '#d8d4e6', metalness: 1, roughness: 0.18 });
      this._dark = new T.MeshStandardMaterial({ color: '#1a1426', metalness: 0.6, roughness: 0.4 });
      this._ballG = new T.SphereGeometry(0.045, 16, 12);
      this._buildBody();

      const capG = new T.CylinderGeometry(0.34, 0.36, 0.1, 64);
      this._capMat = new T.MeshPhysicalMaterial({ color: '#eaa3c4', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 });
      this._caps = [0.13, -0.13].map(y => { const m = new T.Mesh(capG, this._capMat); m.position.y = y + 0.32; m.castShadow = true; tilt.add(m); return m; });
      const dimple = new T.Mesh(new T.TorusGeometry(0.2, 0.012, 8, 64).rotateX(Math.PI / 2), new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, transparent: true, opacity: 0.35 }));
      dimple.position.y = 0.32 + 0.185; tilt.add(dimple);
      this._applyColor();
      const ringM = c => new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false });
      this._pulse = new T.Mesh(new T.RingGeometry(0.982, 1, 160), ringM('#eaa3c4'));
      this._target = new T.Mesh(new T.RingGeometry(0.965, 1, 160), ringM('#ffd6c0'));
      [this._pulse, this._target].forEach(m => { m.rotation.x = -Math.PI / 2; m.position.y = 0.006; scene.add(m); });
      this._target.scale.setScalar(1.55);

      this._ray = new T.Raycaster(); this._plane = new T.Plane(new T.Vector3(0, 1, 0), -0.32);
      this._bindPointer();
      this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this); this._resize();
      this._last = null; this._lobePhase = 0; this._t = 0; this._acc = 0;
      const loop = now => { this._raf = requestAnimationFrame(loop); this._frame(now); };
      this._raf = requestAnimationFrame(loop);
    }
    _buildBody() {
      const T = this.T, grp = this._spin; if (!grp) return;
      if (this._bodyGrp) { grp.remove(this._bodyGrp); this._bodyGrp.traverse(o => { if (o.geometry && o.geometry !== this._ballG) o.geometry.dispose(); }); }
      const g = this._bodyGrp = new T.Group(); grp.add(g);
      const S = SHAPES[this._p.shape] || SHAPES.tri, n = S.n, LOBE = S.lobe, LR = S.lr;
      const outline = new T.Shape(), N = 360;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2, c = Math.cos(n * a);
        const rad = S.disc || Math.max(S.min, S.base + S.amp * Math.sign(c) * Math.pow(Math.abs(c), S.p));
        i ? outline.lineTo(Math.cos(a) * rad, Math.sin(a) * rad) : outline.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      const hole = (x, y, r) => { const h = new T.Path(); h.absarc(x, y, r, 0, Math.PI * 2, true); return h; };
      for (let k = 0; k < n; k++) { const a = k * Math.PI * 2 / n; outline.holes.push(hole(Math.cos(a) * LOBE, Math.sin(a) * LOBE, LR)); }
      outline.holes.push(hole(0, 0, 0.3));
      const bodyG = new T.ExtrudeGeometry(outline, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 6, curveSegments: 48 });
      bodyG.rotateX(-Math.PI / 2); bodyG.translate(0, -0.06, 0);
      const body = new T.Mesh(bodyG, this._bodyMat); body.castShadow = true; g.add(body);
      const steel = this._steel, dark = this._dark;
      for (let k = 0; k < n; k++) {
        const a = k * Math.PI * 2 / n, b = new T.Group(); b.position.set(Math.cos(a) * LOBE, 0, -Math.sin(a) * LOBE);
        const rg = new T.Mesh(new T.TorusGeometry(LR - 0.035, 0.045, 18, 64).rotateX(Math.PI / 2), steel); rg.castShadow = true; b.add(rg);
        b.add(new T.Mesh(new T.CylinderGeometry(LR - 0.07, LR - 0.07, 0.15, 64), dark));
        const balls = Math.max(6, Math.round(LR * 25));
        for (let q = 0; q < balls; q++) { const t = q / balls * Math.PI * 2, m = new T.Mesh(this._ballG, steel); m.position.set(Math.cos(t) * LR * 0.62, 0.08, Math.sin(t) * LR * 0.62); b.add(m); }
        b.add(new T.Mesh(new T.CylinderGeometry(LR * 0.38, LR * 0.38, 0.17, 48), steel));
        g.add(b);
      }
    }
    _applyColor() {
      if (!this._bodyMat) return; const c = parseSkin(this._p.color) || SKINS.plum, b = this._bodyMat;
      b.color.set(c.body); b.metalness = c.metal || 0; b.roughness = c.glass ? 0.04 : (c.rough ?? 0.42);
      b.transmission = c.glass ? 1 : 0; b.thickness = c.glass ? 0.35 : 0; b.ior = 1.45;
      b.clearcoat = c.coat ?? (c.metal ? 1 : 0.6); b.sheen = c.metal || c.glass ? 0 : 0.5; b.needsUpdate = true;
      this._capMat.color.set(c.cap);
    }
    _resize() {
      if (!this._renderer) return;
      const w = this.clientWidth || 1, h = this.clientHeight || 1, a = w / h;
      this._renderer.setSize(w, h, false); this._cam.aspect = a;
      const tan = Math.tan((this._cam.fov / 2) * Math.PI / 180);
      const dist = Math.max(2.75 / tan, 2.25 / (tan * a));
      const el = 58 * Math.PI / 180;
      this._cam.position.set(0, Math.sin(el) * dist, Math.cos(el) * dist);
      this._cam.lookAt(0, 0.1, -0.45); this._cam.updateProjectionMatrix(); this._camBase = this._cam.position.clone();
    }
    _at(e) {
      const r = this._stage.getBoundingClientRect();
      this._ray.setFromCamera(new this.T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this._cam);
      const v = new this.T.Vector3(); return this._ray.ray.intersectPlane(this._plane, v) ? v : null;
    }
    _bindPointer() {
      const el = this._stage; let drag = null;
      el.addEventListener('pointerdown', e => {
        if (this._studio || this._remote) return;
        const p = this._at(e); if (!p) return;
        el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing';
        if (this._p.sound) audio();
        const rad = Math.hypot(p.x, p.z);
        if (rad < 0.38) { this._brake = true; this._caps.forEach(c => c.scale.y = 0.7); if (this._p.sound && A.ctx) click(0.06); return; }
        const a = Math.atan2(-p.z, p.x);
        drag = { s: [{ a, t: performance.now(), r: rad }], raw: a, un: a, arc: 0 };
      });
      el.addEventListener('pointermove', e => {
        if (!drag) return; const p = this._at(e); if (!p) return;
        const a = Math.atan2(-p.z, p.x);
        let d = a - drag.raw; if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
        drag.raw = a; drag.un += d; drag.arc += Math.abs(d);
        if (!this._run) { this.angle += d; this.omega = 0; }
        drag.s.push({ a: drag.un, t: performance.now(), r: Math.hypot(p.x, p.z) });
      });
      const up = () => {
        el.style.cursor = 'grab';
        if (this._brake) { this._brake = false; this._caps.forEach(c => c.scale.y = 1); }
        if (drag) { this._flick(drag); drag = null; }
      };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', () => { drag = null; up(); });
    }

    _say(word, sub) { this._jw.textContent = word; this._cb.textContent = sub || ''; this._judgeT = this._t; this._said = [word, sub || '']; }
    // Snapshot of everything a replica needs to continue the spin by itself.
    snapshot() {
      const r = this._run;
      return { omega: this.omega, angle: this.angle, wob: this._wob, beat: this._beat, brake: !!this._brake,
        run: r ? { used: r.used, turns: r.turns, peak: r.peak, zone: r.zone, t: this._t - r.t0 } : null, last: this._lastScore };
    }
    _emit(type, extra) {
      if (this._remote) return;
      const detail = Object.assign({ mode: this._p.mode, state: this.snapshot() }, extra || {});
      try { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })); } catch (e) {}
    }
    // Drive a remote replica from a received snapshot. Between snapshots it spins down by the same fixed-step physics.
    applyRemote(s, word, sub) {
      if (!s) return;
      this.omega = s.omega; this.angle = s.angle; this._wob = s.wob; this._beat = s.beat || 0; this._brake = !!s.brake;
      if (s.run) {
        if (!this._run) this._run = { used: 0, turns: 0, zone: 0, peak: 0, score: 0, t0: this._t, inZone: false };
        Object.assign(this._run, { used: s.run.used, turns: s.run.turns, peak: s.run.peak, zone: s.run.zone, t0: this._t - (s.run.t || 0) });
      } else { this._run = null; this._lastScore = s.last; }
      if (word) { this._say(word, sub); if (word === 'perfect') { this._flash = 1; } }
    }
    resetRun() { this.omega = 0; this._run = null; this._combo = 0; this._wob = 0; this._lastScore = null; this._brake = false; this._swKey = ''; }
    _applyRemoteUi() {
      if (!this._hud) return;
      const r = !!this._remote;
      this._hud.style.display = r ? 'none' : 'flex'; this._hint.style.display = r ? 'none' : 'block';
      this._stage.style.cursor = r ? 'default' : 'grab'; this._stage.style.touchAction = r ? 'auto' : 'none';
    }

    _flick(d) {
      if (this._locked || this._remote) return;
      this._said = null;
      this._flickInner(d);
      if (this._said) this._emit('spinswipe', { word: this._said[0], sub: this._said[1] });
    }
    _flickInner(d) {
      const s = d.s, now = performance.now(), last = s[s.length - 1];
      if (s.length < 2 || now - last.t > 120) return;
      let k = s.length - 1; while (k > 0 && last.t - s[k - 1].t < 90) k--;
      const base = s[Math.max(0, k - 1)];
      const v = (last.a - base.a) / Math.max(0.016, (last.t - base.t) / 1000);
      if (Math.abs(v) < 2.5) return;
      const sg = Math.sign(v), vs = [];
      for (let i = 1; i < s.length; i++) { const dt = (s[i].t - s[i - 1].t) / 1000; if (dt > 0.004) vs.push(sg * (s[i].a - s[i - 1].a) / dt); }
      const mean = vs.reduce((x, y) => x + y, 0) / Math.max(1, vs.length);
      const sd = Math.sqrt(vs.reduce((x, y) => x + (y - mean) * (y - mean), 0) / Math.max(1, vs.length));
      const smooth = clamp(1 - Math.max(0, (mean > 0 ? sd / mean : 1) - 0.35) * 0.7, 0.35, 1);
      const meanR = s.reduce((x, y) => x + y.r, 0) / s.length;
      const edge = meanR > 0.9 && meanR < 2.1 ? 1 : 0.6;
      const arcF = clamp(d.arc / 1.6, 0.25, 1);
      const q = smooth * edge * arcF;
      const m = MODES[this._p.mode], snd = this._p.sound && A.ctx;
      this._hint.style.opacity = 0;
      if (this._run && this._run.used >= m.budget) { this._say('no swipes left', 'let it spin out'); return; }
      const I = Math.min(Math.abs(v), 70) * (0.35 + 0.65 * q);
      const qTxt = Math.round(q * 100) + '% swipe';
      let mult = 1;
      if (this._p.mode === 'zone' && this._run && this.omega !== 0) {
        const dv = clamp(Math.abs(v) * 0.03 * (0.4 + 0.6 * q), 0.25, 1.4) * Math.PI * 2, same = sg === Math.sign(this.omega);
        this.omega = Math.sign(this.omega) * Math.max(0.3, Math.abs(this.omega) + (same ? dv : -dv));
        this._run.used++; this._say(same ? 'faster' : 'slower', '±' + (dv / (Math.PI * 2)).toFixed(1) + ' rev/s · ' + qTxt);
        if (snd) (same ? SND.good() : SND.miss()); return;
      }
      if (!this._run || this.omega === 0) {
        this._run = { used: 0, turns: 0, zone: 0, peak: 0, score: 0, t0: this._t, inZone: false };
        this._combo = 0; this._wob = 0; this._beat = 0.3; this._lastScore = null;
        this._say('go', qTxt); if (snd) SND.start();
      } else if (sg !== Math.sign(this.omega)) {
        this.omega *= 0.55; this._combo = 0; this._run.used++;
        this._say('reversed', 'that slowed it'); if (snd) SND.miss(); return;
      } else {
        const rps = Math.abs(this.omega) / (Math.PI * 2);
        const P = this._period(rps), W = Math.max(0.08, 0.2 - rps * 0.008);
        const lag = Math.min(0.15, (now - base.t) / 1000 * 0.6);
        const ph = ((this._beat - lag / P) % 1 + 1) % 1;
        const e = Math.min(ph, 1 - ph) * P;
        if (e < W * 0.55) {
          this._combo++; mult = 1.35 + 0.08 * Math.min(this._combo, 10);
          this._wob = Math.max(0, this._wob - 0.2); this._flash = 1; this._shake = 1;
          this._say('perfect', '×' + this._combo + ' combo · ' + qTxt); if (snd) SND.perfect(this._combo - 1);
        } else if (e < W) {
          this._wob = Math.min(1, this._wob + 0.06);
          this._say('good', (this._combo ? '×' + this._combo + ' combo · ' : '') + qTxt); if (snd) SND.good();
        } else {
          mult = 0; this.omega *= 0.82; this._combo = 0; this._wob = Math.min(1, this._wob + 0.3); this._shake = 0.4;
          this._say('miss', 'wait for the ring'); if (snd) SND.miss();
        }
      }
      if (mult > 0) {
        const g = 1 / (1 + Math.pow(Math.abs(this.omega) / 26, 2));
        this.omega = clamp(this.omega + sg * I * mult * g, -400, 400);
        if (this._p.mode === 'zone') this.omega = clamp(this.omega, -Math.PI * 2 * 4, Math.PI * 2 * 4);
      }
      this._run.used++;
    }
    skip() {
      const r = this._run; if (!r || this._p.mode !== 'endurance' || this._noskip || this._remote) return;
      let w = this.omega, wob = this._wob, turns = 0; const h = 1 / 120;
      for (let i = 0; i < 120 * 600 && w !== 0; i++) {
        const sg = Math.sign(w), rps = Math.abs(w) / (Math.PI * 2);
        w -= (w * (0.07 + wob * 0.22) + sg * 0.18) * h; if (Math.sign(w) !== sg) w = 0;
        turns += Math.abs(w) * h / (Math.PI * 2);
        wob = clamp(wob + (Math.max(0, (rps - 7) / 12) - wob) * h * 0.35, 0, 1);
      }
      r.turns += turns; r.score = r.turns; r.peak = Math.max(r.peak, 0);
      this.angle += turns * Math.PI * 2 * Math.sign(this.omega);
      this.omega = 0; this._wob = 0;
    }
    _period(rps) { return clamp(1.3 - rps * 0.045, 0.6, 1.3); }

    // Physics runs at a fixed 120 Hz so every device (and every remote replica) computes the same spin-down.
    _step(dt) {
      this._t += dt;
      const mode = this._p.mode, m = MODES[mode], run = this._run;
      let w = this.omega; const sgn = Math.sign(w);
      const Z = mode === 'zone';
      const lin = this._brake ? (Z ? 0.9 : 3.5) : (Z ? 0.1 : 0.07 + this._wob * 0.22), cst = this._brake ? (Z ? 1.2 : 10) : 0.18;
      w -= (w * lin + sgn * cst) * dt; if (Math.sign(w) !== sgn) w = 0;
      this.omega = w; this.angle += w * dt;
      const rps = Math.abs(w) / (Math.PI * 2);
      const wT = Z ? 0 : Math.max(0, (rps - 7) / 12);
      this._wob = clamp(this._wob + (wT - this._wob) * Math.min(1, dt * 0.35), 0, 1);

      let zc = zoneAt(0);
      if (run) {
        run.turns += Math.abs(w) * dt / (Math.PI * 2); run.peak = Math.max(run.peak, rps);
        zc = zoneAt(this._t - run.t0);
        if (mode === 'zone') { run.inZone = w !== 0 && Math.abs(rps - zc) < ZONE_HALF; if (run.inZone) run.zone += dt; }
        run.score = mode === 'endurance' ? run.turns : mode === 'zone' ? run.zone : run.peak;
        if (w === 0 || (Z && this._t - run.t0 >= ZONE_LEN)) {
          const score = Math.round(run.score * 10) / 10;
          this._lastScore = score; this._run = null; this._combo = 0;
          this._say('done', m.fmt(score) + ' ' + m.unit);
          if (this._remote) return;
          this._emit('spinrunend', { score });
          if (score > 0) { const detail = { mode, score }; window.__lastSpin = detail; try { window.dispatchEvent(new CustomEvent('spinend', { detail })); } catch (e) {} if (typeof window.__onSpinEnd === 'function') { try { window.__onSpinEnd(detail); } catch (e) {} } }
        }
      }

      this._beat = (this._beat + dt / this._period(rps)) % 1;
    }

    _frame(now) {
      if (this._last === null) this._last = now;
      const dt = Math.min(0.05, (now - this._last) / 1000), real = Math.min(0.25, (now - this._last) / 1000); this._last = now;
      const H = 1 / 120;
      this._acc += real;
      while (this._acc >= H) { this._step(H); this._acc -= H; }
      const mode = this._p.mode, m = MODES[mode], w = this.omega, Z = mode === 'zone';
      const rps = Math.abs(w) / (Math.PI * 2);
      const zc = this._run ? zoneAt(this._t - this._run.t0) : zoneAt(0);
      const live = this._run && this._run.used < m.budget && w !== 0 && !Z;
      const pr = 2.2 - (2.2 - 1.55) * this._beat;
      this._pulse.scale.setScalar(pr);
      const po = this._pulse.material.opacity, tgt = live ? 0.12 + 0.7 * this._beat : 0;
      this._pulse.material.opacity = po + (tgt - po) * Math.min(1, dt * 12);
      const to = this._target.material.opacity, tt = live ? 0.22 + this._flash * 0.78 : 0;
      this._target.material.opacity = to + (tt - to) * Math.min(1, dt * 10);

      if (this._studio && this.omega === 0) this.angle += dt * 0.5;
      this._vo = (this._vo || 0) + ((this._studio ? 1 : 0) - (this._vo || 0)) * Math.min(1, dt * 6);
      {
        const W = this.clientWidth || 1, Hh = this.clientHeight || 1, v = this._vo;
        if (this._studio) {
          const pnl = document.querySelector('[data-studio-panel]');
          if (pnl) {
            const me = this.getBoundingClientRect(), pr = pnl.getBoundingClientRect();
            if (pr.left > me.left + W * 0.35) { const free = Math.max(1, pr.left - me.left); this._sv = { x: (W - free) / 2, y: 0, z: Math.min(1, Math.max(0.5, free / W * 1.1)) }; }
            else { const free = Math.max(1, pr.top - me.top); this._sv = { x: 0, y: (Hh - free) / 2, z: Math.min(1, Math.max(0.45, free / Hh * 1.05)) }; }
          }
        }
        const sv = this._sv || { x: 0, y: 0, z: 1 }, zoom = 1 + (sv.z - 1) * v;
        if (Math.abs(this._cam.zoom - zoom) > 1e-4) { this._cam.zoom = zoom; this._cam.updateProjectionMatrix(); }
        if (v > 0.001) this._cam.setViewOffset(W, Hh, sv.x * v, sv.y * v, W, Hh); else if (this._cam.view && this._cam.view.enabled) this._cam.clearViewOffset();
      }
      this._spin.rotation.y = this.angle;
      const slow = Math.max(0, 1 - rps / 1.3), base = slow * Math.min(1, rps / 0.2) * 0.04;
      const wob = base + this._wob * 0.09, pf = 2.1 + Math.min(rps, 10) * 0.6;
      this._tilt.rotation.x = Math.sin(this._t * pf) * wob; this._tilt.rotation.z = Math.cos(this._t * pf) * wob;

      this._flash *= Math.exp(-dt * 6); this._shake *= Math.exp(-dt * 9);
      this._flashEl.style.opacity = this._flash.toFixed(3);
      if (this._camBase) {
        const k = this._shake * 0.06;
        this._cam.position.set(this._camBase.x + (Math.random() - 0.5) * k, this._camBase.y + (Math.random() - 0.5) * k, this._camBase.z);
      }

      const r = this._run;
      if (mode !== this._hintMode) { this._hintMode = mode; this._hint.innerHTML = Z ? 'swipe with the spin to speed up<br>against it to slow down' : 'flick along the edge<br>swipe again as the ring lands'; }
      this._hint.style.opacity = r || this.omega !== 0 || this._studio || this._noskip ? 0 : 1;
      this._skipEl.style.display = r && mode === 'endurance' && w !== 0 && !this._noskip ? 'block' : 'none';
      this._scoreEl.textContent = r ? m.fmt(r.score) : this._lastScore != null ? m.fmt(this._lastScore) : '0';
      this._unitEl.textContent = Z && r ? 'in zone · ' + Math.max(0, Math.ceil(ZONE_LEN - (this._t - r.t0))) + 's left' : m.unit;
      this._rpm.textContent = rps > 0.05 ? rps.toFixed(1) + ' rev/s' : '';
      this._gauge.style.display = mode === 'zone' ? 'block' : 'none';
      if (mode === 'zone') {
        const MAXR = 7;
        this._band.style.left = ((zc - ZONE_HALF) / MAXR * 100) + '%';
        this._band.style.width = (ZONE_HALF * 2 / MAXR * 100) + '%';
        this._band.style.background = r && r.inZone ? 'rgba(234,163,196,.55)' : 'rgba(234,163,196,.18)';
        this._needle.style.left = (Math.min(rps, MAXR) / MAXR * 100) + '%';
      }
      const used = r ? Math.min(r.used, m.budget) : 0, key = m.budget + ':' + used;
      if (key !== this._swKey) {
        this._swKey = key;
        this._sw.innerHTML = m.budget > 6 ? `<span style="font:500 10px/1 'Geist Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:#eaa3c4">${m.budget - used} / ${m.budget} swipes</span>` : Array.from({ length: m.budget }, (_, i) => `<span style="width:7px;height:7px;border-radius:50%;${i < m.budget - used ? 'background:#eaa3c4' : 'box-shadow:inset 0 0 0 1px rgba(234,163,196,.45)'}"></span>`).join('');
      }
      const ja = this._t - this._judgeT;
      this._judgeEl.style.opacity = clamp(ja < 0.08 ? ja / 0.08 : 1 - (ja - 0.9) / 0.5, 0, 1).toFixed(3);
      this._judgeEl.style.transform = 'scale(' + (1 + Math.max(0, 0.12 - ja * 0.6)).toFixed(3) + ')';

      // Spinner stopped for 15 s of real time: put the sound engine to sleep until the next tap.
      if (!this._remote) {
      if (rps > 0.02 || _asleep || !A.ctx) this._busyT = now;
      else if (now - (this._busyT || now) > 15000) sleepAudio();
      }
      if (A.ctx && !_asleep && !this._remote) {
        const on = this._p.sound && rps > 0.02, t = A.ctx.currentTime, lob = rps * 3;
        const g = on ? Math.min(0.22, rps * 0.04) : 0;
        A.whirr.gain.setTargetAtTime(g, t, 0.05);
        A.bp.frequency.setTargetAtTime(180 + rps * 60, t, 0.05);
        A.lfo.frequency.setTargetAtTime(Math.max(0.1, lob), t, 0.05);
        A.lfoD.gain.setTargetAtTime(Math.min(0.5, 0.15 + rps * 0.05), t, 0.1);
        A.hum.frequency.setTargetAtTime(Math.max(30, lob * 2), t, 0.05);
        A.humG.gain.setTargetAtTime(on && lob > 25 ? Math.min(0.05, (lob - 25) * 0.002) : 0, t, 0.08);
        if (on && lob < 12) {
          const ph = this.angle * (SHAPES[this._p.shape] || SHAPES.tri).n / (Math.PI * 2);
          if (Math.floor(ph) !== Math.floor(this._lobePhase)) click(0.015 + (12 - lob) * 0.002);
          this._lobePhase = ph;
        } else this._lobePhase = this.angle * (SHAPES[this._p.shape] || SHAPES.tri).n / (Math.PI * 2);
        if (on && this._wob > 0.35 && Math.random() < dt * this._wob * 14) click(0.01 + this._wob * 0.025);
      }
      this._renderer.render(this._scene, this._cam);
    }
  }
  customElements.define('fidget-spinner', FidgetSpinner);
})();
