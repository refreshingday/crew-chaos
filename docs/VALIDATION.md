# Validation record

Build date: 28 October 2026.

## Automated checks

- `npm test`: 55 passing tests (38 gameplay, 17 networking/integration).
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

## Open-ocean update

- Regression tests cover unlimited lateral travel, route-relative spawning far beyond the former boundary, collision jumps for all deck sailors, finite-width wave collision/dodge behavior, wave movement and warning time, bow/stern speed trim, all eight scheduled speed increases, and twelve distinct functional add-ons.
- Networking integration advances the actual game through all pace tiers and victory, broadcasting 31 real snapshots to three connected mocked guests. Final-tier defeat is also covered. This caught and repaired rejection of the final tier’s `nextAt: null` value.
- Browser visual checks use development-only, click-driven fixtures that call the real simulation. A wreck collision produced 15 hull damage, an airborne sailor, visible impact particles/rings, and a large projected −15 number.
- An approaching finite breaker, sideways camera recentering beyond x=150, the full twelve-effect visual combination, and stern braking toward the 6.5 minimum were inspected. Bow acceleration was confirmed in the speed/trim HUD.
- The updated portrait layout was inspected at 390×844, with touch controls, speed/trim/pace display, and an approaching moving breaker. Header controls were moved to avoid the score panel.
- Astra’s partial art pass was completed with missing flash/ghost color constants, less obscuring hit feedback, and effect-material cleanup. Browser error logs were clear during collision and all-add-on checks.
- Live v2 room `FCQ8` connected a host and guest through public PeerJS signaling. Both displayed the same 2:14 countdown and 12.5 speed after launch; the guest’s error log was empty. This is a same-computer/network check, separate from the full-voyage mocked transport regression.
- Development fixture controls are excluded from the production JavaScript build.

## Solid islands, automatic boarding, and stylized sea — 28 October

- Gameplay regressions cover bow/rail island hits, elliptical corner misses, physical hull separation, one damage event per shore contact, renewed damage after separation, ghost passage, indestructible land, and route-relative island spawning.
- Swimming tests cover both rails, bow, stern and a curved hull corner. Approaching any hull edge starts a short automatic climb without input, buoy consumption or score changes; distant swimmers remain in the water. A late all-crew climb near the wipe timer is verified to complete without emergency penalties.
- Protocol 3 uses a new room namespace to isolate older renderers. A real simulation island collision and its climbing/aboard snapshots reach a mocked guest; invalid island dimensions are rejected.
- Local browser fixtures verified an island hit at 82% hull, an airborne sailor, shore impact particles and a large −18 damage label. Actual keyboard swimming returned the sailor from both rails, the bow and stern with the “climbed back aboard” event and both emergency buoys intact.
- The revised ocean was inspected in desktop gameplay and 390×844 / 844×390 touch layouts. The ship and crew stayed readable, with curved swells, darker troughs and broken crest foam. Astra’s numerical sweep of 26,250 poses found at least 0.572 units of deck-edge clearance from cosmetic swells on a level gameplay hull; it does not establish every combined collision/roll pose.
- Production-preview room `BWKN` connected a host and guest through public signaling. Both showed the same 2:52 countdown and 10.0 speed with the new ocean and authoritative islands; both browser error logs were empty. These peers shared one computer/network.
- The static production build excludes development fixture controls and inspection hooks. Physical phone performance remains unmeasured.

## Remaining device coverage

- Physical Android and iOS touch input, battery, and sustained frame time.
- Mixed phone/PC play across different carriers or restricted NATs.
- Long-running public signaling availability.

No broad hardware-performance or all-networks connectivity claim has been established.
