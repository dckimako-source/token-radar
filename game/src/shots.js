// Staged screenshot scenes behind ?shot=start|play|upgrade|end: each builds a real game state
// with the world's own spawn helpers (the same code a live run uses), aims the ship, and lets
// the renderer paint it. The same seed always gives the same frame, and nothing is composited.

import { FIELD } from './config.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE, SCREEN_UPGRADE } from './render.js';
import { UPGRADES } from './upgrades.js';

function stagePlay(world, particles) {
  const player = world.state.player;
  player.x = FIELD.width / 2 - 130;
  player.y = FIELD.height / 2 + 40;
  player.angle = -Math.PI / 2 - 0.4;
  player.hp = 5;
  player.shieldMax = 1;
  player.shield = 1;
  player.barrels = 2;
  world.state.score = 1840;
  world.state.combo = 4;
  world.state.comboTimer = 2;
  world.state.bestCombo = 6;
  world.state.wave = 3;
  world.state.level = 4;
  world.state.xp = 14;
  world.state.xpNeeded = 17;
  world.state.kills = 63;
  world.state.elapsed = 40;
  world.state.taken = { rapid: 1, twin: 1, power: 1 };
  world.spawnEnemy('drifter', 300, 160);
  world.spawnEnemy('drifter', 980, 520);
  world.spawnEnemy('splinter', 760, 210);
  world.spawnEnemy('watcher', 1080, 150);
  world.spawnEnemy('shard', 520, 300);
  const brute = world.spawnEnemy('brute', 900, 480);
  brute.hp = Math.ceil(brute.maxHp * 0.55);
  world.state.bullets.push(
    { x: player.x + 40, y: player.y - 60, vx: 0, vy: -640, damage: 2, pierce: 0, crit: true },
    { x: player.x - 30, y: player.y - 80, vx: 0, vy: -640, damage: 1, pierce: 0, crit: false },
  );
  world.state.bolts.push({ x: 1040, y: 260, vx: -120, vy: 140 });
  for (let index = 0; index < 7; index += 1) {
    world.state.gems.push({ x: 420 + index * 70, y: 430 + Math.sin(index) * 60, vx: 0, vy: 0, life: 12, twinkle: index });
  }
  particles.burst(980, 520, '#ff5a5f', 20, 240, 0.5, 4);
  particles.ring(980, 520, '#ff5a5f', 220, 0.5, 5);
  particles.flash(980, 520, 44, '#ff5a5f');
}

function stageUpgrade(world) {
  world.state.level = 6;
  world.state.score = 3260;
  world.state.wave = 6;
  world.state.waveBanner = 0;
  world.state.pendingLevels = 1;
  world.state.taken = { rapid: 2, twin: 1, magnet: 1 };
  world.state.player.pickupRadius = 155;
  world.state.offers = [UPGRADES[1], UPGRADES[5], UPGRADES[7]];
}

function stageEnd(world, particles) {
  const player = world.state.player;
  player.x = FIELD.width / 2;
  player.y = FIELD.height / 2;
  player.hp = 0;
  world.state.score = 4870;
  world.state.wave = 5;
  world.state.kills = 97;
  world.state.bestCombo = 8;
  world.state.level = 7;
  world.state.elapsed = 88;
  world.state.over = true;
  world.state.shake = 0;
  world.state.waveBanner = 0;
  world.spawnEnemy('drifter', 220, 180);
  world.spawnEnemy('splinter', 1040, 220);
  particles.burst(player.x, player.y, '#53d8ff', 60, 380, 0.9, 5);
  particles.ring(player.x, player.y, '#53d8ff', 520, 0.8, 8);
  particles.flash(player.x, player.y, 120, '#53d8ff');
  particles.burst(500, 600, '#ffa94d', 22, 260, 0.6, 4);
}

/**
 * Set `world` up for the named scene and return the screen to draw. The start scene shows the
 * title panel over a live backdrop with a few enemies adrift.
 */
export function stageShot(name, world, particles) {
  world.reset();
  if (name === 'play') {
    stagePlay(world, particles);
    return SCREEN_PLAY;
  }
  if (name === 'upgrade') {
    stageUpgrade(world);
    return SCREEN_UPGRADE;
  }
  if (name === 'end') {
    stageEnd(world, particles);
    return SCREEN_OVER;
  }
  world.spawnEnemy('drifter', 180, 520);
  world.spawnEnemy('splinter', 1080, 200);
  world.spawnEnemy('watcher', 300, 150);
  world.state.running = false;
  return SCREEN_TITLE;
}
