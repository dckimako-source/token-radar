// Every tuning number and colour in one place. The arena is a fixed 1280x720 logical area;
// the renderer scales it to the window, so no rule below depends on the screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const PLAYER = {
  radius: 14,
  speed: 250,
  hp: 6,
  fireInterval: 0.24,
  bulletSpeed: 640,
  bulletDamage: 1,
  invulnerable: 0.8,
  pickupRadius: 90,
};

export const COMBO = { window: 2.5, max: 8 };

/** Seconds of play per wave, and the last wave whose growth the spawner honours. */
export const WAVE = { seconds: 18, max: 40 };

export const SPAWN = {
  interval: 1.15,
  intervalScale: 0.93,
  minInterval: 0.28,
  edgeMargin: 40,
};

export const GEM = { radius: 7, speed: 180, lifetime: 14 };

/** Enemy catalogue: the shapes the player meets, each with its own behaviour in world.js. */
export const ENEMIES = {
  drifter: { hp: 2, speed: 78, radius: 16, damage: 1, xp: 1, score: 15, color: '#ff5a5f' },
  shard:   { hp: 1, speed: 130, radius: 9, damage: 1, xp: 1, score: 10, color: '#ff8fa3' },
  splinter:{ hp: 3, speed: 58, radius: 14, damage: 1, xp: 2, score: 30, color: '#c46bff' },
  watcher: { hp: 4, speed: 62, radius: 15, damage: 1, xp: 3, score: 45, color: '#ffa94d', keepDistance: 280, fireInterval: 2.2, boltSpeed: 230 },
  brute:   { hp: 34, speed: 38, radius: 36, damage: 2, xp: 8, score: 300, color: '#845ef7', spawnInterval: 3.2 },
};

/** The wave a brute arrives on, and every 4 waves after it. */
export const BRUTE_WAVE = 4;

export const XP = { base: 5, perLevel: 4 };

export const PALETTE = {
  backdrop: '#0a0c14',
  panel: '#161b28',
  panelEdge: '#2b3550',
  player: '#53d8ff',
  bullet: '#a9f0ff',
  bolt: '#ffb86b',
  gem: '#7dff9e',
  text: '#eef2f8',
  muted: '#8b93a3',
  accent: '#ffd166',
  danger: '#ff5a5f',
  shield: '#6f8cff',
  hpLow: '#ff4d5e',
  hp: '#43e08a',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'astral-warden.best';
