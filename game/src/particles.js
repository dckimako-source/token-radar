// Particle effects and shockwave rings: sparks from hits and deaths, thruster flames, gem
// twinkles, damage flashes, and the expanding rings a shockwave or a boss death leaves.
// A fixed pool keeps frames allocation-free.

import { FIELD } from './config.js';

export const POOL_SIZE = 900;

const TYPE_SPARK = 0;
const TYPE_EMBER = 1;
const TYPE_RING = 2;
const TYPE_FLASH = 3;

export function createParticles() {
  const pool = [];
  for (let index = 0; index < POOL_SIZE; index += 1) {
    pool.push({ active: false, type: TYPE_SPARK, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 0, color: '#fff', drag: 1 });
  }
  let cursor = 0;

  function spawn(type, x, y, vx, vy, life, size, color, drag) {
    const particle = pool[cursor];
    cursor = (cursor + 1) % POOL_SIZE;
    particle.active = true;
    particle.type = type;
    particle.x = x;
    particle.y = y;
    particle.vx = vx;
    particle.vy = vy;
    particle.life = life;
    particle.maxLife = life;
    particle.size = size;
    particle.color = color;
    particle.drag = drag;
  }

  function burst(x, y, color, count, speed, life, size) {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const power = speed * (0.35 + Math.random() * 0.65);
      spawn(TYPE_SPARK, x, y, Math.cos(angle) * power, Math.sin(angle) * power, life * (0.6 + Math.random() * 0.8), size * (0.6 + Math.random() * 0.8), color, 0.9);
    }
  }

  function ring(x, y, color, speed, life, width) {
    spawn(TYPE_RING, x, y, speed, 0, life, width, color, 1);
  }

  function flash(x, y, size, color) {
    spawn(TYPE_FLASH, x, y, 0, 0, 0.14, size, color, 1);
  }

  function ember(x, y, vx, vy, color) {
    spawn(TYPE_EMBER, x, y, vx, vy, 0.5 + Math.random() * 0.4, 2 + Math.random() * 2, color, 0.96);
  }

  function step(dt) {
    for (let index = 0; index < pool.length; index += 1) {
      const particle = pool[index];
      if (!particle.active) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.x *= particle.drag;
      particle.y *= particle.drag;
      if (particle.type === TYPE_RING) particle.size = Math.max(1, particle.size - dt * 60);
    }
  }

  function draw(context) {
    for (let index = 0; index < pool.length; index += 1) {
      const particle = pool[index];
      if (!particle.active) continue;
      const fade = particle.life / particle.maxLife;
      if (particle.type === TYPE_RING) {
        const radius = (1 - fade) * particle.vx;
        context.globalAlpha = fade * 0.8;
        context.strokeStyle = particle.color;
        context.lineWidth = particle.size;
        context.beginPath();
        context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        context.stroke();
      } else if (particle.type === TYPE_FLASH) {
        context.globalAlpha = fade;
        const gradient = context.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, particle.size);
        gradient.addColorStop(0, particle.color);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(particle.x - particle.size, particle.y - particle.size, particle.size * 2, particle.size * 2);
      } else {
        context.globalAlpha = fade;
        context.fillStyle = particle.color;
        const size = particle.size * (particle.type === TYPE_EMBER ? fade : 1);
        context.fillRect(particle.x - size / 2, particle.y - size / 2, size, size);
      }
    }
    context.globalAlpha = 1;
  }

  function clear() {
    for (let index = 0; index < pool.length; index += 1) pool[index].active = false;
  }

  return { step, draw, burst, ring, flash, ember, clear };
}

/** Keep the arena's edges tidy: effects that fly out of bounds stop being drawn work. */
export function inField(x, y) {
  return x > -FIELD.width * 0.2 && x < FIELD.width * 1.2 && y > -FIELD.height * 0.2 && y < FIELD.height * 1.2;
}
