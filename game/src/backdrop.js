// The deep-space backdrop: three parallax star layers that drift against the player's motion,
// over a nebula pre-rendered once to an offscreen canvas. Drawing only; no game state.

export function createBackdrop(width, height, random) {
  const nebula = document.createElement('canvas');
  nebula.width = width;
  nebula.height = height;
  const nctx = nebula.getContext('2d');
  // Soft coloured clouds: overlapping radial gradients, tinted per cloud.
  const tints = [
    ['rgba(64, 40, 110, 0.55)', 'rgba(64, 40, 110, 0)'],
    ['rgba(20, 70, 100, 0.45)', 'rgba(20, 70, 100, 0)'],
    ['rgba(90, 30, 70, 0.35)', 'rgba(90, 30, 70, 0)'],
  ];
  for (let cloud = 0; cloud < 14; cloud += 1) {
    const tint = tints[cloud % tints.length];
    const cx = random() * width;
    const cy = random() * height;
    const radius = 130 + random() * 260;
    const gradient = nctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, tint[0]);
    gradient.addColorStop(1, tint[1]);
    nctx.fillStyle = gradient;
    nctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  // Stars: three depths, each with a parallax factor and a twinkle phase.
  const stars = [];
  const layers = [
    { count: 90, size: 1.1, parallax: 0.04, alpha: 0.5 },
    { count: 55, size: 1.8, parallax: 0.09, alpha: 0.75 },
    { count: 26, size: 2.6, parallax: 0.16, alpha: 1 },
  ];
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    for (let star = 0; star < layer.count; star += 1) {
      stars.push({
        x: random() * width,
        y: random() * height,
        size: layer.size * (0.7 + random() * 0.6),
        parallax: layer.parallax,
        alpha: layer.alpha * (0.6 + random() * 0.4),
        phase: random() * Math.PI * 2,
      });
    }
  }

  return {
    /** Paint the backdrop; the camera drifts by (camX, camY) as the player moves. */
    draw(context, time, camX, camY) {
      context.fillStyle = '#0a0c14';
      context.fillRect(0, 0, width, height);
      context.drawImage(nebula, -camX * 0.02, -camY * 0.02);
      for (let index = 0; index < stars.length; index += 1) {
        const star = stars[index];
        const twinkle = 0.65 + 0.35 * Math.sin(time * 1.7 + star.phase);
        context.globalAlpha = star.alpha * twinkle;
        context.fillStyle = '#cfe4ff';
        const x = ((star.x - camX * star.parallax) % width + width) % width;
        const y = ((star.y - camY * star.parallax) % height + height) % height;
        context.fillRect(x, y, star.size, star.size);
      }
      context.globalAlpha = 1;
    },
  };
}
