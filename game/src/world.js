// The game's rules and state, with no drawing and no browser in it: the warden's ship, the enemy
// horde, bullets, bolts and dropped cores, spawning, collisions, XP, level-ups, the combo
// multiplier and the score. step() advances one fixed step and queues named events for the loop
// (which plays the sounds), so the world knows nothing about screens or audio.

import { COMBO, ENEMIES, FIELD, GEM, PLAYER, SPAWN, WAVE, XP, BRUTE_WAVE } from './config.js';
import { createStats, rollOffers } from './upgrades.js';

export const EVENT_OVER = 1;

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clampToField(entity) {
  entity.x = Math.min(FIELD.width - entity.radius, Math.max(entity.radius, entity.x));
  entity.y = Math.min(FIELD.height - entity.radius, Math.max(entity.radius, entity.y));
}

/** A point just outside one of the four edges, for things arriving from deep space. */
function edgePoint(random, margin) {
  const side = Math.floor(random() * 4);
  if (side === 0) return { x: random() * FIELD.width, y: -margin };
  if (side === 1) return { x: random() * FIELD.width, y: FIELD.height + margin };
  if (side === 2) return { x: -margin, y: random() * FIELD.height };
  return { x: FIELD.width + margin, y: random() * FIELD.height };
}

export function createWorld(random, particles) {
  const state = {
    player: null,
    enemies: [],
    bullets: [],
    bolts: [],
    gems: [],
    score: 0,
    kills: 0,
    bestCombo: 1,
    combo: 0,
    comboTimer: 0,
    elapsed: 0,
    wave: 1,
    waveBanner: 0,
    level: 1,
    xp: 0,
    xpNeeded: XP.base,
    pendingLevels: 0,
    offers: null,
    taken: {},
    shake: 0,
    events: [],
    over: false,
    running: false,
  };

  function emit(name, detail) {
    state.events.push(detail === undefined ? name : `${name}:${detail}`);
  }

  function reset() {
    const player = Object.assign({ x: FIELD.width / 2, y: FIELD.height / 2, angle: -Math.PI / 2, fireTimer: 0, invulnerable: 0, shieldTimer: 0, hitFlash: 0 }, createStats());
    state.player = player;
    state.enemies.length = 0;
    state.bullets.length = 0;
    state.bolts.length = 0;
    state.gems.length = 0;
    state.score = 0;
    state.kills = 0;
    state.combo = 0;
    state.comboTimer = 0;
    state.bestCombo = 1;
    state.elapsed = 0;
    state.wave = 1;
    state.waveBanner = 2.2;
    state.level = 1;
    state.xp = 0;
    state.xpNeeded = XP.base;
    state.pendingLevels = 0;
    state.offers = null;
    state.taken = {};
    state.shake = 0;
    state.events.length = 0;
    state.over = false;
    state.running = true;
    particles.clear();
  }

  function spawnEnemy(kind, x, y) {
    const base = ENEMIES[kind];
    const hpScale = 1 + 0.12 * (state.wave - 1);
    const speedScale = Math.min(1.6, 1 + 0.03 * (state.wave - 1));
    state.enemies.push({
      kind,
      x,
      y,
      hp: Math.ceil(base.hp * hpScale),
      maxHp: Math.ceil(base.hp * hpScale),
      radius: base.radius,
      speed: base.speed * speedScale,
      damage: base.damage,
      xp: base.xp,
      score: base.score,
      color: base.color,
      hitFlash: 0,
      touchCooldown: 0,
      fireTimer: base.fireInterval ? base.fireInterval * (0.5 + random() * 0.5) : 0,
      spawnTimer: base.spawnInterval ?? 0,
      wobble: random() * Math.PI * 2,
      wobbleRate: 1.5 + random() * 2.5,
    });
    return state.enemies[state.enemies.length - 1];
  }

  function spawnWaveEnemy() {
    const point = edgePoint(random, SPAWN.edgeMargin);
    const roll = random();
    let kind = 'drifter';
    if (state.wave >= 2 && roll < 0.22) kind = 'splinter';
    else if (state.wave >= 3 && roll < 0.42) kind = 'watcher';
    spawnEnemy(kind, point.x, point.y);
  }

  function dropGems(enemy) {
    const count = enemy.xp;
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      state.gems.push({
        x: enemy.x,
        y: enemy.y,
        vx: Math.cos(angle) * 90,
        vy: Math.sin(angle) * 90,
        life: GEM.lifetime,
        twinkle: random() * Math.PI * 2,
      });
    }
  }

  function fireBullet() {
    const player = state.player;
    const barrels = player.barrels;
    for (let index = 0; index < barrels; index += 1) {
      const offset = barrels === 1 ? 0 : (index - (barrels - 1) / 2) * 0.14;
      const angle = player.angle + offset;
      const crit = random() < player.critChance;
      state.bullets.push({
        x: player.x + Math.cos(angle) * 18,
        y: player.y + Math.sin(angle) * 18,
        vx: Math.cos(angle) * player.bulletSpeed,
        vy: Math.sin(angle) * player.bulletSpeed,
        damage: crit ? player.bulletDamage * 2 : player.bulletDamage,
        pierce: player.pierce,
        crit,
      });
    }
    particles.flash(player.x + Math.cos(player.angle) * 20, player.y + Math.sin(player.angle) * 20, 16, '#a9f0ff');
    emit('shoot');
  }

  function damageEnemy(enemy, damage, bullet) {
    enemy.hp -= damage;
    enemy.hitFlash = 0.1;
    particles.burst(bullet.x, bullet.y, enemy.color, 4, 160, 0.25, 3);
    if (enemy.hp <= 0) killEnemy(enemy);
    else emit('hit');
  }

  function killEnemy(enemy) {
    const index = state.enemies.indexOf(enemy);
    if (index !== -1) state.enemies.splice(index, 1);
    state.kills += 1;
    state.comboTimer = COMBO.window;
    state.combo = Math.min(COMBO.max, state.combo + 1);
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    state.score += enemy.score * Math.max(1, state.combo);
    dropGems(enemy);
    const big = enemy.kind === 'brute';
    particles.burst(enemy.x, enemy.y, enemy.color, big ? 46 : 16, big ? 340 : 220, big ? 0.7 : 0.45, big ? 5 : 3.5);
    particles.flash(enemy.x, enemy.y, big ? 90 : 34, enemy.color);
    if (big) particles.ring(enemy.x, enemy.y, enemy.color, 260, 0.6, 6);
    state.shake = Math.min(14, state.shake + (big ? 10 : 2.5));
    emit('explode', big ? 'big' : '');
    if (enemy.kind === 'splinter') {
      for (let shard = 0; shard < 2; shard += 1) spawnEnemy('shard', enemy.x + (shard * 2 - 1) * 18, enemy.y + 10);
    }
  }

  function hurtPlayer(damage, source) {
    const player = state.player;
    if (player.invulnerable > 0) return;
    if (player.shield > 0) {
      player.shield -= 1;
      player.shieldTimer = player.shieldRecharge;
      player.invulnerable = PLAYER.invulnerable;
      particles.ring(player.x, player.y, '#6f8cff', 180, 0.4, 5);
      emit('hit');
      return;
    }
    player.hp -= damage;
    player.invulnerable = PLAYER.invulnerable;
    player.hitFlash = 0.35;
    state.shake = Math.min(16, state.shake + 8);
    particles.burst(player.x, player.y, '#ff5a5f', 14, 200, 0.4, 3.5);
    emit('hurt');
    if (player.novaPower > 0) {
      const radius = 150 + 70 * player.novaPower;
      const damageDealt = 1.5 * player.novaPower;
      particles.ring(player.x, player.y, '#ffd166', radius * 1.6, 0.5, 7);
      for (let index = state.enemies.length - 1; index >= 0; index -= 1) {
        const enemy = state.enemies[index];
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        if (dx * dx + dy * dy < radius * radius) damageEnemy(enemy, damageDealt, { x: enemy.x, y: enemy.y });
      }
    }
    if (player.hp <= 0) {
      player.hp = 0;
      state.over = true;
      state.running = false;
      state.shake = 18;
      particles.burst(player.x, player.y, '#53d8ff', 40, 320, 0.9, 5);
      particles.ring(player.x, player.y, '#53d8ff', 420, 0.8, 8);
      emit('explode:big');
      emit('over');
    }
    if (source === undefined) return;
  }

  function collectGem(gem, index) {
    state.gems.splice(index, 1);
    state.xp += 1;
    particles.flash(gem.x, gem.y, 14, '#7dff9e');
    emit('pickup');
    while (state.xp >= state.xpNeeded) {
      state.xp -= state.xpNeeded;
      state.level += 1;
      state.xpNeeded = XP.base + XP.perLevel * (state.level - 1);
      state.pendingLevels += 1;
      emit('level');
    }
    if (state.pendingLevels > 0 && state.offers === null) {
      state.offers = rollOffers(state.taken, 3, random);
    }
  }

  function updateEnemies(dt) {
    const player = state.player;
    for (let index = state.enemies.length - 1; index >= 0; index -= 1) {
      const enemy = state.enemies[index];
      if (enemy.hitFlash > 0) enemy.hitFlash -= dt;
      if (enemy.touchCooldown > 0) enemy.touchCooldown -= dt;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const base = ENEMIES[enemy.kind];
      if (base.keepDistance) {
        // Watchers hold a ring around the player and snipe.
        const band = base.keepDistance;
        const direction = distance > band + 40 ? 1 : distance < band - 40 ? -1 : 0;
        const strafe = direction === 0 ? 1 : 0;
        const nx = (dx / distance) * direction - (dy / distance) * strafe * 0.8;
        const ny = (dy / distance) * direction + (dx / distance) * strafe * 0.8;
        enemy.x += nx * enemy.speed * dt;
        enemy.y += ny * enemy.speed * dt;
        enemy.fireTimer -= dt;
        if (enemy.fireTimer <= 0) {
          enemy.fireTimer = base.fireInterval;
          const boltSpeed = base.boltSpeed;
          state.bolts.push({ x: enemy.x, y: enemy.y, vx: (dx / distance) * boltSpeed, vy: (dy / distance) * boltSpeed });
          particles.flash(enemy.x, enemy.y, 14, '#ffb86b');
        }
      } else {
        enemy.wobble += enemy.wobbleRate * dt;
        const sway = enemy.kind === 'shard' ? Math.sin(enemy.wobble) * 0.5 : 0;
        const nx = dx / distance;
        const ny = dy / distance;
        enemy.x += (nx * Math.cos(sway) - ny * Math.sin(sway)) * enemy.speed * dt;
        enemy.y += (ny * Math.cos(sway) + nx * Math.sin(sway)) * enemy.speed * dt;
        if (base.spawnInterval) {
          enemy.spawnTimer -= dt;
          if (enemy.spawnTimer <= 0) {
            enemy.spawnTimer = base.spawnInterval;
            const point = edgePoint(random, SPAWN.edgeMargin);
            spawnEnemy('drifter', point.x, point.y);
          }
        }
      }
      // Contact damage.
      if (distance < enemy.radius + player.radius && enemy.touchCooldown <= 0) {
        enemy.touchCooldown = 0.9;
        hurtPlayer(enemy.damage);
        if (enemy.kind !== 'brute' && enemy.kind !== 'watcher') {
          particles.burst(enemy.x, enemy.y, enemy.color, 10, 180, 0.35, 3);
          state.enemies.splice(index, 1);
        }
      }
    }
  }

  function updateBullets(dt) {
    for (let index = state.bullets.length - 1; index >= 0; index -= 1) {
      const bullet = state.bullets[index];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (bullet.x < -30 || bullet.x > FIELD.width + 30 || bullet.y < -30 || bullet.y > FIELD.height + 30) {
        state.bullets.splice(index, 1);
        continue;
      }
      for (let enemyIndex = state.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
        const enemy = state.enemies[enemyIndex];
        const dx = enemy.x - bullet.x;
        const dy = enemy.y - bullet.y;
        if (dx * dx + dy * dy > enemy.radius * enemy.radius) continue;
        damageEnemy(enemy, bullet.damage, bullet);
        if (bullet.pierce > 0) {
          bullet.pierce -= 1;
        } else {
          state.bullets.splice(index, 1);
        }
        break;
      }
    }
  }

  function updateBolts(dt) {
    const player = state.player;
    for (let index = state.bolts.length - 1; index >= 0; index -= 1) {
      const bolt = state.bolts[index];
      bolt.x += bolt.vx * dt;
      bolt.y += bolt.vy * dt;
      if (bolt.x < -30 || bolt.x > FIELD.width + 30 || bolt.y < -30 || bolt.y > FIELD.height + 30) {
        state.bolts.splice(index, 1);
        continue;
      }
      const dx = player.x - bolt.x;
      const dy = player.y - bolt.y;
      if (dx * dx + dy * dy < (player.radius + 4) * (player.radius + 4)) {
        state.bolts.splice(index, 1);
        hurtPlayer(1);
      }
    }
  }

  function updateGems(dt) {
    const player = state.player;
    for (let index = state.gems.length - 1; index >= 0; index -= 1) {
      const gem = state.gems[index];
      gem.life -= dt;
      gem.twinkle += dt * 4;
      if (gem.life <= 0) {
        state.gems.splice(index, 1);
        continue;
      }
      const dx = player.x - gem.x;
      const dy = player.y - gem.y;
      const distance2 = dx * dx + dy * dy;
      if (distance2 < player.pickupRadius * player.pickupRadius) {
        const distance = Math.sqrt(distance2) || 1;
        const pull = GEM.speed * (1 + 2.2 * (1 - distance / player.pickupRadius));
        gem.vx += (dx / distance) * pull * dt * 6;
        gem.vy += (dy / distance) * pull * dt * 6;
      }
      gem.vx *= 0.985;
      gem.vy *= 0.985;
      gem.x += gem.vx * dt;
      gem.y += gem.vy * dt;
      if (distance2 < 22 * 22) collectGem(gem, index);
    }
  }

  function chooseOffer(id) {
    const upgrade = state.offers.find((offer) => offer.id === id);
    if (!upgrade) return;
    upgrade.apply(state.player);
    state.taken[id] = (state.taken[id] ?? 0) + 1;
    state.offers = null;
    state.pendingLevels -= 1;
    if (state.pendingLevels > 0) state.offers = rollOffers(state.taken, 3, random);
    particles.ring(state.player.x, state.player.y, '#ffd166', 220, 0.5, 6);
    emit('upgrade');
  }

  /** One fixed step. `move` is {x, y}, `aim` and `firing` drive the warden's gun. */
  function step(dt, move, aim, firing) {
    if (!state.running) return 0;
    const player = state.player;
    state.elapsed += dt;
    const wave = Math.min(WAVE.max, 1 + Math.floor(state.elapsed / WAVE.seconds));
    if (wave !== state.wave) {
      state.wave = wave;
      state.waveBanner = 2;
      emit('wave');
    }
    if (state.waveBanner > 0) state.waveBanner -= dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 30);
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.combo = 0;
    }
    if (player.invulnerable > 0) player.invulnerable -= dt;
    if (player.hitFlash > 0) player.hitFlash -= dt;
    if (player.shieldMax > 0 && player.shield < player.shieldMax) {
      player.shieldTimer -= dt;
      if (player.shieldTimer <= 0) {
        player.shield += 1;
        player.shieldTimer = player.shieldRecharge;
        particles.ring(player.x, player.y, '#6f8cff', 140, 0.35, 4);
      }
    }

    // Movement, clamped to the arena.
    const length = Math.hypot(move.x, move.y) || 1;
    player.x += (move.x / length) * player.speed * dt;
    player.y += (move.y / length) * player.speed * dt;
    clampToField(player);
    player.angle = Math.atan2(aim.y - player.y, aim.x - player.x);
    // Thruster embers behind the ship while it moves.
    if (move.x !== 0 || move.y !== 0) {
      const back = player.angle + Math.PI;
      particles.ember(player.x + Math.cos(back) * 14, player.y + Math.sin(back) * 14, Math.cos(back) * 60 + (random() - 0.5) * 40, Math.sin(back) * 60 + (random() - 0.5) * 40, '#53d8ff');
    }

    // Firing.
    player.fireTimer -= dt;
    if (firing && player.fireTimer <= 0) {
      player.fireTimer = player.fireInterval;
      fireBullet();
    }

    // Spawning.
    if (state.wave % BRUTE_WAVE === 0 && !state.enemies.some((enemy) => enemy.kind === 'brute') && state.waveBanner > 1.4) {
      const point = edgePoint(random, SPAWN.edgeMargin);
      spawnEnemy('brute', point.x, point.y);
    }
    state.spawnTimer = (state.spawnTimer ?? 1) - dt;
    if (state.spawnTimer <= 0) {
      state.spawnTimer = Math.max(SPAWN.minInterval, SPAWN.interval * SPAWN.intervalScale ** (state.wave - 1));
      spawnWaveEnemy();
      if (state.wave >= 6 && random() < 0.35) spawnWaveEnemy();
    }

    updateEnemies(dt);
    updateBullets(dt);
    updateBolts(dt);
    updateGems(dt);
    particles.step(dt);
    return state.over ? EVENT_OVER : 0;
  }

  reset();
  return { state, reset, step, chooseOffer, spawnEnemy, hurtPlayer };
}
