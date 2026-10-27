// Shared simulation/UI/render metadata. Durations are gameplay seconds.
export const ADDONS = Object.freeze({
  bubble: { name: 'Bubble Fruit', icon: '🫧', color: '#8deaff', description: 'Bounces you aboard after your next fall.', duration: 30 },
  chili: { name: 'Chili Noodles', icon: '🌶️', color: '#ff725d', description: 'Run faster across the deck for 8 seconds.', duration: 8 },
  anchor: { name: 'Anchor Biscuit', icon: '⚓', color: '#ffd479', description: 'Resist waves for 8 seconds, but walk more slowly.', duration: 8 },
  jelly: { name: 'Rubber Jelly', icon: '🍮', color: '#e2a4ff', description: 'Powerful air control and springy, forgiving deck landings.', duration: 8 },
  magnet: { name: 'Magnet Mint', icon: '🧲', color: '#ff8fad', description: 'The whole boat attracts supplies from farther away.', duration: 8 },
  ghost: { name: 'Ghost Grape', icon: '👻', color: '#bbc7ff', description: 'Your boat phases harmlessly through obstacles.', duration: 6 },
  balloon: { name: 'Balloon Berry', icon: '🎈', color: '#ffabc5', description: 'Float through the air with lower gravity.', duration: 8 },
  disco: { name: 'Disco Donut', icon: '🪩', color: '#84ffcc', description: 'Dance aboard! Treasure is worth double for 8 seconds.', duration: 8 },
  banana: { name: 'Banana Boat', icon: '🍌', color: '#fff17a', description: 'Slippery feet, faster slides, and 25% bonus treasure.', duration: 8 },
  thunder: { name: 'Thunder Pop', icon: '⚡', color: '#b8f4ff', description: 'Instantly clear nearby hazards with a shockwave.', duration: .8 },
  giant: { name: 'Giant Dumpling', icon: '🥟', color: '#ffd3a1', description: 'Grow bigger! More steering weight, slower footsteps.', duration: 8 },
  octopus: { name: 'Octopus Candy', icon: '🐙', color: '#c39bff', description: 'Grapple swimmers aboard, or shield the boat from waves.', duration: 8 },
});

export const ADDON_IDS = Object.freeze(Object.keys(ADDONS));
