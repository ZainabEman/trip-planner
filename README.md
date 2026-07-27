# Truck Trip Planner

A trip planner for commercial trucking that turns four inputs — current location, pickup, delivery, and hours already used in the driver's 70-hour cycle — into a federally compliant schedule: a routed map, an hour-by-hour duty timeline, and the projected arrival.

---

## Why this project exists

Planning a multi-day truck trip under 49 CFR Part 395 means reasoning about several interacting clocks at once: an 11-hour driving cap, a 14-hour on-duty window that does not pause for breaks, a 30-minute break triggered by _cumulative_ rather than consecutive driving, and a rolling 70-hour/8-day cycle. The rules interact non-obviously enough that a plan can be illegal before the truck moves.

The tools on either side of this problem do not solve it. Routing tools compute distance and drive time but know nothing about hours of service. ELD platforms record compliance after the fact rather than planning ahead of it, and require fleet hardware. Nothing takes four inputs and returns a compliant plan with printable output and no setup.

This is a **planning** tool, not an Electronic Logging Device. It projects what a driver _should_ do; it does not record what a driver _did_. Every output is labelled accordingly.

---

## Features

**Planning**

- Three-point routing (current → pickup → delivery) with real geocoding and road routing
- Full hours-of-service evaluation against five federal rules
- Gap-free timeline from trip start to delivery completion, with every event carrying a human-readable reason and its rule citation
- 34-hour cycle restart inserted automatically when a driver arrives with an exhausted cycle
- Never returns a non-compliant plan: if no legal schedule exists, it reports which rule blocked it

**Operations**

- Dashboard with fleet counts, success rate, and averages
- Trip history with search, status and date filters, and six sort modes
- Per-trip permanent URLs, shareable and bookmarkable
- Planning activity log, distinguishing what the planner did from what the driver will do

**Output**

- Interactive map with deadhead and loaded legs drawn separately
- Print-ready dispatch report
- JSON and CSV export, generated client-side

---

## Architecture

The system is a linear pipeline of four bounded contexts, described in full in [`docs/domain-analysis.md`](docs/domain-analysis.md).

```
Trip Intake  →  Routing  →  HOS Planning  →  Log & Reporting
                                ↑
                        Trip Persistence
```

### Backend architecture

```
backend/apps/planning/
├── models.py            Trip (aggregate root) → RouteLeg, TimelineEvent
├── views.py             TripViewSet: CRUD + timeline/route reads + plan action
├── serializers.py       Wire shapes only
├── exceptions.py        Domain exception → HTTP status + error envelope
└── services/
    ├── planning_service.py   TripPlanningService — the orchestration seam
    ├── routing/              RoutingProvider ABC ← OpenRouteServiceProvider
    └── hos/                  The planning engine (pure Python)
```

Three design rules hold throughout:

1. **The engine has no framework dependency.** Nothing under `services/hos/` imports the ORM, Django, HTTP, or the routing provider. It operates on frozen dataclasses passed in by the caller, which is what makes it unit-testable without a database.
2. **Single-writer discipline.** `EventFactory` is the only constructor of a timeline event; `TimelineBuilder` is the only assigner of sequence numbers.
3. **One place per regulatory constant.** Every threshold and duration lives in `services/hos/constants.py`, cross-referenced to its CFR section.

### Planning engine overview

`PlanningEngine.plan()` orchestrates and holds no rule logic. Five evaluators each check one rule and return a `RuleResult`:

| Priority | Evaluator              | Rule  | Limit                                          |
| -------- | ---------------------- | ----- | ---------------------------------------------- |
| 10       | `CycleLimitEvaluator`  | BR-8  | 70 on-duty hours / 8 days                      |
| 20       | `DutyWindowEvaluator`  | BR-2  | 14-hour window                                 |
| 30       | `BreakEvaluator`       | BR-4  | 30-min break after 8 cumulative driving hours  |
| 40       | `DrivingLimitEvaluator`| BR-1  | 11 driving hours                               |
| 50       | `FuelEvaluator`        | BR-19 | 1,000-mile fuel interval                       |

An evaluator answers only _may the truck drive this increment?_ It never schedules the remedy. When one blocks, its `RuleResult` names the required action (`BREAK_30`, `RESET_10`, `RESTART_34`, `FUEL`) and the engine schedules it.

This is why there is no `34HourRestartEvaluator`: a restart never forbids driving, so expressing it as an evaluator would duplicate `CycleLimitEvaluator`'s threshold and give a future compliance validator two thresholds that could drift apart. One trigger, one remedy.

### Routing workflow

`RoutingService` geocodes the three locations, requests two legs from OpenRouteService, and persists `RouteLeg` rows plus the trip's route totals. The provider sits behind an abstract interface, so a vendor swap touches one file.

One detail worth knowing: the directions request sets an explicit 5 km snap radius. OpenRouteService defaults to 350 m, and geocoded city centroids frequently fall outside it — Oklahoma City and San Antonio among them — producing "no drivable route" for cities that are plainly drivable. The radius is bounded rather than unlimited so a genuinely unroutable coordinate still fails.

### HOS workflow

```
POST /api/trips/{id}/plan/
  → RoutingService: geocode ×3, route ×2, persist RouteLegs + totals
  → PlanningEngine.plan(PlanningContext)
      pre-flight cycle check → 34-hour restart if exhausted
      pre-trip inspection (opens the 14-hour window, BR-24)
      per leg: evaluate → emit Driving → emit arrival (pickup / dropoff + post-trip)
      TimelineBuilder: order, number, verify no overlap
  → persist TimelineEvents + set status=planned, in one transaction
  → return trip + route + timeline + summary
```

A blocked leg produces **no events at all**, rather than a timeline that stops short of the delivery.

### Frontend architecture

```
frontend/src/
├── lib/          Pure functions — no React, no fetch
│   ├── apiClient        The only module that knows URLs or the error envelope
│   ├── format           Every date, duration, decimal and mileage string
│   ├── tripMetrics      Arrival, legality, duty-hour derivations, search, sort
│   ├── tripStats        Fleet KPIs and averages
│   ├── activityFeed     Planning events derived from trip fields
│   ├── planSteps        Activity log for live and stored trips
│   ├── polyline         Encoded-polyline decoder
│   └── exportTrip       JSON and CSV generation
├── hooks/        useHashRoute · useTripPlanner · useTrips
├── components/   Presentational; ui/ holds the primitives
└── pages/        Dashboard · Planner · History · TripDetails · HOS · FAQ · Support
```

All data fetching lives in three hooks; all derivation lives in `lib/` as pure functions. Components receive data and render it — no component formats a date or computes an average itself.

Routing is a ~60-line hash router rather than a dependency. Seven pages, one of them parameterised, does not justify one, and hash URLs give bookmarking and back-button support for free.

---

## Technology stack

| Layer             | Choice                                              |
| ----------------- | --------------------------------------------------- |
| Backend           | Python 3.12, Django 5.2, Django REST Framework 3.17 |
| Database          | PostgreSQL 16                                       |
| Frontend          | React 19, TypeScript 5.7, Vite 6                    |
| Styling           | Tailwind CSS 4                                      |
| Mapping           | Leaflet 1.9 + OpenStreetMap tiles                   |
| Routing/geocoding | OpenRouteService                                    |
| Icons             | Lucide                                              |
| Containers        | Docker Compose                                      |

---

## Folder structure

```
.
├── backend/
│   ├── apps/
│   │   ├── core/           Health check
│   │   └── planning/       Models, API, services
│   ├── config/settings/    base.py ← development.py
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/                lib · hooks · components · pages · types
│   ├── Dockerfile
│   └── vite.config.ts
├── docs/
│   ├── api.md                Endpoint reference with examples
│   ├── domain-analysis.md    Domain model and bounded contexts
│   └── hos-engine-design.md  Engine design, rule catalogue, state machine
├── docker-compose.yml
└── .env.example
```

---

## API overview

Full reference with request and response examples: [`docs/api.md`](docs/api.md).

| Method   | Endpoint                    | Purpose                                        |
| -------- | --------------------------- | ---------------------------------------------- |
| `GET`    | `/api/health/`              | Liveness                                       |
| `GET`    | `/api/trips/`               | List trips — paginated, `?status=`, `?ordering=` |
| `POST`   | `/api/trips/`               | Create a trip                                  |
| `GET`    | `/api/trips/{id}/`          | Retrieve one trip                              |
| `PATCH`  | `/api/trips/{id}/`          | Partial update                                 |
| `DELETE` | `/api/trips/{id}/`          | Delete, cascading to legs and events           |
| `GET`    | `/api/trips/{id}/route/`    | Stored route legs                              |
| `GET`    | `/api/trips/{id}/timeline/` | Stored timeline events                         |
| `POST`   | `/api/trips/{id}/plan/`     | **Run the full workflow.** No request body     |

Every non-2xx response uses one envelope:

```json
{
  "error": {
    "status_code": 422,
    "message": "Driving 20h would bring elapsed duty-window time to 23.25h, exceeding the 14-hour duty window (BR-2).",
    "details": { "rule_id": "BR-2", "evaluator": "DutyWindowEvaluator" }
  }
}
```

`422` means the request was well-formed but no legal plan exists — distinct from `400` for a malformed request, `503` for a routing provider outage, and `502` for an unclassified upstream failure. Tracebacks are never serialised.

---

## Setup

### Prerequisites

- Docker and Docker Compose, **or** Python 3.12+ and Node 20+ with a local PostgreSQL 16
- An OpenRouteService API key — free at [openrouteservice.org/dev/#/signup](https://openrouteservice.org/dev/#/signup)

### Environment variables

Copy `.env.example` to `.env` and fill in the key. Every variable below is read by `config/settings/base.py`.

| Variable                                                                      | Required     | Default                                                          | Purpose                                                            |
| ----------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `OPENROUTESERVICE_API_KEY`                                                    | **Yes**      | —                                                                | Geocoding and routing. Planning fails with `500` if unset          |
| `DATABASE_URL`                                                                | Yes          | `postgres://postgres:postgres@localhost:5432/truck_trip_planner`  | Connection string. Host `db` under Docker, `localhost` otherwise    |
| `DJANGO_SECRET_KEY`                                                           | Production   | insecure dev default                                             | Django signing key                                                 |
| `DJANGO_DEBUG`                                                                | No           | `True`                                                           | Debug mode                                                         |
| `DJANGO_SETTINGS_MODULE`                                                      | No           | `config.settings.development`                                    | Settings module                                                    |
| `DJANGO_ALLOWED_HOSTS`                                                        | No           | `*`                                                              | Allowed hosts                                                      |
| `POSTGRES_DB` · `POSTGRES_USER` · `POSTGRES_PASSWORD` · `POSTGRES_HOST` · `POSTGRES_PORT` | Docker only | —                                                    | Consumed by the `db` container                                     |
| `OPENROUTESERVICE_BASE_URL`                                                   | No           | `https://api.openrouteservice.org`                               | Override for a self-hosted instance                                |
| `ROUTING_REQUEST_TIMEOUT_SECONDS`                                             | No           | `10`                                                             | Per-request provider timeout                                       |
| `VITE_API_BASE_URL`                                                           | No           | `http://localhost:8000/api`                                      | Frontend API base                                                  |

> **Note on `.env` placement.** Docker Compose injects the root `.env` into the containers via `env_file`, so it applies as-is. Django's settings, however, look for `backend/.env`. For a **host** run, either copy `.env` there or export the variables in your shell — the root file alone will not be read, and values will silently fall back to their defaults.

### Docker setup (recommended)

```bash
cp .env.example .env          # then add your OPENROUTESERVICE_API_KEY
docker compose up -d --build
```

Frontend on `http://localhost:3000`, API on `http://localhost:8000`, PostgreSQL on `5432`. Migrations run automatically when the backend starts.

```bash
docker compose logs -f backend                        # follow logs
docker compose exec backend python manage.py test apps
docker compose down                                   # stop; add -v to drop the database volume
```

### Running locally

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp ../.env .env                                    # set the DATABASE_URL host to localhost
python manage.py migrate
python manage.py runserver

# Frontend
cd frontend
npm install
npm run dev
```

| Command                     | Purpose                       |
| --------------------------- | ----------------------------- |
| `npm run dev`               | Vite dev server on `:3000`    |
| `npm run build`             | Type-check and production build |
| `npm run lint`              | ESLint                        |
| `npm run format`            | Prettier                      |
| `python manage.py test apps` | Backend test suite            |

---

## Screenshots

> Placeholders — replace with captures at 1440 px wide.

| View                                             | File                                |
| ------------------------------------------------ | ----------------------------------- |
| Dashboard — KPIs, analytics, activity            | `docs/screenshots/dashboard.png`    |
| Planner — form and generated plan                | `docs/screenshots/planner.png`      |
| Trip details — status, summary, timeline, map    | `docs/screenshots/trip-details.png` |
| Trip history — search and filters                | `docs/screenshots/history.png`      |
| Printed dispatch report                          | `docs/screenshots/print-report.png` |
| Mobile — planner at 375 px                       | `docs/screenshots/mobile.png`       |

---

## Accessibility

- Semantic landmarks throughout; a skip link precedes the navigation
- One visible `:focus-visible` treatment applied globally
- Every interactive control meets a 44 px minimum touch target
- Filters are radio groups, so arrow keys move within them
- Expandable content uses native `<details>`, keyboard-operable without JavaScript
- Live regions announce planning progress, copy confirmations and result counts without moving focus
- Status is never conveyed by colour alone — every badge carries a word, and most an icon
- Form errors are wired via `aria-describedby`, and submitting an invalid form moves focus to the first problem
- Loading placeholders are `aria-hidden` inside a single `aria-busy` region, so a screen reader hears "Loading trips" once rather than a stream of empty boxes
- All motion is suppressed under `prefers-reduced-motion`

---

## Performance considerations

- **The engine is O(legs).** It evaluates a fixed number of rules per leg, with no backtracking.
- **Routing is cached by persistence.** Route legs and timeline events are stored, so re-reading a trip never re-hits the provider — which matters against a rate-limited free tier.
- **One transaction per plan.** Timeline writes use `bulk_create` inside a single atomic block.
- **Three parallel reads.** The trip details page fetches trip, timeline and route concurrently.
- **Shape-matched skeletons.** Placeholders mirror the real layout, so nothing reflows when data lands.
- **Transitions are 150 ms**, colour-only, and never block interaction.
- Frontend bundle: ~470 kB raw, ~139 kB gzipped, dominated by Leaflet and React.

Known cost: filling the arrival column in history requires one timeline request per planned trip, because arrival is not a field on the trip row. See _Known limitations_.

---

## Engineering decisions

**The HOS engine is pure Python with no Django import.** The regulation is the durable asset; the web framework is incidental. Keeping the engine free of the ORM means 123 of the 185 tests need no database and run in milliseconds.

**Evaluators detect; the engine schedules.** Splitting "is this legal?" from "what do we do about it?" is why adding the 70-hour cycle rule required one new file rather than changes spread across the engine.

**The timeline is the single source of truth.** Stops, daily logs and summaries are all read-projections over `TimelineEvent`. Correctness lives in one place, so a rule fix cannot leave a stale derived table behind.

**The API returns an envelope, not bare text.** One error shape with `rule_id` lets the frontend map a failure to plain language — "the trip exceeds the 14-hour duty window" — while keeping the regulatory wording available behind a disclosure.

**No routing library on the frontend.** A hash router in ~60 lines covers seven pages; a dependency would have added more surface than it removed.

**Leaflet is driven imperatively.** It owns its own DOM subtree, so letting React reconcile it buys nothing and adds version-compatibility risk.

---

## Tradeoffs

| Decision                                  | Gained                                          | Cost                                                     |
| ----------------------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| Persist route and timeline                | No repeated provider calls; reproducible results | Storage, and a re-plan must replace rather than patch     |
| Engine returns nothing on a blocked leg   | Never emits a partial or illegal plan            | A near-miss trip yields no schedule to inspect            |
| 5 km routing snap radius                  | City centroids route correctly                   | Endpoints can sit up to 5 km from the requested point     |
| Client-side search and aggregation        | No new endpoints; instant filtering              | Bounded to the loaded set (10 pages)                      |
| Timeline computed and displayed in UTC    | Timestamps always agree with duty-hour totals    | A dispatcher must convert to local time mentally          |
| Hash routing                              | No dependency                                    | URLs carry a `#`; no server-side rendering                |
| Skeletons over spinners                   | No layout shift                                  | More markup to keep in step with each layout              |

---

## Assumptions

Carried from the requirements and recorded in `docs/hos-engine-design.md`:

1. A single user role — no authentication, accounts, or multi-tenancy.
2. Property-carrying driver on the standard 70-hour/8-day cycle.
3. The truck departs at the given start time; the driver arrives with fresh 11- and 14-hour clocks.
4. Fuel every 1,000 miles; one hour each for pickup and delivery; 15 minutes per inspection.
5. Rest is planned as one continuous block — no sleeper-berth split.
6. A 34-hour restart opens a new duty period, so it carries its own pre-trip inspection.
7. Every route is exactly two legs: current → pickup → delivery.
8. No adverse-driving extension, short-haul exception, or team drivers.

---

## Future improvements

**Engine** — schedule the remaining remedies (30-minute break, 10-hour reset, fuel stop, mid-trip restart), which requires splitting a leg at an arbitrary mileage and therefore route geometry in the engine's input. Select the _nearest-binding_ constraint rather than the first blocking one by priority. Add the independent `ComplianceValidator` that re-walks a finished timeline through a separate code path.

**API** — expose duty-hour aggregates and a per-trip arrival field to remove the N+1 the history page currently absorbs; add a `search` parameter; persist the blocking `rule_id` so historical failures can name their rule.

**Frontend** — FMCSA-format daily log sheets (the grid drivers recognise); server-side pagination; optimistic re-plan.

**Operations** — structured logging with request correlation; provider response caching to protect the rate limit.

---

## Testing

```bash
docker compose exec backend python manage.py test apps    # full suite
python manage.py test apps.planning.services.hos          # engine only, no DB
cd frontend && npm run lint && npm run build
```

**185 backend tests.** Coverage is weighted toward the engine, since that is where correctness is load-bearing:

| Area             | Focus                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| Evaluators       | Each rule at, below and above its threshold; zero-length and fractional increments |
| Engine           | Event emission, contiguity, gap-freeness, sequence assignment, pre-flight restart |
| Planning service | Atomic persistence, status transitions, re-plan replacement, rollback      |
| API              | Success and every failure path, error envelope shape, no traceback leakage |

123 of those need no database and run in roughly 20 ms.

The frontend has no automated test suite — see _Known limitations_.

---

## Known limitations

1. **Only two remedies are scheduled.** The pre-flight 34-hour restart is inserted automatically. The 30-minute break, 10-hour reset, fuel stop and mid-trip restart are _detected and named_ but not scheduled, so a trip needing one is reported as unplannable rather than planned around it. This is the largest functional gap.
2. **BR-9's rolling 8-day drop-out is not implemented.** The engine's only cycle input is a scalar, so no individual day's hours can be identified and removed. The effect is conservative: the cycle clock only grows, so a restart may be scheduled marginally early, never late.
3. **Mid-leg event placement is unavailable.** `RouteLegInput` carries endpoints but no geometry, so a rule boundary cannot be resolved to a place name. One driving event per leg is the finest granularity.
4. **Some geocoded centroids are imprecise.** OpenRouteService returns polygon centroids; a bare state name resolves to a rural midpoint. Street-level input gives better results.
5. **No frontend test suite.** Verification has been type-checking, linting, and server-rendering components against live API responses. Component and end-to-end tests are the clearest next addition.
6. **Print fidelity varies by browser.** Map tiles print only where `print-color-adjust` is honoured and the tiles have loaded.
7. **Aggregates cover the loaded set.** Dashboard and history figures are computed over at most 10 pages (200 trips); beyond that they undercount, and the header says so.
8. **A routing failure leaves the trip `pending`, not `failed`** — the exception is raised before the status is touched. Defensible, since nothing was planned and the trip is retryable, but worth knowing when reading status.
9. **CSV export covers the timeline only.** Route legs and summary are JSON-only.
10. **Times are displayed in UTC**, matching how the engine computes them.

---

## License

No license has been specified. All rights reserved by the author pending a licensing decision.

---

Built by **ZainabEman** as a Spotter assessment.
