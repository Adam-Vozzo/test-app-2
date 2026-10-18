// Every tunable in one place. Units: metres, seconds, radians unless noted.

export const GAME = {
  title: 'PODRUSH',
  laps: 3,
  playerGridSlot: 5, // 0-based; last of six slots, so the first race is a climb through the pack
  fixedStep: 1 / 120, // physics sub-step upper bound
};

export const PHYSICS = {
  vmax: 92, // top speed on thrust alone (~330 km/h real; the HUD shows a "pod" scale)
  thrust: 36, // m/s^2 from standstill
  thrustExponent: 0.8, // how thrust tapers towards vmax
  coastDrag: 3, // m/s^2 while off the throttle
  coastDragLinear: 0.17, // 1/s while off the throttle, so letting go at speed is a real brake
  overspeedBleed: 1.4, // 1/s pull back to vmax after a boost
  yawMax: 1.2, // rad/s at mid speed
  yawLowSpeed: 0.55, // yaw multiplier at standstill (still lets you turn around)
  yawHighSpeed: 0.74, // yaw multiplier at top speed (tight corners need a lift)
  yawResponse: 9, // 1/s, how quickly yaw rate follows the stick
  grip: 5.5, // 1/s decay of sideways slide
  turnScrub: 0.045, // speed lost per (rad/s of yaw) per second
  slopeGravity: 4.5, // m/s^2 per unit of tangent.y (anti-grav, so heavily attenuated)
  bankGravity: 3.5, // m/s^2 per unit of right.y; banked turns pull you to the inside
  wallRestitution: 0.3,
  wallSpeedLoss: 0.011, // fraction of speed lost per m/s of impact
  wallMaxLoss: 0.45,
  wallFriction: 0.6, // 1/s while scraping
  wallAlign: 0.35, // heading kept after an impact when pointing into the wall
  boostDuration: 1.5,
  boostImpulse: 13,
  boostVmax: 1.28,
  boostThrust: 1.7,
  craftHalfWidth: 1.9,
  craftLength: 7.6,
  hoverHeight: 1.15,
};

export const ASSIST = {
  off: 0,
  low: 0.3,
  high: 0.55,
};

export const CAMERA = {
  distance: 11.5,
  height: 4.6,
  lookAhead: 14,
  lookHeight: 1.2,
  fovBase: 72, // vertical degrees (portrait)
  fovSpeed: 11, // added at top speed
  fovBoost: 6,
  headingLag: 6.5,
  upLag: 5,
  rollFromYaw: 0.16, // camera roll per rad/s of yaw
  trackUpBlend: 0.5, // how much the camera horizon follows track banking
  shakeWall: 0.55,
  shakeSpeed: 0.035,
};

export const INPUT = {
  // Degrees of phone roll that give full steering lock, per sensitivity setting.
  tiltFullLock: { low: 30, medium: 22, high: 15 },
  tiltDeadzone: 1.5, // degrees
  tiltSmoothing: 24, // 1/s low-pass on the sensor
  calibrationMinGravity: 0.35, // in-plane gravity needed to trust a roll reading
  touchRange: 0.2, // fraction of screen width for full lock in touch-steer mode
};

export const AI = {
  lookAheadBase: 18,
  lookAheadSpeed: 0.42,
  headingGain: 2.6,
  rubberBandRange: 320, // metres of gap for full rubber-band effect
  rubberBandAhead: 0.1, // max slow-down when leading the player
  rubberBandBehind: 0.12, // max speed-up when trailing the player
  cornerMargin: 0.88, // fraction of max yaw the AI plans to use in corners
};

export const ROSTER = [
  { name: 'VEX', body: '#ff4a4a', accent: '#2a1214', skill: 0.985 },
  { name: 'KORR', body: '#ffd23f', accent: '#2b2310', skill: 0.97 },
  { name: 'SABLE', body: '#a06bff', accent: '#1e1430', skill: 0.955 },
  { name: 'NOVA', body: '#2fdc8a', accent: '#0f2a1d', skill: 0.94 },
  { name: 'RIX', body: '#ff8a2b', accent: '#2d180a', skill: 0.925 },
];

export const PLAYER_LOOK = { name: 'YOU', body: '#eef3ff', accent: '#2f7bff' };

export const PALETTE = {
  skyTop: '#2a4f9a',
  skyHorizon: '#f7c58f',
  fog: '#f0c49a',
  sand: '#dca36a',
  sandDark: '#c58550',
  rock: '#b8613f',
  rockDark: '#7c3a28',
  rockLight: '#d98a5c',
  road: '#2a2f3b',
  roadLine: '#e9ecf5',
  wall: '#e7dfd3',
  wallTrim: '#3a3f4c',
  neonA: '#3df2ff',
  neonB: '#ff3fa4',
  pad: '#3df2ff',
  sign: '#ffcc33',
  sun: '#fff1c9',
};
