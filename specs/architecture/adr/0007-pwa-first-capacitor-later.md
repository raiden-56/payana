# ADR-0007 — PWA first; Capacitor later behind platform adapters

*Status: accepted · 2026-11-10 · Source: brief §4 Mobile strategy*

## Context

The brief requires that Android and iOS can be added "without rewriting the
domain logic", names Ionic with Capacitor "when justified", and warns that
"a PWA must not be represented as equivalent to a fully native application,
especially for background location and push-notification behavior".
Customers mostly arrive by link and should not need an app-store install to
book a ride. Drivers, however, benefit most from exactly the capabilities a
browser lacks.

## Decision

1. **Release 1 is a PWA**: installable, offline shell, foreground
   geolocation, polling.
2. **Every platform capability is a port** in `core/platform` with a web
   adapter now and a Capacitor adapter later: geolocation, storage, secure
   token store, network status, share, camera, push, deep links, analytics,
   clipboard, haptics (F-17 §3.2). Features and domain code depend on the
   ports only; a lint rule forbids direct use of browser globals elsewhere.
3. **Release 2 packages the same Angular build with Capacitor** for Android
   and iOS, supplying native adapters, body-transported refresh tokens in the
   secure store (ADR-0003), FCM/APNs push and app/universal links.
4. **Ionic's UI components are not adopted** (ADR-0008); Capacitor is used
   for packaging and plugins only.

### What the PWA cannot do — to be stated in the product, not hidden

| Capability | PWA reality | Product consequence |
| --- | --- | --- |
| Background location | Not available. Position updates stop when the tab is hidden or the phone locks | A driver's position goes `stale`; they are shown without distance and are not offered immediate requests (F-06, F-07). The partner dashboard says so plainly |
| Push when the app is closed | Web Push needs an installed PWA and explicit opt-in on iOS, is unreliable across Android vendors' battery savers, and is **not implemented at R1** | New requests reach a driver only while the app is open (polling). No copy promises alerts |
| Automatic OTP read | Only where WebOTP / `one-time-code` autofill is supported | Manual entry always works |
| Durable local storage | The browser may evict it | Nothing essential is stored only on the device |
| Camera / file access | Through the file input only | Adequate for document upload |
| App-store presence | None | Distribution by link and QR at stands and hotels |

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Native apps first (Kotlin/Swift or Flutter/React Native) | Second and third codebases; customers must install before a first ride; no reuse of the web client |
| Capacitor from day one | Store review, signing and release management before product–market fit; the adapters make this a later packaging step rather than a rewrite |
| Ionic Framework UI | Imposes its look and components; conflicts with the owner's design direction and bundle budgets |
| PWA only, permanently | Fails drivers: no background location, no reliable alerts |

## Consequences

- **Good**: fastest route to a usable product; one codebase; honest scope.
- **Cost**: driver experience is limited until R2; supply-side engagement
  metrics (G4) must be read with that in mind.
- **Risk**: adapter discipline erodes — mitigated by the lint rule and by
  keeping a no-op/native stub build in CI once Capacitor is added.
- **Decision point**: if pilot data shows drivers missing requests, bring
  the Android shell (push + background location) forward ahead of other R2
  items.
