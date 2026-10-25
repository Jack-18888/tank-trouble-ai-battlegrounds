export class Sound {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.lastBounce = 0;
  }
  unlock() {
    if (!this.enabled) return;
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {
      /* Sound is optional. */
    }
  }
  tone(frequency, duration, volume, type = 'sine', endFrequency = frequency, delay = 0) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator(),
      gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(start);
    osc.stop(start + duration);
  }
  play(type, event = {}) {
    if (type === 'fire') this.tone(170, 0.075, event.id === 0 ? 0.045 : 0.018, 'square', 60);
    if (type === 'bounce' && performance.now() - this.lastBounce > 70) {
      this.lastBounce = performance.now();
      this.tone(740, 0.035, 0.013, 'sine', 380);
    }
    if (type === 'destroy') {
      this.tone(100, 0.32, 0.06, 'sawtooth', 22);
      this.tone(42, 0.38, 0.07, 'triangle', 20);
    }
    if (type === 'countdown' && event.count > 0) this.tone(440, 0.09, 0.045);
    if (type === 'go') this.tone(880, 0.2, 0.04, 'triangle', 1000);
    if (type === 'pickup' || type === 'shield') {
      this.tone(560, 0.1, 0.045);
      this.tone(840, 0.17, 0.035, 'sine', 1100, 0.07);
    }
    if (type === 'roundEnd')
      [0, 1, 2].forEach((i) =>
        this.tone([440, 550, 660][i], 0.25, 0.035, 'triangle', [440, 550, 880][i], i * 0.1),
      );
  }
}
