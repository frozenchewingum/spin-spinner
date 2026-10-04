// spin — live VS mode.
//
// Transport: Supabase Realtime (Phoenix channels over WebSocket, protocol vsn 1.0.0), using
//   Broadcast  — low-latency messages between the two players (nothing is stored), and
//   Presence   — who is in the room.
// Each match is a room named after a random code in the link (?vs=CODE).
//
// Sync model: players send their spinner's state (speed, angle, wobble, run counters) right after each
// swipe, plus a check-in every second. Between messages the opponent's phone runs the same fixed-step
// physics, so only a handful of tiny messages are needed per match.
(function () {
  'use strict';

  // ───────────────────────── minimal Supabase Realtime client ─────────────────────────
  class RealtimeSocket {
    constructor(url, key) {
      this.url = url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(key) + '&vsn=1.0.0';
      this.ref = 0; this.channels = new Set(); this.ws = null; this.hb = null; this.retry = 0; this.closed = false;
      this.listeners = { open: [], close: [] };
    }
    makeRef() { return String(++this.ref); }
    connect() {
      if (this.ws && this.ws.readyState <= 1) return;
      this.closed = false;
      const ws = this.ws = new WebSocket(this.url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.retry = 0;
        clearInterval(this.hb);
        this.hb = setInterval(() => this.push({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this.makeRef() }), 25000);
        this.channels.forEach(c => c._rejoin());
        this.listeners.open.forEach(f => f());
      };
      ws.onmessage = e => {
        let msg;
        try { msg = typeof e.data === 'string' ? JSON.parse(e.data) : decodeBinary(e.data); } catch (err) { return; }
        this.channels.forEach(c => { if (c.topic === msg.topic) c._handle(msg); });
      };
      ws.onclose = () => {
        clearInterval(this.hb);
        this.channels.forEach(c => { c.joined = false; });
        this.listeners.close.forEach(f => f());
        if (this.closed) return;
        const wait = [1000, 2000, 5000, 10000][Math.min(this.retry++, 3)];
        setTimeout(() => this.connect(), wait);
      };
      ws.onerror = () => {};
    }
    push(msg) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(msg)); return true; } return false; }
    disconnect() { this.closed = true; clearInterval(this.hb); if (this.ws) this.ws.close(1000); this.ws = null; }
    on(ev, f) { this.listeners[ev].push(f); }
  }
  // Binary broadcast frames (same layout realtime-js decodes): [kind, topicLen, eventLen, topic, event, json]
  function decodeBinary(buf) {
    const v = new DataView(buf), d = new TextDecoder(), tl = v.getUint8(1), el = v.getUint8(2);
    let o = 3; const topic = d.decode(buf.slice(o, o + tl)); o += tl;
    const event = d.decode(buf.slice(o, o + el)); o += el;
    return { ref: null, topic, event, payload: JSON.parse(d.decode(buf.slice(o))) };
  }

  class RealtimeRoom {
    constructor(socket, name, presenceKey) {
      this.socket = socket; this.topic = 'realtime:' + name; this.key = presenceKey;
      this.handlers = {}; this.presence = {}; this.presenceCb = () => {}; this.statusCb = () => {};
      this.joined = false; this.joinRef = null; this.meta = null; this.wantJoin = false;
    }
    on(event, cb) { (this.handlers[event] = this.handlers[event] || []).push(cb); return this; }
    onPresence(cb) { this.presenceCb = cb; return this; }
    onStatus(cb) { this.statusCb = cb; return this; }
    join(meta) {
      this.meta = meta; this.wantJoin = true;
      this.socket.channels.add(this);
      if (this.socket.ws && this.socket.ws.readyState === 1) this._rejoin(); else this.socket.connect();
    }
    _rejoin() {
      if (!this.wantJoin) return;
      this.joinRef = this.socket.makeRef();
      this.presence = {};
      this.socket.push({
        topic: this.topic, event: 'phx_join', ref: this.joinRef, join_ref: this.joinRef,
        payload: { config: { broadcast: { ack: false, self: false }, presence: { key: this.key, enabled: true }, postgres_changes: [], private: false } },
      });
    }
    _handle(msg) {
      if (msg.event === 'phx_reply' && msg.ref === this.joinRef) {
        if (msg.payload && msg.payload.status === 'ok') {
          this.joined = true; this.statusCb('joined');
          if (this.meta) this.track(this.meta);
        } else this.statusCb('error', msg.payload && msg.payload.response);
        return;
      }
      if (msg.event === 'phx_error' || msg.event === 'phx_close') { this.joined = false; this.statusCb('closed'); return; }
      if (msg.event === 'broadcast' && msg.payload) {
        (this.handlers[msg.payload.event] || []).forEach(cb => { try { cb(msg.payload.payload || {}); } catch (e) { console.error(e); } });
        return;
      }
      if (msg.event === 'presence_state') { this.presence = clonePresence(msg.payload); this.presenceCb(this.presence); return; }
      if (msg.event === 'presence_diff') {
        const p = msg.payload || {};
        Object.keys(p.leaves || {}).forEach(k => {
          const gone = new Set((p.leaves[k].metas || []).map(m => m.phx_ref));
          if (this.presence[k]) { this.presence[k] = this.presence[k].filter(m => !gone.has(m.phx_ref)); if (!this.presence[k].length) delete this.presence[k]; }
        });
        Object.keys(p.joins || {}).forEach(k => {
          const add = p.joins[k].metas || [], have = new Set((this.presence[k] || []).map(m => m.phx_ref));
          this.presence[k] = (this.presence[k] || []).concat(add.filter(m => !have.has(m.phx_ref)));
        });
        this.presenceCb(this.presence);
      }
    }
    track(meta) {
      this.meta = meta;
      if (!this.joined) return;
      this.socket.push({ topic: this.topic, event: 'presence', ref: this.socket.makeRef(), join_ref: this.joinRef, payload: { type: 'presence', event: 'track', payload: meta } });
    }
    send(event, payload) {
      if (!this.joined) return false;
      return this.socket.push({ topic: this.topic, event: 'broadcast', ref: this.socket.makeRef(), join_ref: this.joinRef, payload: { type: 'broadcast', event, payload } });
    }
    leave() {
      this.wantJoin = false;
      if (this.joined) this.socket.push({ topic: this.topic, event: 'phx_leave', ref: this.socket.makeRef(), join_ref: this.joinRef, payload: {} });
      this.joined = false; this.socket.channels.delete(this);
      if (!this.socket.channels.size) this.socket.disconnect();
    }
  }
  function clonePresence(state) {
    const out = {};
    Object.keys(state || {}).forEach(k => { out[k] = (state[k].metas || []).slice(); });
    return out;
  }

  // Tests can swap in another transport with the same room interface: window.__SPIN_TRANSPORT = { room(name, key) }.
  let socket = null;
  function openRoom(url, key, name, presenceKey) {
    if (window.__SPIN_TRANSPORT) return window.__SPIN_TRANSPORT.room(name, presenceKey);
    if (!socket) socket = new RealtimeSocket(url, key);
    return new RealtimeRoom(socket, name, presenceKey);
  }

  // ───────────────────────── match logic ─────────────────────────
  const rid = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, x => 'abcdefghjkmnpqrstuvwxyz23456789'[x % 31]).join(''); };
  const MODES = ['endurance', 'speed'];

  /*
   * Phases: connecting → waiting (host alone) → lobby → countdown → playing → finished (me done, opponent still going) → result
   *         plus: full, gone (opponent left), error.
   * Messages (broadcast events):
   *   ready {ready, round}    ping {t0} / pong {t0, t1}    start {at, round, mode}
   *   swipe {state, word, sub, round}   snap {state, round}   end {score, round}   pause {paused}   setmode {mode}
   */
  class VSMatch {
    constructor(opts) {
      this.o = opts; // { url, key, code?, mode, name, skin, onChange, local(), remote() }
      this.id = rid(12);
      this.code = opts.code || rid(10);
      this.role = opts.code ? 'guest' : 'host';
      this.mode = MODES.includes(opts.mode) ? opts.mode : 'endurance';
      this.round = 0; this.offset = 0; this.bestRtt = Infinity;
      this.s = {
        phase: 'connecting', code: this.code, role: this.role, mode: this.mode,
        me: { name: opts.name, ready: false, score: null, done: false },
        opp: null, startAt: 0, winner: null, error: '',
      };
      this.timers = [];
      this.room = openRoom(opts.url, opts.key, 'spin-vs-' + this.code, this.id);
      this.room.onStatus((st, info) => {
        if (st === 'joined') { if (this.s.phase === 'connecting' || this.s.phase === 'error') this._set({ phase: this.s.opp && this.s.opp.present ? 'lobby' : this.role === 'host' ? 'waiting' : 'joining', error: '' }); }
        else if (st === 'error') this._set({ phase: 'error', error: (info && (info.reason || info.message)) || 'Could not connect' });
      });
      this.room.onPresence(p => this._presence(p));
      this.room.on('ready', m => this._oppPatch({ ready: !!m.ready }, () => this._maybeStart()));
      this.room.on('ping', m => this.room.send('pong', { t0: m.t0, t1: Date.now(), to: m.from }));
      this.room.on('pong', m => this._pong(m));
      this.room.on('setmode', m => { if (this.role === 'guest' && MODES.includes(m.mode)) { this.mode = m.mode; this._set({ mode: m.mode }); } });
      this.room.on('start', m => this._start(m));
      this.room.on('swipe', m => this._remoteState(m, true));
      this.room.on('snap', m => this._remoteState(m, false));
      this.room.on('end', m => this._oppEnd(m));
      this.room.on('pause', m => this._oppPatch({ paused: !!m.paused }));
      this.room.on('bye', () => this._oppLeft());
      this.room.join(this._meta());
      this._onVis = () => { if (this.s.phase === 'playing' || this.s.phase === 'finished') this.room.send('pause', { paused: document.hidden }); };
      document.addEventListener('visibilitychange', this._onVis);
      this._onUnload = () => { try { this.room.send('bye', {}); } catch (e) {} };
      window.addEventListener('pagehide', this._onUnload);
      // If nothing connects in 10 s, say so (but keep retrying underneath).
      this._later(() => { if (this.s.phase === 'connecting') this._set({ phase: 'error', error: 'Could not reach the VS server' }); }, 10000);
    }
    get link() { return location.origin + location.pathname + '?vs=' + this.code; }
    _meta() { return { id: this.id, role: this.role, name: this.s.me.name, skin: this.o.skin || '', mode: this.mode, at: this.joinedAt || (this.joinedAt = Date.now()) }; }
    _set(patch) { Object.assign(this.s, patch); this.o.onChange(this.s); }
    _oppPatch(patch, then) { if (!this.s.opp) return; this.s.opp = Object.assign({}, this.s.opp, patch); this.o.onChange(this.s); if (then) then(); }
    _later(f, ms) { const t = setTimeout(f, ms); this.timers.push(t); return t; }

    _presence(p) {
      // Flatten to one entry per player id, oldest first.
      const all = [];
      Object.keys(p).forEach(k => (p[k] || []).forEach(m => { if (m && m.id) all.push(m); }));
      const byId = {}; all.forEach(m => { if (!byId[m.id] || byId[m.id].at > m.at) byId[m.id] = m; });
      const players = Object.values(byId).sort((a, b) => a.at - b.at);
      const host = players.find(m => m.role === 'host');
      const guests = players.filter(m => m.role === 'guest');
      // Room full: two players are already here and I'm not one of them.
      const slots = [host, guests[0]].filter(Boolean).map(m => m.id);
      if (this.role === 'guest' && guests.length > 1 && !slots.includes(this.id)) { this._set({ phase: 'full' }); this.room.leave(); return; }
      const oppMeta = this.role === 'host' ? guests[0] : host;
      if (this.role === 'guest' && host && MODES.includes(host.mode) && this.s.phase !== 'playing') { this.mode = host.mode; this.s.mode = host.mode; }
      if (oppMeta) {
        const first = !this.s.opp || this.s.opp.id !== oppMeta.id;
        this.s.opp = Object.assign({ ready: false, score: null, done: false, paused: false, word: '', present: true }, first ? {} : this.s.opp,
          { id: oppMeta.id, name: oppMeta.name || 'Player', skin: oppMeta.skin || '', present: true });
        if (first) { this._syncClock(); if (['connecting', 'waiting', 'joining', 'gone', 'error'].includes(this.s.phase)) this.s.phase = 'lobby'; this.s.me.ready = false; this.s.opp.ready = false; }
        clearTimeout(this._goneT);
        this.o.onChange(this.s);
      } else if (this.s.opp && this.s.opp.present) {
        // Opponent dropped. Give them 12 s to come back (flaky mobile networks) before calling it.
        this.s.opp = Object.assign({}, this.s.opp, { present: false });
        this.o.onChange(this.s);
        clearTimeout(this._goneT);
        this._goneT = this._later(() => { if (this.s.opp && !this.s.opp.present) this._oppLeft(); }, 12000);
      }
    }
    _oppLeft() {
      const mid = this.s.phase === 'countdown' || this.s.phase === 'playing' || this.s.phase === 'finished';
      if (mid) this._finish(true);
      else this._set({ phase: this.role === 'host' ? 'waiting' : 'gone', opp: null });
    }

    // Clock sync: 5 pings, keep the one with the shortest round trip. offset = theirClock − myClock.
    _syncClock() {
      this.bestRtt = Infinity;
      for (let i = 0; i < 5; i++) this._later(() => this.room.send('ping', { t0: Date.now(), from: this.id }), 150 + i * 200);
    }
    _pong(m) {
      if (m.to !== this.id) return;
      const t2 = Date.now(), rtt = t2 - m.t0;
      if (rtt < this.bestRtt) { this.bestRtt = rtt; this.offset = m.t1 - (m.t0 + rtt / 2); }
    }

    setMode(mode) {
      if (this.role !== 'host' || !MODES.includes(mode) || ['countdown', 'playing', 'finished'].includes(this.s.phase)) return;
      this.mode = mode; this._set({ mode }); this.room.track(this._meta()); this.room.send('setmode', { mode });
    }
    setReady(ready) {
      if (ready && this.role === 'guest') this._syncClock();
      this.s.me = Object.assign({}, this.s.me, { ready });
      this.o.onChange(this.s);
      this.room.send('ready', { ready, round: this.round });
      this._maybeStart();
    }
    _maybeStart() {
      if (this.role !== 'host' || !this.s.opp || !this.s.opp.present) return;
      if (!(this.s.me.ready && this.s.opp.ready)) return;
      if (!['lobby', 'result'].includes(this.s.phase)) return;
      const msg = { at: Date.now() + 3600, in: 3600, round: this.round + 1, mode: this.mode };
      this.room.send('start', msg);
      this._start(msg, true);
    }
    _start(m, own) {
      if (m.round <= this.round) return;
      this.round = m.round; this.mode = m.mode || this.mode;
      // Guest: start 'in' ms after the message was sent ≈ received now − half the measured round trip.
      // (Doesn't depend on the two phones' clocks agreeing.)
      const oneWay = isFinite(this.bestRtt) ? Math.min(this.bestRtt / 2, 400) : 80;
      const startAt = own || this.role === 'host' ? m.at : Date.now() + (m.in || 3600) - oneWay;
      const reset = { ready: false, score: null, done: false, word: '' };
      this.s.me = Object.assign({}, this.s.me, reset);
      if (this.s.opp) this.s.opp = Object.assign({}, this.s.opp, reset, { paused: false });
      this._set({ phase: 'countdown', mode: this.mode, startAt, winner: null });
      const L = this.o.local(), R = this.o.remote();
      if (L) L.resetRun(); if (R) R.resetRun();
      this._later(() => {
        if (this.s.phase !== 'countdown' || this.round !== m.round) return;
        this._set({ phase: 'playing' });
        this._snapT = setInterval(() => this._snap(), 1000);
        // Nobody swipes for 20 s → their score is 0.
        this._idleT = this._later(() => { const l = this.o.local(); if (this.s.phase === 'playing' && !this.s.me.done && l && !l._run && !l.omega) this.localEnd(0); }, 20000);
      }, Math.max(0, startAt - Date.now()));
    }
    _snap() {
      const L = this.o.local();
      if (!L || this.s.me.done) return;
      if (L._run || L.omega) this.room.send('snap', { state: L.snapshot(), round: this.round });
    }
    // Called by the page when the local spinner reports a swipe.
    localSwipe(d) {
      if (this.s.phase !== 'playing' || this.s.me.done) return;
      clearTimeout(this._idleT);
      this.room.send('swipe', { state: d.state, word: d.word, sub: d.sub, round: this.round });
    }
    localEnd(score) {
      if (this.s.phase !== 'playing' || this.s.me.done) return;
      this.s.me = Object.assign({}, this.s.me, { score, done: true });
      this.room.send('end', { score, round: this.round });
      if (this.s.opp && this.s.opp.done) this._finish(); else this._set({ phase: 'finished' });
    }
    _remoteState(m, isSwipe) {
      if (m.round !== this.round || !this.s.opp || this.s.opp.done) return;
      if (!['playing', 'finished', 'countdown'].includes(this.s.phase)) return;
      const R = this.o.remote();
      if (R && m.state) R.applyRemote(m.state, isSwipe ? m.word : null, m.sub);
      if (isSwipe) this._oppPatch({ word: m.word || '' });
    }
    _oppEnd(m) {
      if (m.round !== this.round || !this.s.opp) return;
      this.s.opp = Object.assign({}, this.s.opp, { score: Number(m.score) || 0, done: true });
      const R = this.o.remote(); if (R) { R.omega = 0; R._run = null; R._lastScore = Number(m.score) || 0; }
      if (this.s.me.done) this._finish(); else this.o.onChange(this.s);
    }
    _finish(forfeit) {
      clearInterval(this._snapT); clearTimeout(this._idleT);
      const me = this.s.me.score, op = this.s.opp ? this.s.opp.score : null;
      let winner;
      if (forfeit) winner = 'me';
      else if (me == null || op == null) winner = null;
      else winner = me > op ? 'me' : op > me ? 'opp' : 'draw';
      this._set({ phase: forfeit ? 'gone' : 'result', winner, forfeit: !!forfeit });
      if (forfeit) this.s.opp = null;
    }
    leave() {
      try { this.room.send('bye', {}); } catch (e) {}
      this.timers.forEach(clearTimeout); clearInterval(this._snapT);
      document.removeEventListener('visibilitychange', this._onVis);
      window.removeEventListener('pagehide', this._onUnload);
      this.room.leave();
    }
  }

  window.SpinVS = { VSMatch, codeOk: c => /^[a-z2-9]{6,16}$/.test(c || '') };
})();
