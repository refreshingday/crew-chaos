# Crew Chaos!
## Game Design Document — Version 0.1

**Design date:** 27 October 2026  
**Status:** Proposed design; all numerical values are prototype starting points, not validated balance.  
**Genre:** Fast cooperative 3D nautical party survival game  
**Players:** 1–4  
**Platforms:** Mobile first, with a fully playable PC version  
**Session:** 2–4 minutes of gameplay; default expedition target: 3 minutes  
**Presentation:** Colorful, readable, playful nautical slapstick

### Implementation update — 27 October 2026

The first playable implementation is a **3D HTML/WebGL browser game** in `crew-chaos-web/`, using Three.js and Vite. It supports mobile touch, PC keyboard, and controller input. GPT-6 Astra created the procedural 3D art and presentation at the user's request.

Online multiplayer uses four-character alphanumeric room codes and a host-authoritative WebRTC topology adapted from the user's GitHub `refreshingday/multiplayerTest` project. There is no dedicated gameplay server or application backend. Public PeerJS signaling and STUN establish connections; this build has no TURN relay, so restricted network combinations may fail to connect. Keep the host browser open.

Implemented: 1–4 players, 2/3/4-minute voyages, seeded obstacles, weight steering, wave launches, bracing, swimming, manual and solo rescue, emergency recovery, whales, wrecks, crates, treasure, repairs, three snacks, HUD, sound effects, results, and rematches. Later sections also describe future content beyond this first build; see the application README and validation record for the exact delivered scope.

### Shore and recovery revision — 28 October 2026

Visible tropical islands now have authoritative elliptical collision shapes. Shores stop and deflect the hull, deal 18 damage per contact, launch deck crew and remain visible afterward. Ghost Grape phases through them; Thunder Pop cannot destroy land. Swimmers can climb aboard automatically from any nearby hull edge, including the pointed bow and stern, without a button, buoy or score cost. Teammate lifelines and emergency recovery remain available for distant swimmers. These rules supersede the earlier rescue-point-only specifications below.

Astra’s revised sea uses stronger curved geometric swells, analytic surface normals, dark blue troughs, turquoise crests, broken white foam and view-dependent sun highlights. Ship heave and tilt follow that visible surface; cosmetic swells do not launch sailors. See [ocean rendering research](OCEAN_RENDERING.md) for the technical references.

## 1. High concept

**Playable revision:** Ship steering is now unlimited horizontally, with encounters generated around the moving route. Bow/stern crew placement controls forward speed (minimum 6.5, maximum 22 gameplay units), and the sea adds eight timed pace increases over the selected voyage. Big breakers move toward the boat in finite-width bands and can be steered around. Collisions launch the deck crew and show impact effects plus large damage numbers. Stronger ocean heave is cosmetic and moves the ship with its visible surface. The snack roster now has twelve effects: Bubble Fruit, Chili Noodles, Anchor Biscuit, Rubber Jelly, Magnet Mint, Ghost Grape, Balloon Berry, Disco Donut, Banana Boat, Thunder Pop, Giant Dumpling, and Octopus Candy. Earlier baseline specifications below are superseded where this revision differs.

Four tiny sailors. One very unstable boat. Nobody has a steering wheel.

Your boat automatically races through a hazardous sea. To steer, everyone moves their bodies around the deck: weight on the left turns left, weight on the right turns right. Waves launch sailors into the air, floating crates clutter the route, whales surface beneath you, and wrecks create narrow passages. Grab snacks for temporary abilities, brace for impacts, and throw lifelines to friends who fall overboard.

Reach the rescue harbor before your boat breaks apart. Win together, laugh at the mistakes, and immediately try another route.

**Player promise:** “We almost made it, then everyone ran to save one person and steered straight into a whale.”

## 2. Design pillars

1. **The crew is the steering system.** Player positions must visibly explain the boat’s movement. Coordination is the main skill.
2. **Chaos creates recoverable stories.** Falling overboard creates a rescue opportunity rather than immediate elimination.
3. **Urgency without control overload.** Move, brace, and interact are enough for the core game.
4. **Every short run has an arc.** Start quickly, escalate, deliver a memorable finale, and offer an immediate rematch.
5. **Readable on a phone.** Big silhouettes, clear warnings, short text, and generous interaction targets take priority over visual realism.

## 3. Audience and intended experience

Designed for friends, families, and casual cooperative players who enjoy physical comedy, shared responsibility, and short sessions. A new player should understand steering within 15 seconds and contribute before mastering the game.

Desired emotional sequence:

**Confidence → surprise → scramble → heroic rescue → celebration → “again!”**

Players cooperate against the sea. Personal statistics celebrate contributions without ranking teammates from best to worst.

## 4. Scope and assumptions

This document specifies the game rather than implementing a playable build.

The intended multiplayer experience is online cooperative play, with each player using their own mobile device or PC. Private room codes are the initial multiplayer entry point. Cross-device play is a target. Public matchmaking is a later feature after connection quality and onboarding are proven.

Solo play is a complete supported mode, using the same movement and steering system with adjusted rescue and encounter rules. Split-screen and multiple players sharing one phone are outside the initial scope.

The baseline camera is a shared, elevated third-person view centered on the ship, looking ahead along the route. Players control a sailor, never the ship directly.

## 5. Core loop and victory conditions

### Moment-to-moment loop

1. Read the next obstacle or wave warning.
2. Move across the deck to steer toward a safe opening or reward.
3. Brace when a wave or collision arrives.
4. Recover position, clear a deck hazard, or rescue a swimmer.
5. Collect supplies and prepare for the next encounter.

### Run loop

Choose a route and sailor → board the boat → survive a short sequence of encounters → complete the final escape → receive team results and cosmetic progress → rematch or choose another route.

### Win

Reach the finish line with hull integrity above zero and at least one active sailor. If anyone is overboard when the boat finishes, a brief automatic arrival rescue returns them for the team celebration. No teammate loses rewards because they were in the water at the finish.

### Lose

- Hull integrity reaches zero.
- The entire crew is incapacitated and no emergency recovery remains.

The boat’s forward progress cannot be permanently stopped. Contact with scenery causes damage, a short slowdown, and a push back into navigable water. Collisions must never create indefinite softlocks.

### Time budget

Standard gameplay lasts approximately 180 seconds, excluding lobby and results. Short routes target 120 seconds; long routes target 240 seconds. Forced movement and bounded slowdown budgets keep expeditions close to their advertised duration.

## 6. The ship as a controller

### Deck layout

The starting boat is a wide, compact tug-style vessel with a clear open deck, a central mast, perimeter rail segments, and rescue points on both sides. Decorative objects must not obscure movement space.

- **Port and starboard edges:** Strongest steering influence.
- **Center deck:** Minimal steering; safest repositioning area.
- **Bow:** Risky lookout position near approaching pickups.
- **Stern:** Access to the emergency recovery station.

The bow and stern do not introduce a second control axis in the initial version. Forward and backward player movement primarily changes safety and access to interactions. Fore-aft trim can be tested later only if the basic steering remains readable.

### Steering model

The ship constantly moves forward along a route. Crew weight controls lateral steering within that route.

For each conscious sailor on deck, measure their local horizontal position relative to the ship center, normalized from −1 at the left edge to +1 at the right edge.

**Steering input = sum of sailor contributions / current run crew count.**

Crew count includes temporarily overboard or incapacitated players, so losing a sailor reduces steering strength. A departure confirmed by the session system updates that count smoothly rather than instantly snapping the ship’s handling.

Example: With four players, two at the left edge and two at the right edge cancel out. All four on the left produce full left steering. One on the left and three in the middle produce a gentle left turn.

Convert steering input into a target lateral velocity with acceleration smoothing. Ship yaw and roll visually follow the turn, while the underlying navigation remains constrained to a forward corridor. Avoid unrestricted rigid-body boat simulation: predictable steering is essential to fair mobile play and networking.

Prototype targets:

| Parameter | Initial target |
|---|---|
| Deck footprint | Approximately 8 × 5 gameplay meters |
| Sailor deck crossing time | 1.0–1.4 seconds from center to edge |
| Steering response | Visible response within 0.15 seconds |
| Strong course change | Approximately 1.0–1.5 seconds |
| Normal forward speed | Approximately 10–14 gameplay meters/second |
| Steering dead zone | Inner 10% of deck width |

These units are tuning aids. Screen readability and reaction time determine the final scale.

### Steering feedback

- Boat visibly leans toward the heavier side.
- A small balance indicator shows the current weight bias.
- Wake and bow direction communicate motion.
- A subtle curved guide previews near-term movement during onboarding and optional assist mode.
- Camera shake never hides the next decision.

Players cannot push each other off through ordinary contact. Character collisions use soft separation; wave forces and hazards provide the disruptive physics. This limits griefing and accidental blockage on small screens.

## 7. Controls

| Action | Mobile landscape | PC keyboard/mouse | Controller |
|---|---|---|---|
| Move | Left virtual joystick | WASD or arrow keys | Left stick |
| Brace | Hold large right button | Hold Space | Hold right trigger |
| Interact / rescue / use pickup | Contextual right button | E | South face button |
| Ping | Small dedicated button | Q | North face button |
| Pause / options | Top-corner menu | Escape | Menu button |

Movement is screen-relative in the projected deck plane. Keep the camera orientation stable enough that “left” continues to mean the visible left side of the boat.

No free jump button is required in the baseline game. Waves generate airborne moments. During flight, movement input provides limited air control so a skilled player can land back on deck.

### Brace

Hold to crouch, grip the deck, and resist knockback.

- Reduces launch force by approximately 70%.
- Reduces movement speed by approximately 65%.
- Maintains normal steering weight.
- Prevents interacting while held.
- Has no stamina meter in the initial version.

The cost of bracing is lost mobility and lost access to rescues or supplies. Holding it forever should make navigation difficult, but never require rapid tapping to counteract it.

### Context action priority

When several interactions overlap: rescue an endangered teammate, catch an airborne teammate, repair, collect/use a pickup. Show the selected action as an icon above the button and highlight the target in the world. Require facing or proximity confirmation to prevent unwanted item use.

## 8. Waves and airborne comedy

Waves are gameplay encounters with readable warning stages, rather than random unavoidable impulses.

1. **Warning:** A visible sea ridge, direction arrow, and distinctive sound announce the wave.
2. **Approach:** A moving foam line communicates the exact arrival moment.
3. **Impact:** Unbraced players are launched according to the wave direction.
4. **Recovery:** A short calmer window allows landing, rescue, and repositioning.

Normal difficulty provides roughly 1.5–2.5 seconds of actionable warning. Introduce each wave type alone before combining it with obstacles.

| Wave | Behavior | Player response |
|---|---|---|
| Bow breaker | Hits from the front, launches backward | Brace or move toward the bow before impact |
| Side slap | Pushes sailors toward one rail | Move inward, brace, then correct course |
| Double roller | Two moderate impacts with a readable gap | Resist the urge to leave cover too early |
| Whale wake | Curved wave following a visible whale | Read the wake direction while choosing a route |
| Launch swell | Gentle, deliberate launch near elevated rewards | Optional advanced risk/reward encounter |

Air control is limited to a small correction, not free flight. Landing on deck causes a brief stumble but no routine damage. Rail grabs provide a short last-chance recovery state before a sailor falls into the sea.

## 9. Overboard and rescue

Falling into the sea should produce approximately 5–12 seconds of tension, with the swimmer still able to contribute.

### Player states

**On deck → airborne → rail grab or swimming → tethered → climbing aboard → on deck.**

If the swimming timer expires: **swimming → exhausted → emergency recovery or team defeat.**

### Swimming

- A forgiving trailing rescue zone keeps the swimmer near the moving boat.
- The swimmer steers within that zone and aims for a highlighted rescue side.
- An 8-second safety timer is shown around their portrait.
- The swimmer can ping the closest rescue point.
- The camera expands slightly; beyond that limit, an edge indicator replaces excessive zoom-out.

This is an arcade rescue system: the boat continues forward, but the swimmer is not abandoned kilometers behind it.

### Manual rescue

A sailor approaches the matching side rail and presses Interact to throw an automatically aimed lifeline. Once connected, hold Interact for roughly 1.5 seconds to pull the swimmer aboard. The rescuer remains in position and therefore affects steering throughout.

- Rescue range covers the normal trailing zone.
- Each rescuer can retrieve one swimmer at a time.
- A connected rope pauses the swimmer’s safety timer.
- Releasing the button preserves partial progress briefly, then progress decays.
- If interrupted by a wave, the rope remains attached for a short grace period.
- Successful boarding grants 1 second of knockback protection.

The interesting choice is where and when to rescue, not precision aiming at a small mobile target.

### Emergency recovery

The ship starts with a shared emergency buoy. It automatically retrieves exhausted sailors, consuming one charge per activation and applying a modest team score penalty. If several sailors are exhausted together, one activation retrieves that group.

After charges are spent, an exhausted player returns after a short delay at a hull cost, provided another sailor remains active. Cap continuous helpless time at approximately 5 seconds. If everyone is incapacitated with no buoy charge, the run ends after a clearly shown grace window.

### Solo adaptation

- Automatic lifeline replaces teammate rescue.
- After falling overboard, the player has a short chance to swim into the retrieval zone; recovery then takes approximately 2 seconds.
- The ship temporarily centers its steering while the player is swimming.
- Failed self-recovery consumes a buoy charge, then hull integrity on subsequent failures.
- Solo defeat occurs when hull reaches zero; repeated falls are costly without making the first fall an instant loss.
- Encounters never require simultaneous interaction at two stations.

### All-crew airborne rule

Airborne players do not count as incapacitated for defeat. Allow the complete landing and rail-grab window before evaluating a crew wipe.

## 10. Obstacles and sea life

Every obstacle should offer a readable decision and a distinct silhouette.

| Encounter | Behavior | Decision / reward |
|---|---|---|
| Floating boxes | Small clusters; light damage on collision | Safer outer route versus supplies in the middle |
| Large cargo crate | Stronger collision; breaks into harmless fragments | Coordinate a larger turn early |
| Shipwreck | Static hull with a generous opening or outside passage | Take the narrow route for a score bonus |
| Drifting wreck section | Slowly rotates with a clearly visible path | Anticipate where the opening will be |
| Big whale | Shadow and bubbles precede surfacing | Avoid the body or ride its wake for a boost |
| Whale blowhole | Timed water jet launches sailors | Brace, avoid, or intentionally collect an aerial reward |
| Reef teeth | Edge hazards that punish excessive steering | Return toward center before the next wave |
| Kelp patch | Brief drag and slippery deck effect | Take a shortcut at the cost of handling |
| Whirlpool | Predictable sideways pull, never a guaranteed trap | Counter-steer together or skirt the edge |
| Supply raft | Harmless collection opportunity | Approach for repairs or a snack |

Whales are playful environmental characters, not enemies to kill. Their warning silhouettes must distinguish them from ordinary scenery.

### Collision model

Starting hull: 100 integrity.

- Small box: approximately 5 damage.
- Reef scrape: approximately 8 damage with a cooldown preventing repeated frame-by-frame damage.
- Heavy wreck impact: approximately 15–20 damage.
- Whale body contact: approximately 10 damage plus strong deck disruption.

After a damaging collision, grant a short contact immunity window and push the boat away from the obstacle. One navigational mistake must not instantly drain the full hull.

## 11. Snacks, supplies, and “eat add-ons”

Floating food and supply pickups reward optional detours. Nearby supplies automatically magnetize toward the deck once the ship passes close enough; players do not need to jump into the sea to collect them.

Each sailor can hold one snack. Interact consumes it when no higher-priority nearby action is selected. Show its icon and remaining duration near that player’s marker. Snacks expire after the run and cannot be purchased for competitive advantage.

| Snack | Effect | Tradeoff / purpose |
|---|---|---|
| Anchor Biscuit | Strong knockback resistance for 8 seconds | Slower walking; useful before large waves |
| Chili Noodles | Faster movement for 8 seconds | Easier to overshoot position; skilled repositioning |
| Bubble Fruit | Prevents the next fall into the sea by bouncing the player toward the deck | Single-use safety tool |
| Rubber Jelly | Stronger air control and softer landing for 8 seconds | Useful for optional aerial rewards |
| Hero Sandwich | Next manual rescue completes faster and repairs a little hull | Encourages a timely rescue role |

Do not change steering weight through snacks in the initial release: an unexplained change to one sailor’s influence makes cooperation harder to read. A visibly oversized “Heavy Dumpling” can be a later special-mode experiment.

Ship supplies:

- **Repair bundle:** Stored centrally; hold Interact for 2 seconds to restore 15 hull. One stored bundle maximum.
- **Emergency buoy:** Restores one recovery charge up to a small cap.
- **Treasure barrel:** Adds team score; never needed to finish.

For the first prototype, implement only Bubble Fruit and repair bundles.

## 12. Signature creative encounters

### The whale shortcut

A whale surfaces beside two routes. The safe route curves around it. The risky route passes behind its tail and catches a temporary wake boost. The boost grants score and excitement without extending the run or creating an unavoidable next collision.

### Catch your captain

An airborne teammate has a visible landing marker. Another sailor standing near it can press Interact to catch them, canceling their slide and granting a team style bonus. Catching is optional and uses generous timing.

### The cargo shuffle

A soft cargo sack lands on deck and slides slowly toward the low side. It obstructs a small area but does not contribute hidden steering weight. Move around it or use Interact to toss it overboard. Cargo encounters never obstruct every route to a rescue rail.

### The last lighthouse

The finale reveals a lighthouse and three successive gates through wreckage. Between gates, waves force the crew back toward the middle. The final safe passage is wide enough for a damaged, undermanned crew to succeed.

### The suspicious snack

A rare clearly marked mystery snack rolls one of a small set of beneficial effects, with a comedic animation. Use only in casual routes; omit from standardized challenge runs to preserve comparability.

### Future event: Octopus inspector

A friendly octopus briefly places a tentacle on one side of the boat. A large weight indicator shows its influence; the crew counterbalances it or interacts to tickle it away. This is an expansion encounter after steering readability is proven.

## 13. Three-minute pacing plan

| Time | Beat | Design intention |
|---|---|---|
| 0–15 seconds | Leave dock; wide supply gates | Learn movement and weight steering immediately |
| 15–40 seconds | Boxes and one gentle wave | Introduce brace and recovery |
| 40–70 seconds | First wreck passage and snack | Create the first meaningful route choice |
| 70–95 seconds | Whale event | Deliver a memorable spectacle |
| 95–110 seconds | Calmer supply stretch | Repair, recover, and reset tension |
| 110–145 seconds | Mixed waves and obstacles | Test cooperation with established mechanics |
| 145–175 seconds | Lighthouse finale | Clear escalation with three short challenges |
| 175–180 seconds | Finish crossing | Immediate shared celebration |

This is a pacing template, not an identical script for every run. A seeded director selects authored encounter chunks while preserving this intensity curve.

Avoid sustained maximum intensity. Alternate approximately 8–15 seconds of challenge with short recovery windows. A rescue already in progress can delay an optional wave, but must not freeze all threats or make going overboard exploitable.

## 14. Player-count scaling

| Players | Handling and encounters | Rescue support |
|---|---|---|
| 1 | Full steering authority; wider gaps; fewer combined threats | Automatic lifeline and hull-based recovery |
| 2 | Each player contributes half of full input; moderate combinations | Longer initial swim timer and generous rope range |
| 3 | More concurrent navigation and recovery decisions | Standard recovery rules |
| 4 | Full encounter variety and optional cooperative bonuses | Standard recovery rules; hazards account for crowded deck |

Scale complexity and overlap more than raw speed or hull damage. Four-player runs should be more social and demanding, not simply more lethal.

If the active deck crew shrinks, temporarily cap the strength of required turns so the remaining players retain a viable path. This assistance must preserve the visible relationship between weight and steering rather than secretly multiplying one player’s weight.

No mandatory classes. Players naturally switch between navigator, lookout, rescuer, and repair helper as their positions change.

## 15. Replayability

### Authored chunks with seeded variation

Build encounters as short reusable chunks with entry lanes, exit lanes, timing, difficulty, minimum player requirements, pickup locations, and recovery windows. Seeded selection varies order, mirroring, safe lanes, wave direction, and rewards.

Generation constraints:

- At least one reachable safe corridor through each sequence.
- Minimum warning distance based on current speed and crossing time.
- No blind wave immediately after a heavy collision.
- No required two-person task in solo mode.
- No consecutive maximum-intensity chunks without recovery.
- No randomized obstacle overlapping a rescue boarding position.
- Validate combinations using the boat’s actual maximum lateral acceleration, not just visually open space.

### Route identities

1. **Sunny Salvage:** Boxes, gentle waves, broad wreck passages; introductory route.
2. **Whale Highway:** Migrating whales, wake shortcuts, blowhole launches.
3. **Wreck Rush:** Broken ships, rotating debris, tighter navigation.
4. **Storm Sprint:** Stronger wave combinations and lightning spectacle; keep visibility high.

### Modes

- **Quick Voyage:** Default 3-minute cooperative run.
- **Daily Tide:** Shared seed and fixed settings, with separate results by player count and assist category.
- **Party Remix:** One clearly described modifier per run: bouncy sailors, slippery deck, giant supply crates, or rescue-focused bonus scoring.
- **Expert Voyage:** Harder authored combinations and fewer recovery resources; unlock after learning the normal game.

Launch with Quick Voyage. Add other modes only after the core loop earns repeat play in testing.

### Progression

Unlock sailor outfits, hats, boat paint, flags, wake colors, and emotes. Long-term unlocks do not increase steering power, health, or snack strength.

Track mastery accomplishments such as finishing without losing a sailor, rescuing every teammate, surviving on low hull, and taking all optional whale shortcuts. Avoid mandatory daily streaks or penalties for missing days.

Different boat hulls are a later feature. If added, use explicit sidegrades with separate challenge categories rather than permanent stat upgrades.

## 16. Scoring and results

The entire crew shares one score.

Initial scoring model:

- Finish: 1,000 points.
- Remaining hull: 5 points per integrity.
- Treasure: 50 points per barrel.
- Authored risk gate: 100 points, once per gate.
- Rescue: 50 points for each hazard incident, with a limited run-wide reward cap.
- Catch: 25 style points, subject to the same incident protection.
- Emergency recovery: −100 points per activation; total score cannot go below zero.

Do not award repeat rescue points for intentional re-entry into the sea. Associate rescue rewards with eligible hazard events and cap rewards so farming cannot outperform successful navigation.

Results display team medal, completion, hull, treasure, rescues, and one short memorable event. Personal titles are positive and can be shared: “Lifeline Legend,” “Perfect Brace,” “Treasure Spotter.” Never use “worst teammate” awards.

Keep results skippable and provide a prominent ready/rematch button. Target under 15 seconds from result screen to starting another run with an existing group.

## 17. Onboarding and accessibility

The first voyage embeds a short tutorial in gameplay:

1. Supply marker left: “Move left to steer.”
2. Supply marker right: “Crew weight turns the boat.”
3. Gentle wave: “Hold Brace!”
4. Practice dummy overboard: “Go to the rail and rescue.”

Use short prompts and animated icons. Experienced players can skip the tutorial; new players can replay it independently.

Accessibility options:

- Adjustable joystick position, size, and sensitivity.
- Remappable PC/controller inputs.
- Hold/toggle brace and reduced-hold rescue option.
- Reduced camera shake and motion effects.
- Distinct patterns and icons in addition to player colors.
- Wave direction represented visually and audibly.
- Large UI and safe-area support for phone cutouts.
- Assist mode with longer warnings and slower hazard combinations.
- No required voice chat, rapid tapping, or precision aiming.

Pings provide “Left,” “Right,” “Help,” and “Brace” through a compact wheel. A simple tap issues the most relevant contextual ping. Add a short cooldown to prevent spam.

## 18. Visual, camera, and audio direction

### Visual style

Stylized 3D with chunky sailors, exaggerated silhouettes, bright hull colors, and simplified water. The ship and characters have stronger contrast than the surrounding sea. The sea can feel energetic without being visually noisy.

Character identities must remain readable when hats or costumes change. Always pair player color with a distinctive symbol above the head.

### Camera

- Elevated perspective, slightly behind the ship.
- Enough forward view to show the longest required reaction window.
- Small lateral follow and restrained banking.
- Limited zoom-out during rescues, with screen-edge indicators beyond that range.
- No cinematic cuts during active input.
- Tall effects and wreck walls fade when obscuring the deck.

### HUD

- Top center: route progress and time remaining.
- Top left: hull and recovery charges.
- Compact crew portraits: state, held snack, swim timer.
- Near ship: small balance indicator.
- Bottom left/right: mobile movement and action controls.

Avoid stacking multiple meters over each sailor. The world should carry most warnings through wave lines, shadows, and highlighted rescue points.

### Audio

Use distinct warning sounds for wave direction, whale emergence, low hull, and overboard status. Comedic vocal reactions are brief and rate-limited. Music builds toward the finale and eases during supply stretches. Critical cues must remain understandable with music muted, and all critical information must also be visible.

## 19. Multiplayer and technical design

These are implementation requirements, not a final engine selection. Select an engine and networking stack after a small mobile performance and connectivity spike.

### Simulation

- Authoritative simulation decides ship movement, damage, pickups, launches, and rescue completion.
- Ship navigation uses a controlled forward path and lateral movement.
- Sailors move in ship-local coordinates while grounded.
- Airborne and swimming states use bounded, explicit gameplay movement.
- Cosmetic ragdolls and debris do not determine authoritative gameplay outcomes.

### Networking

- Initial private-room prototype may use a host-authoritative session with relay connectivity.
- Predict local sailor movement; interpolate remote sailors.
- Synchronize ship state, player states, encounter seed, event times, and authoritative results.
- Use timestamped inputs and generous rescue interaction windows to handle latency.
- Test warning readability, brace timing, and correction artifacts at simulated 80–150 ms latency with jitter and packet loss.
- Do not promise host migration in the first multiplayer prototype. If the host leaves, show a clear session-ended result and a quick path to form a new room.

### Disconnect and reconnect

A disconnected sailor briefly auto-braces near the center. Remove their contribution after a short grace period and smoothly update player-count scaling. Keep their slot available for reconnect where the session backend supports it. Initial matches lock the roster at launch; joining a new slot mid-run is out of scope.

Mobile backgrounding is treated as a connection interruption. Online pause opens an options overlay while the match continues with a visible warning; solo pause stops simulation.

### Performance targets

- Stable 30 FPS baseline on the selected representative lower-tier test phone.
- Optional 60 FPS on stronger mobile devices and PC.
- Identify actual test devices before claiming hardware support.
- Profile water, transparency, shadows, character animation, and network corrections early.
- Pool encounter objects and effects; cap simultaneous debris and splashes.
- Offer reduced effects without removing gameplay warnings.

## 20. Content and production scope

### First playable prototype

Purpose: prove that weight steering, waves, and rescue are fun.

- One boat and one graybox ocean route.
- One playable sailor with four color variants.
- Mobile touch and PC keyboard controls.
- 1–4 player handling model, beginning with solo and local simulated inputs for iteration.
- One wave type, boxes, one wreck passage.
- Brace, launch, swim, rescue, solo recovery.
- Hull, finish, defeat, instant restart.

### Vertical slice

Purpose: prove the full intended experience on actual mobile devices and a small online group.

- Private online sessions for 1–4 players.
- A complete 3-minute Sunny Salvage run.
- One whale encounter and two wave types.
- Bubble Fruit, repairs, emergency buoy.
- Onboarding, full HUD, results, rematch.
- Initial stylized art, audio, and device performance pass.

### Initial release target

- Three route identities using approximately 24–30 authored encounter chunks.
- Five snack types after usability validation.
- Small cosmetic unlock collection.
- Seeded Quick Voyage generation.
- Reliable private cross-device sessions and reconnect behavior.
- Accessibility settings and a tuned solo experience.

### After launch / stretch scope

Daily Tide, public matchmaking, Party Remix, Storm Sprint, additional boat sidegrades, octopus encounters, spectator tools, and optional local PC multiplayer.

Do not include crafting, an open-world ocean, combat weapons, complex inventory, realistic sailing, or long-form survival systems in the initial game. They would compete with the short cooperative loop.

## 21. Playtest plan and acceptance criteria

The following are hypotheses to test, not existing results.

| Question | Test / initial success criterion |
|---|---|
| Is steering understandable? | At least 80% of new testers explain weight steering after one short tutorial |
| Is control responsive? | Testers can intentionally pass left and right gates without repeated overshoot |
| Is bracing a choice? | Players reposition between waves; permanent bracing is not the dominant successful strategy |
| Are falls recoverable? | Most first-session overboard incidents offer a visible, actionable rescue opportunity |
| Is solo complete? | Testers can finish alone and identify how to recover after falling |
| Does coordination matter? | A communicating group improves navigation without needing voice chat to play at all |
| Is the run length right? | Normal completed runs stay inside the advertised 2–4 minute range |
| Is replay attractive? | Most test groups voluntarily choose at least one rematch |
| Is failure fair? | Testers can identify the cause of a fall or major collision from the warning and outcome |
| Does mobile hold up? | Stable baseline frame rate and usable controls on the selected test devices |

Test solo, two-player, and four-player groups separately. Include touchscreen-only players, mixed PC/mobile groups, and users who have never seen the game.

Track encounter seed, crew count, falls, rescue attempts/completions, collision damage, brace usage, completion time, frame-time spikes, and network correction frequency. Use findings to tune the specific failure points rather than simply lowering all difficulty.

## 22. Key risks and responses

| Risk | Response |
|---|---|
| Steering feels delayed or random | Simplify boat simulation, strengthen weight feedback, tune acceleration before adding content |
| Players spend too long swimming | Generous lifelines, short recovery states, limited camera expansion, emergency retrieval |
| Solo feels like an incomplete multiplayer game | Automatic rescue and solo-valid encounter selection from the first prototype |
| Four players cancel each other constantly | Clear balance meter, ping tools, wide introductory gates, stable movement orientation |
| Constant bracing solves everything | Require timely lateral repositioning; prevent interaction while braced |
| Chaos becomes unreadable on mobile | Cap overlapping effects, preserve warning contrast, limit simultaneous threat types |
| One player intentionally ruins a run | Soft player collision, private rooms first, recovery systems, no shove action |
| Generated routes are impossible | Authored chunks, acceleration-aware compatibility rules, seeded validation and playtesting |
| Multiplayer physics feels inconsistent | Authoritative event logic, bounded character states, cosmetic-only ragdolls |
| A short game lacks lasting appeal | Meaningfully different routes, mastery, seeded variations, social moments, cosmetic rewards |

## 23. Example run

Four sailors leave the harbor. Two run left for a supply raft while the others stay center, making a gentle turn. A bow wave appears. Three brace; the fourth races toward Bubble Fruit and gets launched backward.

The airborne sailor catches the rail. A teammate moves to help, shifting the boat right toward a wreck. Someone pings left; the other two counterbalance while the rescue finishes.

A whale shadow appears ahead. The crew chooses the risky wake route, earns a boost, and nearly misses a repair raft. One sailor grabs a repair bundle during the calmer stretch while the others line up the next gap.

At the lighthouse, a double roller throws two sailors overboard. One remaining sailor holds course from the left rail while the other pulls in a swimmer on the right. The returned sailor immediately helps rescue the last teammate. The boat reaches harbor with 18 hull, everyone aboard, and a shared medal.

The results callout reads: **“Two rescues. One sinking boat. Zero sailors left behind.”**

## 24. Recommended implementation order

1. Prove deck movement and weight steering on phone and PC.
2. Add one readable wave, brace, airborne movement, and rail recovery.
3. Complete multiplayer rescue and solo self-recovery rules.
4. Build a fixed 3-minute graybox route with win, lose, and rematch.
5. Validate the control model in a small online session before producing substantial content.
6. Add the whale, pickups, and final escape sequence.
7. Playtest all crew sizes and tune warnings, steering, and rescue windows.
8. Expand into seeded authored chunks, then cosmetics and additional modes.

**Core production gate:** If steering, one wave, and rescuing a friend are not enjoyable in a graybox boat, improve those mechanics before adding more systems.
