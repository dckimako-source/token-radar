// Procedural sound, synthesized with the Web Audio API: no audio files, no network. Every effect
// is a short oscillator or noise envelope on a shared master gain. The context is created on the
// player's first input (browsers require a gesture) and the engine stays silent until then.

const SHOT_NOTE = { from: 880, to: 320, duration: 0.08, type: 'square', volume: 0.12 };

export function createAudio() {
  let context = null;
  let master = null;
  let muted = false;
  let noiseBuffer = null;

  function ensure() {
    if (context) return true;
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return false;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.8;
    master.connect(context.destination);
    const length = Math.floor(context.sampleRate * 0.5);
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    return true;
  }

  function tone(type, from, to, duration, volume, delay = 0) {
    const now = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  function noise(duration, volume, frequency, delay = 0) {
    const now = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(frequency, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  return {
    /** Call on the first user gesture; harmless to call again. */
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume();
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.8;
      return muted;
    },
    isMuted() {
      return muted;
    },
    shoot() {
      if (!ensure() || muted) return;
      tone(SHOT_NOTE.type, SHOT_NOTE.from, SHOT_NOTE.to, SHOT_NOTE.duration, SHOT_NOTE.volume);
    },
    enemyHit() {
      if (!ensure() || muted) return;
      noise(0.07, 0.1, 2400);
    },
    explode(big) {
      if (!ensure() || muted) return;
      noise(big ? 0.55 : 0.22, big ? 0.5 : 0.22, big ? 900 : 1600);
      tone('sine', big ? 130 : 200, 40, big ? 0.5 : 0.2, big ? 0.4 : 0.18);
    },
    pickup() {
      if (!ensure() || muted) return;
      tone('sine', 620, 1100, 0.09, 0.14);
    },
    hurt() {
      if (!ensure() || muted) return;
      tone('sawtooth', 220, 60, 0.25, 0.3);
      noise(0.2, 0.2, 800);
    },
    levelUp() {
      if (!ensure() || muted) return;
      tone('triangle', 440, 440, 0.12, 0.16, 0);
      tone('triangle', 554, 554, 0.12, 0.16, 0.1);
      tone('triangle', 660, 660, 0.12, 0.16, 0.2);
      tone('triangle', 880, 880, 0.2, 0.18, 0.3);
    },
    upgrade() {
      if (!ensure() || muted) return;
      tone('triangle', 520, 780, 0.16, 0.18);
    },
    over() {
      if (!ensure() || muted) return;
      tone('sawtooth', 320, 40, 1.1, 0.3);
      noise(0.9, 0.25, 500);
    },
  };
}
