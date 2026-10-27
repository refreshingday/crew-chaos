# Crew Chaos!

A playable 3D HTML/WebGL cooperative boat game for **1–4 players**, built with Three.js, Vite, and PeerJS. The boat moves forward automatically. Your positions on deck steer it.

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

## Play

Choose a two-, three-, or four-minute voyage. Survive until the lighthouse with hull remaining.

| Action | PC | Mobile | Controller |
|---|---|---|---|
| Move / shift weight | WASD or arrows | Left joystick | Left stick |
| Brace against waves | Hold Space | Hold Brace | Right trigger |
| Rescue / use snack | Hold E near swimmer, tap otherwise | Rescue / Use | South button |
| Call for help | Q | ! button | North button |
| Instructions / solo pause | Escape or ? | ? | — |

Stand left or right to turn. The average position of all crew members determines the ship’s steering. Bracing reduces launch forces and walking speed. Unbraced waves can throw sailors into the air and sea. Move to the same side as a swimmer and hold rescue. Solo sailors have an automatic lifeline. Emergency recovery consumes buoys, then hull.

Collect treasure for score, repair crates for hull, and snacks for temporary abilities:

- **Bubble Fruit:** protects against one fall.
- **Chili Noodles:** faster walking.
- **Anchor Biscuit:** resists knockback, with slower movement.

## Play together

1. Everyone opens the same deployed HTTPS game.
2. One player chooses **Create room** and shares the four-character code.
3. Up to three friends choose **Join room** and enter the code.
4. The captain launches. The same connected crew can rematch.

Room codes are case-insensitive letters/digits. New joins lock when the voyage begins. Keep the captain’s tab open and foregrounded for the most reliable simulation. Leaving the host ends the room. Guest disconnections remove their steering contribution. Automatic reconnection and host migration are not implemented.

The connection approach is adapted from your [multiplayerTest](https://github.com/refreshingday/multiplayerTest) project. **“No server” means no dedicated gameplay server:** public PeerJS signaling resolves rooms, STUN helps establish a direct WebRTC path, and the captain’s browser simulates the game. This build has no TURN relay, so some restricted network combinations cannot connect. See [networking details](docs/NETWORKING.md).

## Structure

- `src/game.js`: seeded authoritative simulation, independent of DOM and Three.js.
- `src/network.js`: four-character rooms, capacity, handshakes, input validation, snapshots, rematches.
- `src/renderer.js`: procedural 3D art and animation, created by **GPT-6 Astra** at the user’s request.
- `src/main.js`: menus, host simulation loop, guest interpolation, input, HUD, and synthesized audio.
- `src/style.css`: responsive interface and mobile control layout.
- `tests/`: gameplay and mocked network regression checks.

The first build includes one sea environment, seeded obstacle variations, a final lighthouse, solo and online multiplayer, wave bracing, rescue, repairs, treasure, three snacks, results, and rematch. The GDD’s cosmetic progression, daily challenges, additional biomes, public matchmaking, and extra boats remain future content.

## Validation

Automated tests cover seeded encounters, steering, braces, recovery, snacks, collision immunity, all crew sizes, 180-second completion, crew wipes, room capacity, join locking, sender identity, rematches, disconnects, and cleanup.

Mocked network tests do not prove carrier compatibility. Local real-browser tests and their exact scope are recorded in `docs/VALIDATION.md`. Physical phone performance and cross-carrier NAT behavior still need device testing before a production release.

No accounts, analytics, or purchases are required. Optional fonts load from Google Fonts; system fallbacks are provided. All 3D meshes and effects are generated locally in the browser.
