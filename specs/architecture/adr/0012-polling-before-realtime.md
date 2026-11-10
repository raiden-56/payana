# ADR-0012 — Polling before SSE or WebSocket

*Status: accepted · 2026-11-10 · Source: brief §5.A-8/11 (quotations, notifications), constitution §2.12*

## Context

Three things change while a user watches: quotes arriving on an open
request, the status of an active booking, and the notification count. The
access token lives in memory and is sent in the `Authorization` header
(ADR-0003); `EventSource` cannot set headers, and WebSockets need sticky or
shared connection state, a heartbeat strategy for mobile networks, and
reconnect logic. Users are on patchy 4G where long-lived connections drop.

## Decision

Use **conditional HTTP polling** at launch:

| Screen | Interval (visible) | Hidden / background | Stops when |
| --- | --- | --- | --- |
| Open ride request (customer) | 5 s | 30 s | request is no longer `open` |
| Active booking | 15 s | 60 s | booking leaves `ACTIVE_BOOKING_STATUSES` |
| Driver request inbox | 10 s while `available` | 60 s | driver goes `offline` |
| Notifications | 60 s | paused | signed out |

- Responses carry `ETag`; unchanged polls return `304` with no body.
- Failures back off exponentially (to 30 s / 300 s) and reset on success.
- Polling pauses when offline and fires once immediately on reconnect or
  when the tab becomes visible.
- Intervals are configuration, owned by the feature stores (one scheduler
  utility, unit-tested).

The server side is already event-driven (outbox), so adding a push transport
later is additive: an SSE or WebSocket gateway subscribes to the same events.

## Alternatives considered

| Alternative | Why not now |
| --- | --- |
| Server-Sent Events | Needs cookie or query-token auth (weakening ADR-0003) or a fetch-stream polyfill; proxies and mobile carriers time out idle streams; one more failure mode at launch |
| WebSocket | Connection state across API tasks (Redis pub/sub), auth handshake, heartbeats, ALB idle timeouts — real work for a latency gain of a few seconds |
| Web Push for updates | Not available/reliable enough on the launch platforms (ADR-0007) |
| Long polling | Most of the cost of SSE without the simplicity of plain polling |

## Consequences

- **Good**: trivial to operate and debug; survives flaky networks; stateless
  API; works through any proxy; cacheable.
- **Cost**: worst-case latency equals the interval (5 s for quotes); request
  volume grows with open screens — bounded by `304`s, visibility rules and
  back-off. At R1 load this is well inside NFR-PERF-001.
- **Limit**: nothing reaches a closed app (see ADR-0007).
- **Trigger to revisit**: polling exceeds ~30 % of API requests, or
  time-to-see-quote becomes a measured conversion problem. The planned
  successor is SSE for request/booking streams with a short-lived stream
  ticket obtained over the authenticated API.
