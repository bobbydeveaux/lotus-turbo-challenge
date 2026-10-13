'use strict';
// ── Keyboard + gamepad input, mapped per player ──────────────────────────────
const Input = {
  keys: {},
  hit: {},
  padPrev: [{}, {}],
  padHit: [{}, {}],

  init() {
    const block = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);
    window.addEventListener('keydown', (e) => {
      if (block.has(e.code)) e.preventDefault();
      if (!this.keys[e.code]) this.hit[e.code] = true;
      this.keys[e.code] = true;
      Sound.resume();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
  },

  pressed(...codes) {
    for (const c of codes) if (this.hit[c]) return true;
    return false;
  },

  down(...codes) {
    for (const c of codes) if (this.keys[c]) return true;
    return false;
  },

  pollPads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pads = [];
    for (let i = 0; i < 2; i++) {
      const p = pads && pads[i];
      this.pads[i] = p && p.connected ? p : null;
      this.padHit[i] = {};
      if (!p) continue;
      p.buttons.forEach((b, j) => {
        const v = b.pressed || b.value > 0.5;
        if (v && !this.padPrev[i][j]) { this.padHit[i][j] = true; Sound.resume(); }
        this.padPrev[i][j] = v;
      });
    }
  },

  padBtn(i, j) {
    const p = this.pads && this.pads[i];
    if (!p || !p.buttons[j]) return 0;
    return p.buttons[j].value || (p.buttons[j].pressed ? 1 : 0);
  },

  // menu navigation (any device)
  menu() {
    const ph = (j) => this.padHit[0][j] || this.padHit[1][j];
    const ax = this.pads && this.pads[0] ? this.pads[0].axes : [0, 0];
    if (!this.axisLatch) this.axisLatch = 0;
    let ay = 0;
    if (ax && Math.abs(ax[1]) > 0.6) { if (!this.axisLatch) ay = Math.sign(ax[1]); this.axisLatch = 1; } else this.axisLatch = 0;
    return {
      up: this.pressed('ArrowUp', 'KeyW') || ph(12) || ay < 0,
      down: this.pressed('ArrowDown', 'KeyS') || ph(13) || ay > 0,
      left: this.pressed('ArrowLeft', 'KeyA') || ph(14),
      right: this.pressed('ArrowRight', 'KeyD') || ph(15),
      ok: this.pressed('Enter', 'Space', 'NumpadEnter') || ph(0) || ph(9),
      back: this.pressed('Escape', 'Backspace') || ph(1) || ph(8),
    };
  },

  // driving controls. twoP: P1 = WASD side, P2 = arrows side
  player(i, twoP) {
    const K = (...c) => (this.down(...c) ? 1 : 0);
    const H = (...c) => this.pressed(...c);
    let steer = 0, accel = 0, brake = 0, turbo = false, up = false, dn = false;
    if (!twoP) {
      steer = K('ArrowRight', 'KeyD') - K('ArrowLeft', 'KeyA');
      accel = K('ArrowUp', 'KeyW');
      brake = K('ArrowDown', 'KeyS');
      turbo = H('Space', 'ShiftLeft', 'ShiftRight');
      up = H('KeyX', 'KeyE');
      dn = H('KeyZ', 'KeyQ');
    } else if (i === 0) {
      steer = K('KeyD') - K('KeyA');
      accel = K('KeyW');
      brake = K('KeyS');
      turbo = H('Space', 'ShiftLeft');
      up = H('KeyE');
      dn = H('KeyQ');
    } else {
      steer = K('ArrowRight') - K('ArrowLeft');
      accel = K('ArrowUp');
      brake = K('ArrowDown');
      turbo = H('Enter', 'ShiftRight', 'NumpadEnter');
      up = H('Slash', 'Numpad3');
      dn = H('Period', 'Numpad2');
    }
    const p = this.pads && this.pads[i];
    if (p) {
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steer = U.clamp(ax * 1.15, -1, 1);
      if (this.padBtn(i, 14)) steer = -1;
      if (this.padBtn(i, 15)) steer = 1;
      accel = Math.max(accel, this.padBtn(i, 7), this.padBtn(i, 0));
      brake = Math.max(brake, this.padBtn(i, 6), this.padBtn(i, 1) ? 1 : 0);
      turbo = turbo || !!this.padHit[i][2] || !!this.padHit[i][3];
      up = up || !!this.padHit[i][5];
      dn = dn || !!this.padHit[i][4];
    }
    return { steer, accel, brake, turbo, up, dn };
  },

  anyHit() {
    if (Object.keys(this.hit).length) return true;
    return this.padHit.some((h) => Object.keys(h).length);
  },

  pausePressed() {
    return this.pressed('Escape', 'KeyP') || this.padHit[0][9] || this.padHit[1][9];
  },

  endFrame() {
    this.hit = {};
  },
};
