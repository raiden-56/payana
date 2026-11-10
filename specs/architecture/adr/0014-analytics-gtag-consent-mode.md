# ADR-0014 — Analytics via gtag with Consent Mode v2 and run-time configuration

*Status: accepted · 2026-11-10 · Source: owner direction of 2026-11-10; constitution §2.7*

## Context

The owner wants Google Analytics and Google Ads "settings" ready now and
will supply accounts later. The identifiers therefore cannot be compile-time
constants. Measurement and advertising cookies need consent; Google requires
Consent Mode v2 signals for advertising features; the constitution forbids
loading such tags before consent and forbids personal data in events.

## Decision

1. **Configuration is data.** `AnalyticsSettings` (GA4 measurement ID,
   Google Ads tag ID, per-`ConversionEvent` labels, optional AdSense
   publisher and slot IDs, `requireConsent`, `debugMode`) is stored in
   `platform_settings`, edited in Admin → Settings by `super_admin`, served
   publicly through `GET /public/config` (≤ 60 s cache), with a static
   fallback file in the web bundle. Every identifier ships **empty**.
2. **Empty means off**: no script, no globals, no cookies, no banner.
3. **Direct `gtag.js`**, not Google Tag Manager. One loader in
   `core/analytics` builds the script URL from a validated identifier and a
   fixed origin.
4. **Consent Mode v2**, defaults denied for `ad_storage`, `ad_user_data`,
   `ad_personalization`, `analytics_storage`. Stricter than Google requires:
   when `requireConsent` is true the script is **not requested at all** until
   the visitor grants a category.
5. **A typed analytics port.** Features call `analytics.track(event, params)`
   with event names and parameter shapes from one catalogue (F-14 §6). Only
   the gtag adapter knows about `gtag`. A no-op adapter serves tests and
   native shells.
6. **No PII by construction**: route-template page paths, an allow-list of
   query keys, parameter values limited to codes/booleans/buckets, no
   `user_id`, no enhanced conversions; a unit-tested scanner rejects
   phone/email/UUID/coordinate-shaped values.
7. **Conversions** map `ConversionEvent` → `send_to: <AW-ID>/<label>` only
   when the label exists and advertising consent is granted; value is
   platform revenue, never the fare.
8. **AdSense** is optional backfill behind local ads, loaded only with
   advertising consent and a configured slot.
9. Identifiers are validated on both sides with the patterns exported by
   `@payana/contracts`.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Environment variables baked at build time | The owner would need a rebuild and redeploy to "add the account later" |
| Google Tag Manager container | Lets anyone with GTM access inject arbitrary scripts outside code review and CSP intent; the owner asked for settings, not a tag platform |
| Consent Mode "advanced" (load tag, send cookieless pings before consent) | Contradicts constitution §2.7; simpler to explain and verify that nothing loads before consent |
| Server-side tagging / Measurement Protocol | More infrastructure; needs a client identifier design; unnecessary at launch |
| Privacy-first analytics (self-hosted) instead of GA4 | Worth considering later; the owner asked specifically for Google Analytics and Google Ads |
| A third-party consent-management platform | Another vendor script before consent; the two-category banner needed here is small |

## Consequences

- **Good**: the owner switches integrations on by pasting IDs; privacy
  posture is verifiable by a network-level test; no vendor code runs until
  wanted.
- **Cost**: visitors who decline are not measured at all (no modelled
  conversions); numbers in GA4 will undercount.
- **Constraint**: the CSP allow-list includes Google origins statically,
  because enabling must not require a deployment (NFR-SEC-005).
- **Limits**: anonymous consent is recorded only on the device (F-14 G-3);
  `ads.txt` for AdSense needs a small infrastructure addition (F-14 G-4).
- **Legal**: wording of the banner and the privacy notice needs review
  (D-03); `requireConsent` must stay on unless counsel advises otherwise.
