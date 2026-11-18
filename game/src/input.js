// Keyboard and mouse input. Held keys give a movement direction, the mouse gives an aim point
// in arena coordinates (mapped through the renderer's transform), and one-shot presses (start,
// restart, pause, upgrade picks) are queued as bit flags and taken once by the loop.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MUTE = 4;

const UP = new Set(['KeyW', 'ArrowUp']);
const DOWN = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const CONFIRM = new Set(['Space', 'Enter']);

export function createInput(target, screenToField) {
  let up = false;
  let down = false;
  let left = false;
  let right = false;
  let firing = false;
  let actions = 0;
  const aim = { x: 640, y: 360 };
  const pick = { value: 0 };

  window.addEventListener('keydown', (event) => {
    if (UP.has(event.code)) up = true;
    else if (DOWN.has(event.code)) down = true;
    else if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (event.code === 'KeyP' || event.code === 'Escape') {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (event.code === 'KeyM') {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else if (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3') {
      pick.value = Number(event.code.slice(-1));
    } else return;
    event.preventDefault();
  });

  window.addEventListener('keyup', (event) => {
    if (UP.has(event.code)) up = false;
    else if (DOWN.has(event.code)) down = false;
    else if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
  });

  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    up = down = left = right = firing = false;
  });

  target.addEventListener('pointermove', (event) => {
    const field = screenToField(event.clientX, event.clientY);
    aim.x = field.x;
    aim.y = field.y;
  });

  target.addEventListener('pointerdown', (event) => {
    const field = screenToField(event.clientX, event.clientY);
    aim.x = field.x;
    aim.y = field.y;
    actions |= ACTION_CONFIRM;
    firing = true;
  });

  window.addEventListener('pointerup', () => {
    firing = false;
  });

  target.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    /** Movement direction as {x, y}, each axis -1, 0 or 1. */
    move() {
      return { x: (right ? 1 : 0) - (left ? 1 : 0), y: (down ? 1 : 0) - (up ? 1 : 0) };
    },
    /** The aim point in arena coordinates. */
    aim() {
      return aim;
    },
    /** Whether the fire button (mouse or Space) is held. */
    isFiring() {
      return firing;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** The digit key (1-3) pressed since the last call, 0 when none. */
    takePick() {
      const taken = pick.value;
      pick.value = 0;
      return taken;
    },
    /** Testing hook: hold the fire button without a real pointer. */
    setFiring(value) {
      firing = value;
    },
  };
}
