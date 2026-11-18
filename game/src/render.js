// Drawing only: the world's state and the current screen in, pixels out. The 1280x720 arena is
// scaled to fit the window and centred. Enemies are drawn as distinct glowing shapes, the warden
// as an aimed ship with a thruster, and the HUD shows score with its combo multiplier, wave,
// hull, shields, XP and level. Panel screens (title, upgrade, paused, over) paint over the field.

import { COMBO, FIELD, FONT, PALETTE } from './config.js';
import { createBackdrop } from './backdrop.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_UPGRADE = 'upgrade';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

/** Where each upgrade card sits in arena coordinates, for click picking; set per draw. */
export const CARD_SLOTS = [];

const CARD = { width: 300, height: 220, gap: 30 };

function cachedLabel(prefix) {
  let value = -1;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

export function createRenderer(canvas, random) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const backdrop = createBackdrop(FIELD.width, FIELD.height, random);
  const camera = { x: 0, y: 0 };
  const scoreLabel = cachedLabel('Score ');
  const waveLabel = cachedLabel('Wave ');
  const levelLabel = cachedLabel('Level ');

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align, bold) {
    const font = `${bold ? '700 ' : ''}${size}px ${FONT}`;
    if (!fonts.has(font)) fonts.set(font, font);
    context.font = font;
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(value, x, y);
  }

  function glow(shape) {
    context.shadowColor = shape.color;
    context.shadowBlur = shape.blur;
    shape.paint();
    context.shadowBlur = 0;
  }

  /** Enemy silhouettes: drifter blob, shard splinter, watcher eye, brute fortress. */
  function drawEnemy(enemy, time) {
    const wobble = Math.sin(time * enemy.wobbleRate * 2 + enemy.wobble);
    context.save();
    context.translate(enemy.x, enemy.y);
    const color = enemy.hitFlash > 0 ? '#ffffff' : enemy.color;
    if (enemy.kind === 'drifter') {
      glow({
        color,
        blur: 14,
        paint: () => {
          context.fillStyle = color;
          context.beginPath();
          context.arc(0, 0, enemy.radius, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = 'rgba(0,0,0,0.35)';
          context.beginPath();
          context.arc(0, 0, enemy.radius * 0.55, 0, Math.PI * 2);
          context.fill();
        },
      });
    } else if (enemy.kind === 'shard') {
      glow({
        color,
        blur: 10,
        paint: () => {
          context.fillStyle = color;
          context.beginPath();
          context.moveTo(0, -enemy.radius);
          context.lineTo(enemy.radius, enemy.radius);
          context.lineTo(-enemy.radius, enemy.radius);
          context.closePath();
          context.fill();
        },
      });
    } else if (enemy.kind === 'splinter') {
      glow({
        color,
        blur: 14,
        paint: () => {
          context.rotate(time * 1.4 + enemy.wobble);
          context.fillStyle = color;
          context.beginPath();
          for (let point = 0; point < 6; point += 1) {
            const angle = (point / 6) * Math.PI * 2;
            const radius = point % 2 === 0 ? enemy.radius : enemy.radius * 0.6;
            context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
          }
          context.closePath();
          context.fill();
        },
      });
    } else if (enemy.kind === 'watcher') {
      glow({
        color,
        blur: 16,
        paint: () => {
          context.fillStyle = color;
          context.beginPath();
          context.ellipse(0, 0, enemy.radius, enemy.radius * 0.75, 0, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = '#1b0f00';
          context.beginPath();
          context.arc(0, 0, enemy.radius * 0.4, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = '#ffe08a';
          context.beginPath();
          context.arc(Math.cos(time * 2) * 3, Math.sin(time * 2) * 3, enemy.radius * 0.16, 0, Math.PI * 2);
          context.fill();
        },
      });
    } else {
      glow({
        color,
        blur: 22,
        paint: () => {
          context.rotate(time * 0.4);
          context.fillStyle = color;
          context.beginPath();
          for (let point = 0; point < 8; point += 1) {
            const angle = (point / 8) * Math.PI * 2;
            const radius = enemy.radius * (point % 2 === 0 ? 1 : 0.82) * (1 + wobble * 0.04);
            context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
          }
          context.closePath();
          context.fill();
          context.rotate(-time * 0.8);
          context.fillStyle = 'rgba(0,0,0,0.4)';
          context.beginPath();
          context.arc(0, 0, enemy.radius * 0.55, 0, Math.PI * 2);
          context.fill();
        },
      });
    }
    context.restore();
    // Health pip for the big ones.
    if (enemy.maxHp > 8) {
      const width = enemy.radius * 2.2;
      context.fillStyle = 'rgba(0,0,0,0.5)';
      context.fillRect(enemy.x - width / 2, enemy.y - enemy.radius - 12, width, 6);
      context.fillStyle = enemy.color;
      context.fillRect(enemy.x - width / 2, enemy.y - enemy.radius - 12, (width * enemy.hp) / enemy.maxHp, 6);
    }
  }

  function drawShip(player, time) {
    const blink = player.invulnerable > 0 && Math.floor(player.invulnerable * 12) % 2 === 0;
    if (!blink) {
      glow({
        color: PALETTE.player,
        blur: 18,
        paint: () => {
          context.save();
          context.translate(player.x, player.y);
          context.rotate(player.angle);
          const hurt = player.hitFlash > 0;
          context.fillStyle = hurt ? '#ffffff' : PALETTE.player;
          context.beginPath();
          context.moveTo(20, 0);
          context.lineTo(-12, 12);
          context.lineTo(-6, 0);
          context.lineTo(-12, -12);
          context.closePath();
          context.fill();
          // Cockpit dot.
          context.fillStyle = '#0a0c14';
          context.beginPath();
          context.arc(4, 0, 3.5, 0, Math.PI * 2);
          context.fill();
          context.restore();
        },
      });
    }
    // Shield bubbles.
    if (player.shield > 0) {
      context.strokeStyle = PALETTE.shield;
      context.globalAlpha = 0.5 + 0.2 * Math.sin(time * 4);
      context.lineWidth = 2.5;
      context.beginPath();
      context.arc(player.x, player.y, player.radius + 10, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  function drawField(state, time) {
    backdrop.draw(context, time, camera.x, camera.y);
    // Arena edge.
    context.strokeStyle = 'rgba(83, 216, 255, 0.12)';
    context.lineWidth = 2;
    context.strokeRect(1, 1, FIELD.width - 2, FIELD.height - 2);

    // Cores (XP gems).
    for (let index = 0; index < state.gems.length; index += 1) {
      const gem = state.gems[index];
      const fade = gem.life < 3 ? 0.4 + 0.6 * Math.abs(Math.sin(gem.life * 6)) : 1;
      context.globalAlpha = fade;
      glow({
        color: PALETTE.gem,
        blur: 10,
        paint: () => {
          context.save();
          context.translate(gem.x, gem.y);
          context.rotate(time * 2 + gem.twinkle);
          context.fillStyle = PALETTE.gem;
          context.beginPath();
          context.moveTo(0, -GEM_DRAW);
          context.lineTo(GEM_DRAW * 0.7, 0);
          context.lineTo(0, GEM_DRAW);
          context.lineTo(-GEM_DRAW * 0.7, 0);
          context.closePath();
          context.fill();
          context.restore();
        },
      });
      context.globalAlpha = 1;
    }

    // Bullets and enemy bolts.
    for (let index = 0; index < state.bullets.length; index += 1) {
      const bullet = state.bullets[index];
      glow({
        color: bullet.crit ? '#ffd166' : PALETTE.bullet,
        blur: 10,
        paint: () => {
          context.strokeStyle = bullet.crit ? '#ffd166' : PALETTE.bullet;
          context.lineWidth = bullet.crit ? 5 : 3.5;
          context.beginPath();
          context.moveTo(bullet.x, bullet.y);
          context.lineTo(bullet.x - bullet.vx * 0.02, bullet.y - bullet.vy * 0.02);
          context.stroke();
        },
      });
    }
    for (let index = 0; index < state.bolts.length; index += 1) {
      const bolt = state.bolts[index];
      glow({
        color: PALETTE.bolt,
        blur: 12,
        paint: () => {
          context.fillStyle = PALETTE.bolt;
          context.beginPath();
          context.arc(bolt.x, bolt.y, 6, 0, Math.PI * 2);
          context.fill();
        },
      });
    }

    for (let index = 0; index < state.enemies.length; index += 1) drawEnemy(state.enemies[index], time);
    if (!state.over) drawShip(state.player, time);
  }

  const GEM_DRAW = 9;

  function drawHud(state) {
    const player = state.player;
    context.textBaseline = 'top';
    // Score with the live combo multiplier beside it.
    text(scoreLabel(state.score), 26, 18, 30, PALETTE.text, 'left', true);
    if (state.combo >= 2) {
      const heat = Math.min(1, (state.combo - 1) / (COMBO.max - 1));
      context.globalAlpha = 0.55 + 0.45 * heat;
      text(`x${state.combo} combo`, 26, 52, 22, heat > 0.6 ? PALETTE.accent : PALETTE.bullet, 'left', true);
      context.globalAlpha = 1;
    }
    text(waveLabel(state.wave), FIELD.width / 2, 18, 26, PALETTE.muted, 'center', true);
    text(levelLabel(state.level), FIELD.width - 26, 18, 26, PALETTE.muted, 'right', true);

    // Hull segments, bottom left.
    const segments = player.maxHp;
    const width = 26;
    const gap = 6;
    for (let index = 0; index < segments; index += 1) {
      const filled = index < player.hp;
      context.fillStyle = filled ? (player.hp <= 2 ? PALETTE.hpLow : PALETTE.hp) : 'rgba(255,255,255,0.12)';
      context.fillRect(26 + index * (width + gap), FIELD.height - 40, width, 14);
    }
    // Shield pips beside the hull.
    if (player.shieldMax > 0) {
      for (let index = 0; index < player.shieldMax; index += 1) {
        context.fillStyle = index < player.shield ? PALETTE.shield : 'rgba(255,255,255,0.12)';
        context.beginPath();
        context.arc(26 + index * 18, FIELD.height - 56, 6, 0, Math.PI * 2);
        context.fill();
      }
    }
    // XP bar along the very bottom.
    context.fillStyle = 'rgba(255,255,255,0.1)';
    context.fillRect(0, FIELD.height - 8, FIELD.width, 8);
    context.fillStyle = PALETTE.gem;
    context.fillRect(0, FIELD.height - 8, FIELD.width * Math.min(1, state.xp / state.xpNeeded), 8);

    // Wave banner, big and brief.
    if (state.waveBanner > 0) {
      const alpha = Math.min(1, state.waveBanner);
      context.globalAlpha = alpha;
      text(`WAVE ${state.wave}`, FIELD.width / 2, FIELD.height / 2 - 120, 64, PALETTE.accent, 'center', true);
      if (state.wave % 4 === 0) text('A brute approaches', FIELD.width / 2, FIELD.height / 2 - 50, 24, PALETTE.danger, 'center');
      context.globalAlpha = 1;
    }
  }

  function drawPanel(title, lines, prompt) {
    const height = 120 + lines.length * 30 + 60;
    const width = 660;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = 'rgba(10, 12, 20, 0.82)';
    context.fillRect(x, y, width, height);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(x, y, width, height);
    context.textBaseline = 'alphabetic';
    text(title, FIELD.width / 2, y + 76, 52, PALETTE.text, 'center', true);
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + 130 + index * 30, 21, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 34, 24, PALETTE.accent, 'center', true);
  }

  function drawUpgradeScreen(state, time) {
    const offers = state.offers ?? [];
    CARD_SLOTS.length = 0;
    context.fillStyle = 'rgba(10, 12, 20, 0.7)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    text('LEVEL UP', FIELD.width / 2, 96, 54, PALETTE.accent, 'center', true);
    text(`Level ${state.level} reached — choose one system upgrade`, FIELD.width / 2, 136, 22, PALETTE.muted, 'center');
    const totalWidth = offers.length * CARD.width + (offers.length - 1) * CARD.gap;
    for (let index = 0; index < offers.length; index += 1) {
      const offer = offers[index];
      const x = (FIELD.width - totalWidth) / 2 + index * (CARD.width + CARD.gap);
      const y = 200 + Math.sin(time * 2.2 + index * 1.3) * 6;
      CARD_SLOTS.push({ x, y, width: CARD.width, height: CARD.height, index });
      context.fillStyle = 'rgba(22, 27, 40, 0.95)';
      context.fillRect(x, y, CARD.width, CARD.height);
      context.strokeStyle = PALETTE.accent;
      context.lineWidth = 2;
      context.strokeRect(x, y, CARD.width, CARD.height);
      context.textBaseline = 'top';
      text(`${index + 1}`, x + 16, y + 14, 24, PALETTE.accent, 'left', true);
      text(offer.name, x + CARD.width / 2, y + 60, 26, PALETTE.text, 'center', true);
      text(offer.description, x + CARD.width / 2, y + 104, 18, PALETTE.muted, 'center');
      const level = state.taken[offer.id] ?? 0;
      if (level > 0) text(`owned ${level}/${offer.max}`, x + CARD.width / 2, y + 140, 16, PALETTE.player, 'center');
      text('press ' + (index + 1), x + CARD.width / 2, y + CARD.height - 30, 16, PALETTE.muted, 'center');
    }
    text('Click a card or press 1 · 2 · 3', FIELD.width / 2, FIELD.height - 40, 20, PALETTE.accent, 'center');
  }

  function drawOver(state, best) {
    context.fillStyle = 'rgba(10, 12, 20, 0.78)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    const width = 700;
    const height = 420;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = 'rgba(16, 20, 30, 0.92)';
    context.fillRect(x, y, width, height);
    context.strokeStyle = PALETTE.danger;
    context.lineWidth = 2;
    context.strokeRect(x, y, width, height);
    context.textBaseline = 'alphabetic';
    text('SHIP DESTROYED', FIELD.width / 2, y + 90, 56, PALETTE.danger, 'center', true);
    text(`Score ${state.score}`, FIELD.width / 2, y + 160, 34, PALETTE.text, 'center', true);
    text(`Best ${best}`, FIELD.width / 2, y + 205, 24, state.score >= best && state.score > 0 ? PALETTE.accent : PALETTE.muted, 'center');
    const stats = [
      [`Waves survived`, `${state.wave}`],
      [`Enemies destroyed`, `${state.kills}`],
      [`Best combo`, `x${Math.max(1, state.bestCombo)}`],
      [`Level reached`, `${state.level}`],
      [`Time aloft`, `${Math.floor(state.elapsed)}s`],
    ];
    for (let index = 0; index < stats.length; index += 1) {
      const row = stats[index];
      text(row[0], x + 90, y + 250 + index * 28, 20, PALETTE.muted, 'left');
      text(row[1], x + width - 90, y + 250 + index * 28, 20, PALETTE.text, 'right', true);
    }
    text('Press Space or click to launch again', FIELD.width / 2, y + height - 30, 22, PALETTE.accent, 'center', true);
  }

  /** Paint one frame: the field, then the HUD or the panel for the screen the game is on. */
  function draw(state, screen, best, time) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    // Screen shake, applied in device pixels.
    const shakeX = (Math.random() - 0.5) * state.shake * view.scale;
    const shakeY = (Math.random() - 0.5) * state.shake * view.scale;
    context.setTransform(view.scale, 0, 0, view.scale, view.x + shakeX, view.y + shakeY);
    context.beginPath();
    context.rect(0, 0, FIELD.width, FIELD.height);
    context.clip();
    drawField(state, time);
    if (screen === SCREEN_PLAY || screen === SCREEN_UPGRADE || screen === SCREEN_PAUSED || screen === SCREEN_OVER) {
      drawHud(state);
      if (screen === SCREEN_UPGRADE) drawUpgradeScreen(state, time);
      else if (screen === SCREEN_PAUSED) drawPanel('Paused', ['The horde will wait for you.', ''], 'Press P to resume');
      else if (screen === SCREEN_OVER) drawOver(state, best);
    } else {
      drawPanel('ASTRAL WARDEN', [
        'The horde comes from deep space. Hold the line.',
        'WASD / arrows to fly   ·   mouse to aim   ·   hold to fire',
        'Grab green cores to level up and pick upgrades',
        'M mute   ·   P pause',
      ], 'Press Space or click to launch');
    }
    context.restore();
    // Vignette painted over everything but under nothing.
    const player = state.player;
    if (player && player.hitFlash > 0 && screen !== SCREEN_TITLE) {
      const gradient = context.createRadialGradient(FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.32, FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.78);
      gradient.addColorStop(0, 'rgba(255, 60, 80, 0)');
      gradient.addColorStop(1, `rgba(255, 60, 80, ${0.45 * (player.hitFlash / 0.35)})`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, FIELD.width, FIELD.height);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return {
    draw,
    screenToField(clientX, clientY) {
      return { x: (clientX - view.x) / view.scale, y: (clientY - view.y) / view.scale };
    },
  };
}
