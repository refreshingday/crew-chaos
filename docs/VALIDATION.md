# Validation record

Build date: 27 October 2026.

## Automated checks

- `npm test`: 25 passing tests (16 gameplay, 9 mocked network).
- `npm run build`: successful static production build.
- An additional simulation review exercised 240 full voyages: 20 seeds × 1–4 players × three input strategies. Ordinary navigation toward clear lanes plus timely bracing finished 80/80 voyages; idle crews failed 80/80. These are simulated strategies, not human usability results.

## Browser checks

Observed in the Codex in-app Chromium browser:

- Desktop menu and live 3D scene render with the final water shader, ship, sailors, obstacles, and HUD.
- A real host reserved room `3KBM` through PeerJS Cloud. Three separate browser peers joined as First Mate, Lookout, and Bosun; all four appeared in the roster.
- The host launched the voyage. Host and guest displayed the same four sailors, countdown, score, and later the same four overboard states, verifying that authoritative snapshots reached the guests over live WebRTC data channels.
- A guest left during the voyage, returned to the menu, and the host received the disconnect notification. Automated tests cover simulation removal and subsequent input cleanup.
- Solo launch and in-game instructions were inspected.
- Fixed iframe viewports of 390×844 and 844×390 were inspected for menu fit, live gameplay, joystick, brace/rescue controls, HUD, and deck visibility. The landscape camera was enlarged after inspection; tutorial placement and portrait crew layout were adjusted to preserve visibility.
- The original development water shader compilation failure was repaired and the removed shadow constant replaced before the final build.

The real multiplayer test used separate browser peers on the same computer/network. It does not establish cross-carrier reachability or physical touchscreen behavior. Sustained four-device sessions and remote-input latency still need device coverage.

## Remaining device coverage

- Physical Android and iOS touch input, battery, and sustained frame time.
- Mixed phone/PC play across different carriers or restricted NATs.
- Long-running public signaling availability.

No broad hardware-performance or all-networks connectivity claim has been established.
