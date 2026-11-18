// The upgrade deck: every level-up offers a choice of three, drawn from this pool. Each card
// names what it does and applies itself to the player's stats, so choices stack and matter:
// fire rate, spread, damage, speed, armour, shields, magnetism, crits and piercing.

import { PLAYER } from './config.js';

export const UPGRADES = [
  {
    id: 'rapid',
    name: 'Rapid Cycler',
    description: 'Fire 20% faster',
    max: 6,
    apply(player) {
      player.fireInterval *= 0.8;
    },
  },
  {
    id: 'twin',
    name: 'Split Array',
    description: '+1 bullet per shot',
    max: 3,
    apply(player) {
      player.barrels += 1;
    },
  },
  {
    id: 'power',
    name: 'Heavy Rounds',
    description: 'Bullets deal +1 damage',
    max: 6,
    apply(player) {
      player.bulletDamage += 1;
    },
  },
  {
    id: 'swift',
    name: 'Ion Thrusters',
    description: 'Move 15% faster',
    max: 4,
    apply(player) {
      player.speed *= 1.15;
    },
  },
  {
    id: 'vitality',
    name: 'Nano Plating',
    description: '+2 max hull, repair 3',
    max: 4,
    apply(player) {
      player.maxHp += 2;
      player.hp = Math.min(player.maxHp, player.hp + 3);
    },
  },
  {
    id: 'shield',
    name: 'Aegis Field',
    description: 'A shield that recharges',
    max: 3,
    apply(player) {
      player.shieldMax += 1;
      player.shield = player.shieldMax;
      player.shieldRecharge = Math.max(4, player.shieldRecharge - 1.5);
    },
  },
  {
    id: 'magnet',
    name: 'Tractor Coil',
    description: 'Pull cores from further away',
    max: 4,
    apply(player) {
      player.pickupRadius += 65;
    },
  },
  {
    id: 'nova',
    name: 'Reactive Nova',
    description: 'Blast enemies when hit',
    max: 3,
    apply(player) {
      player.novaPower += 1;
    },
  },
  {
    id: 'crit',
    name: 'Fracture Core',
    description: '20% chance: double damage',
    max: 3,
    apply(player) {
      player.critChance = Math.min(0.6, player.critChance + 0.2);
    },
  },
  {
    id: 'pierce',
    name: 'Lance Rounds',
    description: 'Bullets pierce +1 enemy',
    max: 3,
    apply(player) {
      player.pierce += 1;
    },
  },
];

export function createStats() {
  return {
    radius: PLAYER.radius,
    speed: PLAYER.speed,
    hp: PLAYER.hp,
    maxHp: PLAYER.hp,
    fireInterval: PLAYER.fireInterval,
    bulletSpeed: PLAYER.bulletSpeed,
    bulletDamage: PLAYER.bulletDamage,
    barrels: 1,
    pierce: 0,
    critChance: 0,
    pickupRadius: PLAYER.pickupRadius,
    shieldMax: 0,
    shield: 0,
    shieldRecharge: 9,
    novaPower: 0,
  };
}

/** Pick `count` distinct offers the player has not already maxed, favouring room to grow. */
export function rollOffers(taken, count, random) {
  const open = [];
  for (let index = 0; index < UPGRADES.length; index += 1) {
    const upgrade = UPGRADES[index];
    if ((taken[upgrade.id] ?? 0) < upgrade.max) open.push(upgrade);
  }
  // Fisher-Yates over the open cards, take the first `count`.
  for (let index = open.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = open[index];
    open[index] = open[swap];
    open[swap] = held;
  }
  return open.slice(0, count);
}
