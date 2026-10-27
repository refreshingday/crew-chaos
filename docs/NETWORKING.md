# Crew Chaos networking

The implementation follows the user's existing [multiplayerTest](https://github.com/refreshingday/multiplayerTest) project, specifically [room-v23.js](https://github.com/refreshingday/multiplayerTest/blob/main/room-v23.js), [network-v23.js](https://github.com/refreshingday/multiplayerTest/blob/main/network-v23.js), and [puff-river/room.js](https://github.com/refreshingday/multiplayerTest/blob/main/puff-river/room.js). Those files were inspected on 27 October 2026. Crew Chaos adapts the namespaced room-ID reservation, host-to-three-guests topology, host-owned outcomes, room capacity, and start locking. It uses PeerJS data channels directly instead of a second manual SDP pairing layer.

## What “without a server” means here

Crew Chaos is a static HTML/JavaScript game. It does not need an application backend or dedicated game server. One player's browser is the authoritative host. Three guests connect to that browser and send movement, brace, and interaction inputs. The host sends world snapshots; guests never submit ship positions, hull values, or game outcomes.

Four-character room codes are registered as PeerJS IDs under the `crew-chaos-web-v1-` namespace. [PeerJS Cloud](https://peerjs.com/server/getting-started) is the public signaling service that lets browsers find each other and exchange WebRTC connection information. Browsers also contact Google's public STUN servers to discover their public network routes. Internet access is needed for joining, even when players share Wi-Fi. These third-party services are outside the game's control.

Gameplay normally travels directly over encrypted WebRTC data channels. The default Crew Chaos configuration contains STUN only; it does **not** include the previous project's public demo TURN credentials. Consequently, some mobile carrier, enterprise, VPN, or symmetric-NAT network combinations may not connect directly. Try the same Wi-Fi network when a room is found but the game connection fails. There is no promise that all internet network combinations work without a relay.

If a deployment needs relay coverage, construct `CrewNetwork` with `iceServers` containing authorized STUN/TURN configuration. TURN forwards encrypted gameplay packets when a direct route is unavailable. Use a deployment's own short-lived credentials rather than hardcoding a paid secret into static source. A relay is network infrastructure, even though it does not simulate the game.

A completely infrastructure-free room lookup cannot be implemented with only four characters: peers need a shared rendezvous mechanism or a separate full offer/answer exchange. Manual SDP exchange is not part of this first Crew Chaos build.

## Session behavior

- Room codes contain four uppercase letters/digits. Generated codes avoid visually ambiguous characters; entered codes are case-insensitive.
- Room reservations retry collisions. Up to four sailors, including the host, can connect.
- The host locks the room when launching. New players require a new room; connected players can rematch on existing links.
- Sender identity comes from its established channel, never from guest-submitted IDs.
- Inputs are clamped and associated with a run and increasing sequence number. Delayed inputs and snapshots from previous runs are ignored.
- Handshake, room lookup, and heartbeat timeouts produce actionable errors.
- Leaving clears all owned timers, connections, and PeerJS registration.
- A guest disconnect removes that sailor from the host roster. The application updates its simulation crew accordingly.
- Host departure ends the room. There is no host migration or automatic reconnect in this first build.
- The host must keep the browser tab open and awake. Public signaling interruptions preserve existing gameplay links where WebRTC remains connected.

## Testing limits

Automated mocked tests exercise room joining, capacity, late-join rejection, identity, sanitized input, rematch epochs, disconnection, and cleanup. A live test on 27 October 2026 connected one host and three browser guests through public PeerJS signaling, launched all four into the same voyage, and observed matching score/countdown/overboard snapshots. A guest departure produced the expected host notification. These peers shared one computer/network. A real four-device test, including mixed PC/mobile and two different networks, is still required before claiming broad connectivity support.
