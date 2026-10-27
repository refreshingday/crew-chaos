# Crew Chaos!

A playable 3D HTML/WebGL cooperative boat game for **1–4 players**, built with Three.js, Vite, and PeerJS. The boat moves forward automatically. Your positions on deck steer it.

## Play online

**[Play Crew Chaos!](https://refreshingday.github.io/crew-chaos/)**

Open the link on your phone or PC. One player creates a room, then friends join using the four-character code. The GitHub Pages edition is public and requires no ChatGPT sign-in.

## Run locally

Requires Node.js 22.12+.

```sh
npm install
npm run dev
```

Open the printed localhost address. The game runs solo without any multiplayer service. Online rooms need internet access, WebRTC, and a secure origin (HTTPS or localhost). A plain HTTP LAN address may display the game but cannot create/join rooms; deploy over HTTPS for phones.

```sh
npm test
npm run build
npm run preview
```

`dist/` contains the complete static deployable build. It can be hosted on ordinary static HTTPS hosting. No Node application server or custom gameplay backend is deployed.

## GitHub Pages deployment

The workflow in `.github/workflows/pages.yml` installs the locked dependencies, runs the gameplay/networking tests, builds with Vite, and publishes `dist/` to GitHub Pages. Push changes to `main` to update the hosted game, or run the workflow manually from GitHub Actions. The Vite relative base supports the `/crew-chaos/` project path.

## Play

Choose a two-, three-, or four-minute voyage. Survive until the lighthouse with hull remaining.

| Action | PC | Mobile | Controller |
|---|---|---|---|
| Move / shift weight | WASD or arrows | Left joystick | Left stick |
| Brace against waves | Hold Space | Hold Brace | Right trigger |
| Rescue / use snack | Hold E near swimmer, tap otherwise | Rescue / Use | South button |
| Call for help | Q | ! button | North button |
| Instructions / solo pause | Escape or ? | ? | — |

Stand left or right to turn across an ocean with no sideways limit. Obstacles spawn around the boat’s current route. Stand at the bow to accelerate, or at the stern to slow down; the boat always maintains a minimum forward speed. Every 20 seconds in the standard three-minute voyage, the underlying cruising speed increases. Shorter and longer voyages scale that schedule proportionally. The speed display shows actual speed, trim direction, and the current pace level.

Big breakers visibly travel toward the boat in finite-width bands. Steer outside their foamy edges to dodge, or brace if you cross them. Unbraced waves can throw sailors into the air and sea. Obstacle collisions launch every sailor currently on deck, with a smaller jump while braced, plus an impact burst and large damage number. The rolling sea and matching ship rise/fall are cosmetic and do not add hidden launch forces.

Move to the same side as a swimmer and hold rescue. Solo sailors have an automatic lifeline. Emergency recovery consumes buoys, then hull.

Collect treasure for score, repair crates for hull, and twelve strange snacks. One snack can be held; use it with E or Use when you are not rescuing. Active effects have visible timers, and the in-game briefing contains the full snack galley.

| Snack | Effect |
|---|---|
| Bubble Fruit | Bounces you back aboard after your next fall. |
| Chili Noodles | Faster movement across the deck. |
| Anchor Biscuit | Wave resistance, with slower movement. |
| Rubber Jelly | Stronger air control and a springy, forgiving landing. |
| Magnet Mint | The whole boat collects supplies from farther away. |
| Ghost Grape | Temporarily phase the boat harmlessly through obstacles. |
| Balloon Berry | Float with lower gravity during launches. |
| Disco Donut | Double treasure value while the boat dances with color. |
| Banana Boat | Slippery feet and a 25% treasure bonus. |
| Thunder Pop | Instantly clear nearby hazards with a shockwave. |
| Giant Dumpling | A larger, heavier sailor steers harder and walks more slowly. |
| Octopus Candy | Grapple swimmers aboard, or protect the boat against waves. |

## Play together

1. Everyone opens the same deployed HTTPS game.
2. One player chooses **Create room** and shares the four-character code.
3. Up to three friends choose **Join room** and enter the code.
4. The captain launches. The same connected crew can rematch.

Room codes are case-insensitive letters/digits. New joins lock when the voyage begins. Keep the captain’s tab open and foregrounded for the most reliable simulation. Leaving the host ends the room. Guest disconnections remove their steering contribution. Automatic reconnection and host migration are not implemented.

The connection approach is adapted from your [multiplayerTest](https://github.com/refreshingday/multiplayerTest) project. **“No server” means no dedicated gameplay server:** public PeerJS signaling resolves rooms, STUN helps establish a direct WebRTC path, and the captain’s browser simulates the game. This build has no TURN relay, so some restricted network combinations cannot connect. See [networking details](docs/NETWORKING.md).

## Structure

- `src/game.js`: seeded authoritative simulation, independent of DOM and Three.js.
- `src/addons.js`: shared names, icons, descriptions, and durations for all twelve snacks.
- `src/network.js`: four-character rooms, capacity, handshakes, input validation, snapshots, rematches.
- `src/renderer.js`: procedural 3D art and animation, created by **GPT-6 Astra** at the user’s request.
- `src/ocean.js`: shared CPU/shader swell definitions that keep the boat aligned with the visible sea.
- `src/main.js`: menus, host simulation loop, guest interpolation, input, HUD, and synthesized audio.
- `src/style.css`: responsive interface and mobile control layout.
- `tests/`: gameplay and mocked network regression checks.

The current build includes an endless lateral ocean, seeded route-relative encounters, a final lighthouse, solo and online multiplayer, moving avoidable breakers, bow/stern speed control, timed speed escalation, collision launches and effects, rescue, repairs, treasure, twelve snacks, results, and rematch. The GDD’s cosmetic progression, daily challenges, additional biomes, public matchmaking, and extra boats remain future content.

## Validation

Automated tests cover seeded encounters, steering, braces, recovery, snacks, collision immunity, all crew sizes, 180-second completion, crew wipes, room capacity, join locking, sender identity, rematches, disconnects, and cleanup.

Mocked network tests do not prove carrier compatibility. Local real-browser tests and their exact scope are recorded in `docs/VALIDATION.md`. Physical phone performance and cross-carrier NAT behavior still need device testing before a production release.

The game itself has no account, analytics, or purchase system. The public GitHub Pages game requires no sign-in. An earlier private Sites preview requires its owner’s ChatGPT sign-in; the downloadable static build can also be placed on other HTTPS hosting. Optional fonts load from Google Fonts; system fallbacks are provided. All 3D meshes and effects are generated locally in the browser.
