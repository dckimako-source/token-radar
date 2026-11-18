// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints what is there. The game
// moves between five screens: title, play, upgrade (level-up choice), paused and game over.
//
// ?seed=N fixes the enemy pattern. ?shot=start|play|upgrade|end (with &seed=N) stages that scene
// instead of running the loop, paints it twice and sets window.__shotReady for a screenshot.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createParticles } from './particles.js';
import { createWorld, EVENT_OVER } from './world.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, createInput } from './input.js';
import { CARD_SLOTS, createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_UPGRADE } from './render.js';
import { stageShot } from './shots.js';
import { createAudio } from './audio.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const random = createRandom(seed);
const particles = createParticles();
const world = createWorld(random, particles);
const renderer = createRenderer(canvas, random);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const screen = stageShot(name, world, particles);
  const best = screen === SCREEN_OVER ? world.state.score : 0;
  let painted = 0;
  function paint() {
    renderer.draw(world.state, screen, best, 1.5);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas, renderer.screenToField);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let time = 0;

  // Screen readers (and anyone watching the page's text) hear the screen changes and each hit.
  function announce(message) {
    status.textContent = message;
  }

  function drainEvents() {
    const events = world.state.events;
    for (let index = 0; index < events.length; index += 1) {
      const [name, detail] = events[index].split(':');
      if (name === 'shoot') audio.shoot();
      else if (name === 'hit') audio.enemyHit();
      else if (name === 'explode') audio.explode(detail === 'big');
      else if (name === 'pickup') audio.pickup();
      else if (name === 'hurt') audio.hurt();
      else if (name === 'level') audio.levelUp();
      else if (name === 'upgrade') audio.upgrade();
      else if (name === 'over') audio.over();
      else if (name === 'wave') announce(`Wave ${world.state.wave}.`);
    }
    events.length = 0;
  }

  function startGame() {
    world.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing. Hold the horde back.');
  }

  function endGame() {
    screen = SCREEN_OVER;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    announce(`Ship destroyed. Score ${world.state.score}. Best ${best}.`);
  }

  function chooseCard(pick) {
    if (screen !== SCREEN_UPGRADE || world.state.offers === null) return;
    const offer = world.state.offers[pick - 1];
    if (offer === undefined) return;
    world.chooseOffer(offer.id);
    if (world.state.offers === null) screen = SCREEN_PLAY;
  }

  /** A pointer press lands on an upgrade card, or confirms the current screen. */
  function handlePointer(point) {
    if (screen === SCREEN_UPGRADE) {
      for (let index = 0; index < CARD_SLOTS.length; index += 1) {
        const card = CARD_SLOTS[index];
        if (point.x >= card.x && point.x <= card.x + card.width && point.y >= card.y && point.y <= card.y + card.height) {
          chooseCard(card.index + 1);
          return;
        }
      }
      return;
    }
    if (screen === SCREEN_TITLE || screen === SCREEN_OVER) startGame();
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Muted.' : 'Sound on.');
    }
    if (actions & ACTION_CONFIRM) {
      audio.unlock();
      handlePointer(input.aim());
    } else {
      const pick = input.takePick();
      if (pick > 0) chooseCard(pick);
    }
    if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY || screen === SCREEN_UPGRADE) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = world.state.offers !== null ? SCREEN_UPGRADE : SCREEN_PLAY;
        announce('Playing.');
      }
    }
  }

  function step(dt) {
    if (screen === SCREEN_TITLE) {
      // A living title: things drift behind the panel.
      const aim = { x: world.state.player.x, y: world.state.player.y - 200 };
      world.step(dt, { x: 0, y: 0 }, aim, false);
      world.state.events.length = 0;
      return;
    }
    if (screen === SCREEN_UPGRADE) return; // The choice waits for the player.
    if (world.step(dt, input.move(), input.aim(), input.isFiring()) & EVENT_OVER) endGame();
    else drainEvents();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const delta = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    time += delta;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      accumulator += delta;
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step(STEP);
        accumulator -= STEP;
      }
    } else {
      particles.step(delta);
      accumulator = 0;
    }
    renderer.draw(world.state, screen, best, time);
  }

  // Leaving the tab pauses a running game rather than letting the horde advance unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (screen === SCREEN_PLAY || screen === SCREEN_UPGRADE)) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Astral Warden. Press Space or click to launch.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
