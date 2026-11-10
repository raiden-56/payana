# F-12 — Local business advertisements

| | |
| --- | --- |
| Requirements | FR-ADS-001 … FR-ADS-007 |
| Priority / release | P1 · R1 |
| Contract | `commerce.ts` (`AdPlacement`, `AdCreative`, `AdCampaign`, `AdCampaignInput`, `AdCampaignStatus`); `ApiRoutes.ads.*`, `ApiRoutes.admin.{adCampaigns, adCampaign}` |
| API module | `apps/api/src/modules/commerce` |
| Web | `ui` (ad slot component), placements in `features/home`, `explore`, `booking`, `packages`; admin in `features/admin` |
| Flag | `FeatureFlag.LocalAds` |

## 1. Business objective and scope

Cafés, homestays, surf schools and scooter rentals want the same visitors
Payana serves. The platform sells them a small number of clearly labelled
placements — its own inventory, sold and invoiced offline at R1.

**In scope** — serving creatives per placement and region; weighted rotation;
impression and click recording; campaign management and lifecycle;
reporting; the feature flag; fallback to AdSense (rules only — mechanics in
F-14).
**Out of scope** — self-service advertiser accounts, online ad payments,
targeting by user, frequency capping per user, third-party ad tags in
creatives.

## 2. User stories and acceptance criteria

- **US-01** As a visitor I can tell an ad from content at a glance.
- **US-02** As marketing I schedule a campaign for a business for two weeks
  in Gokarna on the home strip.
- **US-03** As marketing I report impressions and clicks to the advertiser.
- **US-04** As the owner I can switch all ads off instantly.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F12-01 | a `running` campaign for placement `home_strip` in Gokarna | `GET /ads?placement=home_strip&regionSlug=gokarna` | `200 AdCreative[]` containing it, with `id` = campaign ID, `advertiserName`, `title`, `body`, `imageUrl`, `ctaLabel`, `ctaUrl`, `placement` |
| AC-F12-02 | campaigns that are `draft`, `paused`, `scheduled` (future) or `ended`, or target other regions or placements | the same request | none of them is returned; a campaign with empty `regionSlugs` is returned for every region |
| AC-F12-03 | `FeatureFlag.LocalAds` off | `GET /ads…`, impression, click | `[]`; impression/click → `204` without recording; the web client renders no ad container and reserves no space |
| AC-F12-04 | two running campaigns in one placement with weights 3 and 1 | 4 000 requests | the first position goes to the heavier campaign in ≈ 75 % of responses (± 5 pp); the response holds at most 3 ◊ creatives |
| AC-F12-05 | a creative rendered and ≥ 50 % visible for ≥ 1 s | the client posts `/ads/{id}/impression` | `204`; the campaign's `stats.impressions` increases by 1; at most one impression per creative per page view is sent |
| AC-F12-06 | a visitor activates the call to action | the client posts `/ads/{id}/click` then follows `ctaUrl` | `204`; `stats.clicks` increases by 1; navigation is not blocked if the post fails (`keepalive` / `sendBeacon`) |
| AC-F12-07 | more than 60 ◊ impression/click posts per minute from one address, or a post for a campaign that is not running | post | `429 rate_limited` / `204` without counting (unknown ID → `404`) |
| AC-F12-08 | an ad on screen | it is inspected | it carries a visible "Sponsored" label, the advertiser's name, and `rel="sponsored noopener"` on an external link opening in a new tab |
| AC-F12-09 | an admin with `ads.manage` | `POST /admin/ad-campaigns` with a valid `AdCampaignInput` (`status: "scheduled"`) | `201 AdCampaign` with zeroed `stats`; audit `ad_campaign.created` |
| AC-F12-10 | a `scheduled` campaign whose `startsOn` arrives; a `running` one whose `endsOn` passes | the campaign-status job runs (and on read) | `scheduled` → `running`; `running` → `ended`; an `ended` campaign cannot be edited back to running except by changing dates to the future (it becomes `scheduled`) |
| AC-F12-11 | a running campaign | admin sets `status: "paused"` via `PUT` | it stops serving within the cache window (≤ 60 s); setting `scheduled` resumes it (it becomes `running` if inside its dates) |
| AC-F12-12 | `endsOn < startsOn`, a `ctaUrl` that is not `https:` or `tel:`, weight outside 1–10, or empty `placements` | create / update | `400 validation_failed` |
| AC-F12-13 | an admin with `ads.manage` | `GET /admin/ad-campaigns` | every campaign with `stats.impressions` and `stats.clicks` |
| AC-F12-14 | an admin without `ads.manage` | any `/admin/ad-campaigns*` route | `403 forbidden` |
| AC-F12-15 | no eligible local campaign for a placement, AdSense publisher and that placement's slot configured, advertising consent granted | the slot renders | the AdSense unit is shown (F-14); with any of those conditions false the slot renders nothing |

## 3. Preconditions, postconditions and business rules

| # | Rule |
| --- | --- |
| BR-01 | Placements are the four `AdPlacement` values: `home_strip`, `search_inline`, `booking_confirmation`, `package_detail`. Their position and size are fixed by the design system (F-13); an ad never appears above the primary action of a screen and never inside a quote list. |
| BR-02 | Eligible = status `running`, today (IST) within `[startsOn, endsOn]`, `placements` contains the placement, and `regionSlugs` is empty or contains the region. |
| BR-03 | Selection: weighted random order without replacement over eligible campaigns using `weight` (1–10); at most 3 ◊ creatives per response (`search_inline` uses 1 per 8 results ◊). |
| BR-04 | Local campaigns take precedence; AdSense is backfill (A-18). |
| BR-05 | Every ad is labelled "Sponsored" (NFR-COMP-006). The label is part of the component, not the creative. |
| BR-06 | `imageUrl` must be an image uploaded to Payana storage or an `https` URL on an allow-listed host ◊; creatives carry no scripts, iframes or tracking pixels. |
| BR-07 | `ctaUrl`: `https://…` or `tel:+91…` only. |
| BR-08 | Impression/click events are anonymous: campaign, placement, region, timestamp and a salted hash of the address for rate limiting, discarded after 24 h. No user ID is stored (NFR-PRIV-001). Raw events are kept 90 days; `stats` are running totals. |
| BR-09 | Counting is only for running campaigns and is rate-limited per address (T-07); obvious automation (no `User-Agent`, known bot signatures) is dropped ◊. |
| BR-10 | `AdCampaignInput.status` may be `draft`, `scheduled` or `paused`; `running` and `ended` are derived by date. |
| BR-11 | Ads are not personalised; nothing about the signed-in user influences selection. Local ads therefore do not depend on advertising consent. |

## 4. Workflows

**Serving** — a screen with a placement mounts the ad slot → slot asks the
ads store for the placement (one request per placement per navigation,
cached 60 s) → renders 0–3 creatives → IntersectionObserver posts the
impression → click posts and navigates.

**Admin** — campaigns list (status, dates, placements, impressions, clicks,
CTR) → create/edit → preview in each placement at mobile and desktop width →
save as draft or schedule.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | No ads | Slot collapses with no reserved space and no layout shift |
| ALT-2 | Image fails to load | Text-only variant of the creative |
| ALT-3 | Ad blocker blocks `/ads` | Treated as "no ads"; no retries, no nagging |
| ALT-4 | Campaign edited while running | New creative is served after the cache window; stats continue |

## 5. Loading, empty, error, retry and offline states

| State | Behaviour |
| --- | --- |
| Loading | Nothing is shown until creatives arrive; the slot has zero height until then for inline placements, and a fixed reserved height only on `home_strip` when the previous visit had an ad (CLS control) |
| Empty | Collapsed |
| Error | Collapsed; error logged client-side at debug level only |
| Retry | None — ads are best-effort |
| Offline | Collapsed; cached creatives are not shown offline (their links would not work) |

Admin screens follow the standard table states (F-16).

## 6. API and database changes

| Operation | Request → response | Access |
| --- | --- | --- |
| `GET /ads` | `?placement&regionSlug` → `AdCreative[]` | public |
| `POST /ads/{campaignId}/impression` | — → `204` | public, rate-limited |
| `POST /ads/{campaignId}/click` | — → `204` | public, rate-limited |
| `GET` · `POST /admin/ad-campaigns` | — / `AdCampaignInput` → `AdCampaign[]` / `AdCampaign` | `ads.manage` |
| `PUT /admin/ad-campaigns/{campaignId}` | `AdCampaignInput` → `AdCampaign` | `ads.manage` |

Tables: `ad_campaigns` (index `(status, starts_on, ends_on)`; GIN on
`placements`, `region_slugs`), `ad_events` (append-only, partitioned by month
◊, 90-day retention). Redis: 60 s cache of eligible campaigns per
placement + region; rate-limit counters. Job: `campaign-status` (daily 00:05
IST) and `ad-events-purge`.

## 7. Authorisation and security

- Public endpoints accept no body and no user identity; they are
  rate-limited and return `204` regardless of whether the event was counted
  (no oracle for fraudsters).
- Click fraud (T-07): per-address limits, only-running check, bot filtering,
  anomaly metric (CTR > 20 % ◊ for a campaign raises a business alert).
- Open-redirect safety: the client navigates directly to `ctaUrl`; the API
  offers no redirect endpoint. `ctaUrl` is validated on write.
- Creative text is plain text, escaped; images are served from Payana
  storage or allow-listed hosts and covered by the CSP `img-src`.
- Admin writes need `ads.manage` (`super_admin`, `marketing_manager`) and are
  audited.

## 8. Validation rules

| Field | Rule |
| --- | --- |
| `placement` (query) | `AdPlacement`, required |
| `regionSlug` (query) | slug format; optional |
| `advertiserName` | 2–60 chars |
| `advertiserContact` | ≤ 120 chars (internal; never public) |
| `title` | 3–60 chars |
| `body` | 3–140 chars |
| `imageUrl` | null, or `https` URL ≤ 500 chars on an allowed host |
| `ctaLabel` | 2–24 chars |
| `ctaUrl` | `https://` URL ≤ 500 chars, or `tel:` followed by an E.164 number |
| `placements` | 1–4 unique `AdPlacement` values |
| `regionSlugs` | 0–20 existing slugs |
| `startsOn`, `endsOn` | ISO dates; `endsOn ≥ startsOn`; range ≤ 366 days |
| `status` | `draft` \| `scheduled` \| `paused` |
| `weight` | integer 1–10 |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F12-01 | Unit | Eligibility (status × dates × placement × region) |
| UT-F12-02 | Unit | Weighted ordering distribution (seeded RNG) |
| UT-F12-03 | Unit | Derived status from dates around midnight IST |
| UT-F12-04 | Unit | `ctaUrl` validator: https, tel, `javascript:`, `data:`, `http:` |
| UT-F12-05 | Unit (web) | Ad slot: collapse when empty; one impression per view; label always present |
| IT-F12-01 | Integration | Serving and filtering (AC-01, 02); flag off (AC-03) |
| IT-F12-02 | Integration | Rotation share over many requests (AC-04) |
| IT-F12-03 | Integration | Impression/click counting, limits, non-running (AC-05…07) |
| IT-F12-04 | Integration | Campaign CRUD, lifecycle job, pause/resume (AC-09…11, 13) |
| E2E-F12-01 | E2E | Seeded campaign appears on home with "Sponsored"; click opens advertiser link in a new tab; counters increase |
| E2E-F12-02 | E2E | With the flag off no ad container exists in the DOM |
| NT-F12-01 | Negative | Invalid URLs, dates, weights, placements (AC-12) |
| NT-F12-02 | Negative | Permission matrix on admin routes (AC-14) |
| NT-F12-03 | Negative | HTML in title/body is rendered as text |

## 10. Performance and accessibility

- `GET /ads` p95 ≤ 80 ms (cache); ≤ 2 kB gzip. Ads load after primary
  content and never block LCP; images are lazy with explicit aspect ratio.
- CLS contribution of ad slots is 0 on inline placements (collapse/expand
  only before first paint of the section) and ≤ 0.02 on `home_strip`.
- Each ad is a labelled region (`aria-label="Sponsored: {advertiserName}"`)
  with one link; the image has empty alt when the title conveys the content;
  focus order places the ad after the section's primary content.

## 11. Deployment, rollback and observability

- **Flag**: `FeatureFlag.LocalAds` (kill switch, effective ≤ 60 s).
- **Config** ◊: max creatives per response, inline frequency, image host
  allow-list, rate limits.
- **Rollback**: flag off; campaigns and stats retained.
- **Metrics**: ad requests; fill rate per placement; impressions; clicks;
  CTR per campaign; dropped events; AdSense backfill share (client-side via
  F-14 events).
- **Audit**: `ad_campaign.created|updated`.

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | `AdCampaign.stats` are lifetime totals; no per-day or per-placement breakdown operation for reporting (FR-ADS-005 is met only at total level). |
| G-2 | No upload purpose for ad images (`UploadPurpose` has none); `imageUrl` is entered as a URL. |
| G-3 | No advertiser entity, contract value or billing — campaigns are sold and invoiced offline. |
| G-4 | No delete operation for campaigns; `draft`/`ended` campaigns persist. |
| A-1 | Local-first / AdSense-backfill ordering (A-18). |
| A-2 | Caps, frequency and limits marked ◊ are defaults. |
| A-3 | Local ads are contextual (placement + region), so they are shown without advertising consent; AdSense is not. |
