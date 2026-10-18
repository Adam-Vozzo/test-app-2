# PODRUSH · anti-grav pod racing (prototype)

A phone-first, **portrait-mode** racing prototype: podracing (twin engines towing a cockpit through a desert canyon, twin suns, stone arches) meets Wipeout (anti-grav craft, banked neon track, speed pads). Everything is a stylised block-out, built with three.js and **no build step**, so GitHub Pages serves the repo as-is.

**Play:** <https://adam-vozzo.github.io/test-app-2/> (once Pages is switched on, see below)

## Controls

|            | Phone (default)                   | Touch fallback     | Desktop                |
| ---------- | --------------------------------- | ------------------ | ---------------------- |
| Steer      | **Tilt** like a steering wheel    | Thumb down + slide | ← → or A / D           |
| Accelerate | **Hold** anywhere on the screen   | Hold anywhere      | Hold Space / ↑ / mouse |
| Brake      | Let go                            | Let go             | Let go                 |
| Pause      | ⏸ (also automatic when you leave) | ⏸                  | Esc or P               |

Three laps, six racers, and you start last. Cyan chevron pads give a boost; amber chevron boards warn of tight corners.

## Put it on GitHub Pages

1. Merge the pull request into `main`.
2. In the repo go to **Settings → Pages → Build and deployment**, set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, then **Save**.
3. About a minute later, open <https://adam-vozzo.github.io/test-app-2/> on your phone. On iPhone, tap **Allow** when asked for motion access after you tap **Race**.

Alternatively pick **Source: GitHub Actions**. The `CI` workflow then deploys after the tests pass on every push to `main` (after switching, run it once from the Actions tab). With "Deploy from a branch" the workflow only runs the tests and leaves deploying to GitHub.

Tip: use **Add to Home Screen** for full-screen play; the page ships a web app manifest locked to portrait.

## Run locally

```sh
npm start   # http://127.0.0.1:8080 (no dependencies, Node 20+)
npm test    # track, physics, tilt maths and race flow tests
```

Phones only expose motion sensors on HTTPS pages, so test tilt on the Pages URL (or through an HTTPS tunnel). The local server is for desktop iteration with the keyboard.

## UX principles applied

- **Learn by doing.** The pre-race screen shows a phone icon and steering meter that mirror your phone live, and you start the race by holding the screen, which is the same action as accelerating.
- **Calibrated to your grip.** "Straight ahead" is however you are holding the phone when you start. You can recenter from the pause menu.
- **Steering that feels like a wheel.** Tilt is measured as the roll of gravity across the screen, so it responds the same whether you hold the phone upright or tipped back. It also has a small deadzone, gentle expo near centre, and about 40 ms of smoothing.
- **Ask, explain, fall back.** iOS motion permission is requested inside the Race tap. If it's declined or there's no sensor, you get touch-slide steering and a toast that says why and how to switch back.
- **Forgiving.** Walls scrape and redirect instead of stopping you. You also get a wrong-way warning, automatic turn-around, steering assist (Off / Low / High), and a one-time tip if lap one is going badly.
- **Thumb-friendly portrait layout.** Hold anywhere. Primary buttons sit at the bottom, the race HUD sits at the top away from thumbs, and safe areas (notch, home bar) are respected.
- **Feedback on every channel.** Gantry countdown lights, audio cues, vibration on Android, screen-edge flashes on impacts and boosts, speed lines and FOV kick at speed, and position pop-ups when you overtake.
- **Respectful of the device.** It auto-pauses on app switch or rotation, runs a short 3-2-1 on resume, and keeps the screen awake while racing. Resolution adapts to hold the frame rate, and there's a reduce-motion option. Settings and personal bests persist locally, and there are no network calls.

## How it's built

| Area    | Approach                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Track   | Catmull-Rom spline resampled every 2 m into frames (tangent, right, up). Banking is derived from curvature, and banked sections are lifted so the low edge clears the ground. |
| Physics | Track space: `s` along the track, `x` across it, plus heading. Corners rotate the frame under the craft, so you have to steer through them, and walls are a simple clamp.     |
| AI      | Precomputed racing line plus a corner-speed profile built from the same yaw limits the player has, with mild rubber-banding.                                                  |
| Visuals | Merged/instanced block-out geometry, canvas-drawn textures, fog, contact shadows, adaptive pixel ratio.                                                                       |
| Audio   | Fully synthesised with WebAudio: engine drone with podracer flutter, wind, rival pass-bys, cues.                                                                              |

```
index.html            all screens and the HUD (plain DOM over the WebGL canvas)
css/style.css         UI styling, safe areas, desktop "phone column" layout
src/main.js           game flow state machine, event -> feedback wiring
src/config.js         every tuning number (physics, camera, input, AI, palette)
src/track.js          track definition + spline/frames/banking
src/physics.js        craft physics, walls, speed pads, collisions
src/ai.js             racing line, speed profile, AI driver
src/race.js           grid, countdown, laps, positions, events
src/input.js          tilt maths, hold/slide pointers, keyboard
src/world.js          renderer, scene, lights, adaptive resolution
src/trackMesh.js      road, walls, neon strips, pads, signs, gantry
src/environment.js    sky, twin suns, dunes, mesas, canyon, arches, grandstand
src/racerModel.js     pod racer block-out + animation
src/camera.js         chase / orbit camera rig
src/hud.js, ui.js     HUD, menus, settings, results
src/audio.js          synthesised audio
tests/                node --test suites
vendor/               three.js r186 (minified ES module, MIT)
assets/               icons, Chakra Petch font (SIL OFL)
```

To change the layout, edit `TRACK_DEF.points` in `src/track.js` (the tests check corner radius and clearance). To change the handling, edit `PHYSICS` in `src/config.js`.

## Credits

- [three.js](https://threejs.org) r186, MIT: `vendor/three.LICENSE.txt`
- [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch), SIL Open Font License 1.1: `assets/fonts/OFL.txt`
