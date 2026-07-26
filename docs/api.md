# API Documentation

**Scope of this document:** the REST API surface over the persistence layer (`Trip`, `RouteLeg`, `TimelineEvent`), plus the plan-generation endpoint added in Phase 6.

- **CRUD + read-only nested access** (Phase 3): `timeline` and `route` return exactly what is stored; if nothing has been persisted yet for a trip, they return `[]`.
- **Plan generation** (Phase 6): `POST /api/trips/{id}/plan/` runs the whole workflow — geocode, route, HOS planning, persistence — and returns the completed trip.

All endpoints are served under the `/api/` prefix. All request/response bodies are JSON.

---

## Error format

Every non-2xx response uses the same envelope, produced by a custom DRF exception handler (`apps/planning/exceptions.py`):

```json
{
  "error": {
    "status_code": 400,
    "message": "One or more fields failed validation.",
    "details": {
      "cycle_hours_used": ["Cycle hours used cannot be negative."]
    }
  }
}
```

- `message` is a short, human-readable summary.
- `details` carries the field-level breakdown for validation errors, or `{"detail": "..."}` for non-field errors (404, 405, etc.). For planning failures it additionally carries `rule_id` and `evaluator` (see below).

Tracebacks and internal identifiers are never serialised. Server-side faults (a misconfigured provider, an unclassified upstream failure) return a generic `message` and are logged with their specifics instead.

### Status codes used

| Code | Meaning in this API |
|---|---|
| `400` | Malformed request — a field is missing or has an invalid shape/value |
| `404` | The Trip does not exist |
| `405` | Method not allowed (e.g. `PUT` on a trip, `GET` on `/plan/`) |
| `422` | The request was well-formed and the Trip exists, but the content is unprocessable — no legal HOS plan exists, a location cannot be geocoded, or no drivable route exists |
| `500` | Server-side misconfiguration (e.g. routing provider credentials) |
| `502` | Unclassified upstream routing failure |
| `503` | Routing provider timed out, rate-limited, or returned a server error — retryable |

---

## Endpoints

### `GET /api/health/`

Unchanged from Phase 1. Liveness check.

| | |
|---|---|
| **Method** | GET |
| **Request body** | none |
| **Response body** | `{"status": "ok"}` |
| **Status codes** | `200 OK` |

---

### `GET /api/trips/`

List trips. Paginated, filterable, orderable.

| | |
|---|---|
| **Method** | GET |
| **Query params** | `?status=pending\|planned\|failed` — exact-match filter on Trip status.<br>`?ordering=created_at` or `?ordering=-created_at` (also supports `trip_start_time`, `status`) — default order is `-created_at`.<br>`?page=N` — pagination (page size 20). |
| **Request body** | none |
| **Response body** | `{"count": int, "next": url\|null, "previous": url\|null, "results": [Trip, ...]}` |
| **Status codes** | `200 OK` |

**Example — `GET /api/trips/?status=planned&ordering=-created_at`**

```json
{
  "count": 1,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": "68972e75-1f1e-46af-8329-19c48b0d7e2c",
      "current_location_text": "Dallas, TX",
      "pickup_location_text": "Fort Worth, TX",
      "dropoff_location_text": "Chicago, IL",
      "cycle_hours_used": "10.00",
      "trip_start_time": "2026-07-27T08:00:00Z",
      "status": "planned",
      "total_distance_miles": null,
      "total_duration_minutes": null,
      "created_at": "2026-07-26T17:12:57.968904Z",
      "updated_at": "2026-07-26T17:14:10.196544Z"
    }
  ]
}
```

---

### `POST /api/trips/`

Create a trip.

| | |
|---|---|
| **Method** | POST |
| **Request body** | `current_location_text` (string, required), `pickup_location_text` (string, required), `dropoff_location_text` (string, required), `cycle_hours_used` (decimal, required, ≥ 0), `trip_start_time` (ISO 8601 datetime, required), `status` (string, optional — one of `pending`/`planned`/`failed`, defaults to `pending`), `total_distance_miles` (decimal, optional), `total_duration_minutes` (integer, optional) |
| **Response body** | the created Trip |
| **Status codes** | `201 Created` on success. `400 Bad Request` on missing/invalid fields. |

**Example request**

```json
{
  "current_location_text": "Dallas, TX",
  "pickup_location_text": "Fort Worth, TX",
  "dropoff_location_text": "Chicago, IL",
  "cycle_hours_used": "10.00",
  "trip_start_time": "2026-07-27T08:00:00Z"
}
```

**Example response — `201 Created`**

```json
{
  "id": "68972e75-1f1e-46af-8329-19c48b0d7e2c",
  "current_location_text": "Dallas, TX",
  "pickup_location_text": "Fort Worth, TX",
  "dropoff_location_text": "Chicago, IL",
  "cycle_hours_used": "10.00",
  "trip_start_time": "2026-07-27T08:00:00Z",
  "status": "pending",
  "total_distance_miles": null,
  "total_duration_minutes": null,
  "created_at": "2026-07-26T17:12:57.968904Z",
  "updated_at": "2026-07-26T17:12:57.968904Z"
}
```

**Example error — negative cycle hours — `400 Bad Request`**

```json
{
  "error": {
    "status_code": 400,
    "message": "One or more fields failed validation.",
    "details": { "cycle_hours_used": ["Cycle hours used cannot be negative."] }
  }
}
```

**Example error — missing required fields — `400 Bad Request`**

```json
{
  "error": {
    "status_code": 400,
    "message": "One or more fields failed validation.",
    "details": {
      "pickup_location_text": ["This field is required."],
      "dropoff_location_text": ["This field is required."],
      "cycle_hours_used": ["This field is required."],
      "trip_start_time": ["This field is required."]
    }
  }
}
```

---

### `GET /api/trips/{id}/`

Retrieve one trip.

| | |
|---|---|
| **Method** | GET |
| **Request body** | none |
| **Response body** | the Trip |
| **Status codes** | `200 OK`. `404 Not Found` if `id` doesn't exist. |

**Example error — `404 Not Found`**

```json
{
  "error": {
    "status_code": 404,
    "message": "No Trip matches the given query.",
    "details": { "detail": "No Trip matches the given query." }
  }
}
```

---

### `PATCH /api/trips/{id}/`

Partially update a trip. Any subset of the writable fields may be sent.

| | |
|---|---|
| **Method** | PATCH |
| **Request body** | any subset of: `current_location_text`, `pickup_location_text`, `dropoff_location_text`, `cycle_hours_used`, `trip_start_time`, `status`, `total_distance_miles`, `total_duration_minutes` |
| **Response body** | the updated Trip |
| **Status codes** | `200 OK`. `400 Bad Request` on invalid values. `404 Not Found` if `id` doesn't exist. |

**Example request**

```json
{ "status": "planned" }
```

**Example response — `200 OK`**

```json
{
  "id": "68972e75-1f1e-46af-8329-19c48b0d7e2c",
  "current_location_text": "Dallas, TX",
  "pickup_location_text": "Fort Worth, TX",
  "dropoff_location_text": "Chicago, IL",
  "cycle_hours_used": "10.00",
  "trip_start_time": "2026-07-27T08:00:00Z",
  "status": "planned",
  "total_distance_miles": null,
  "total_duration_minutes": null,
  "created_at": "2026-07-26T17:12:57.968904Z",
  "updated_at": "2026-07-26T17:14:10.196544Z"
}
```

> Note: `PUT` is intentionally not supported (`405 Method Not Allowed`) — only partial updates via `PATCH` are exposed, per the required endpoint list.

---

### `DELETE /api/trips/{id}/`

Delete a trip and cascade-delete its RouteLegs and TimelineEvents.

| | |
|---|---|
| **Method** | DELETE |
| **Request body** | none |
| **Response body** | empty |
| **Status codes** | `204 No Content` on success. `404 Not Found` if `id` doesn't exist. |

---

### `GET /api/trips/{id}/timeline/`

Return the trip's stored `TimelineEvent` rows, ordered by `sequence`. **Read-only — nothing is generated.** Returns `[]` if no events have been persisted for this trip yet.

| | |
|---|---|
| **Method** | GET |
| **Request body** | none |
| **Response body** | a plain JSON array of TimelineEvent (not paginated) |
| **Status codes** | `200 OK` (including when the array is empty). `404 Not Found` if the trip itself doesn't exist. |

**Example response — trip with stored events**

```json
[
  {
    "id": 1,
    "trip": "68972e75-1f1e-46af-8329-19c48b0d7e2c",
    "sequence": 1,
    "start_time": "2026-07-26T17:19:10.047093Z",
    "end_time": "2026-07-26T17:19:10.047093Z",
    "duty_status": "driving",
    "event_type": "drive",
    "location_name": "Dallas, TX",
    "latitude": "32.776700",
    "longitude": "-96.797000",
    "distance_miles": "35.00",
    "reason": "test"
  }
]
```

**Example response — trip with no events yet**

```json
[]
```

---

### `GET /api/trips/{id}/route/`

Return the trip's stored `RouteLeg` rows, ordered by `sequence`. **Read-only — nothing is generated.** Returns `[]` if no legs have been persisted for this trip yet.

| | |
|---|---|
| **Method** | GET |
| **Request body** | none |
| **Response body** | a plain JSON array of RouteLeg (not paginated) |
| **Status codes** | `200 OK` (including when the array is empty). `404 Not Found` if the trip itself doesn't exist. |

**Example response — trip with a stored leg**

```json
[
  {
    "id": 1,
    "trip": "68972e75-1f1e-46af-8329-19c48b0d7e2c",
    "sequence": 1,
    "leg_type": "deadhead",
    "origin_text": "Dallas, TX",
    "destination_text": "Fort Worth, TX",
    "distance_miles": "35.00",
    "duration_minutes": 40,
    "encoded_polyline": "xyz"
  }
]
```

**Example response — trip with no legs yet**

```json
[]
```

---

### `POST /api/trips/{id}/plan/`

Generate and persist the trip's complete plan, then return it. This is the one endpoint that performs the full workflow.

| | |
|---|---|
| **Method** | POST |
| **Request body** | **none** — everything the plan depends on already lives on the Trip row. An empty JSON object is accepted and ignored. |
| **Response body** | `{"planning_status", "trip", "route", "timeline", "summary"}` |
| **Status codes** | `200 OK` on success. `404` if the trip doesn't exist. `422` if no compliant plan exists / the locations can't be geocoded / no drivable route exists. `500`/`502`/`503` on routing-provider problems. |

**What it does, in order:**

1. Load the Trip.
2. Geocode the three locations and compute the two-leg route (`RoutingService`), **persisting `RouteLeg` rows** and the Trip's `total_distance_miles`/`total_duration_minutes`.
3. Run the HOS engine over the resulting geography (`PlanningEngine`).
4. **Persist the `TimelineEvent` rows** and set `status = planned` — one transaction.
5. Return the Trip, its route, its timeline, and summary metrics.

**Idempotency / re-planning.** Re-posting regenerates the plan: the previous `RouteLeg` and `TimelineEvent` rows are replaced, not appended to (trips are regenerated, never edited — Assumption A-24). Sequence numbers restart at 1.

**On failure**, the Trip is left persisted with `status = failed` and **no** timeline rows — a partial or non-compliant plan is never stored (BR-37 / NFR-2.4). Any timeline from a previous successful plan is cleared, so `status = failed` and a stored timeline can never coexist.

**Note.** `POST /api/trips/` does not plan. Create the trip first, then call this endpoint with the returned `id`.

**Example request**

```
POST /api/trips/87a6c8b9-5a04-46c2-914d-2498a0be70c1/plan/
```

**Example response — `200 OK`** (Dallas → Fort Worth → Chicago, 10 cycle hours used)

```json
{
  "planning_status": "planned",
  "trip": {
    "id": "87a6c8b9-5a04-46c2-914d-2498a0be70c1",
    "current_location_text": "Dallas, TX",
    "pickup_location_text": "Fort Worth, TX",
    "dropoff_location_text": "Chicago, IL",
    "cycle_hours_used": "10.00",
    "trip_start_time": "2026-07-27T08:00:00Z",
    "status": "planned",
    "total_distance_miles": "935.00",
    "total_duration_minutes": 300,
    "created_at": "2026-07-26T23:08:40.572176Z",
    "updated_at": "2026-07-26T23:08:40.839022Z"
  },
  "route": [
    {
      "id": 1,
      "trip": "87a6c8b9-5a04-46c2-914d-2498a0be70c1",
      "sequence": 1,
      "leg_type": "deadhead",
      "origin_text": "Dallas, Texas",
      "destination_text": "Fort Worth, Texas",
      "distance_miles": "35.00",
      "duration_minutes": 120,
      "encoded_polyline": "poly1"
    },
    {
      "id": 2,
      "trip": "87a6c8b9-5a04-46c2-914d-2498a0be70c1",
      "sequence": 2,
      "leg_type": "loaded",
      "origin_text": "Fort Worth, Texas",
      "destination_text": "Chicago, Illinois",
      "distance_miles": "900.00",
      "duration_minutes": 180,
      "encoded_polyline": "poly2"
    }
  ],
  "timeline": [
    {
      "id": 1,
      "trip": "87a6c8b9-5a04-46c2-914d-2498a0be70c1",
      "sequence": 1,
      "start_time": "2026-07-27T08:00:00Z",
      "end_time": "2026-07-27T08:15:00Z",
      "duty_status": "on_duty_not_driving",
      "event_type": "pretrip_inspection",
      "location_name": "Dallas, TX",
      "latitude": "32.776700",
      "longitude": "-96.797000",
      "distance_miles": null,
      "reason": "Pre-trip inspection opening the duty period; the 14-hour duty window starts here (BR-21, BR-24)."
    },
    {
      "id": 2,
      "trip": "87a6c8b9-5a04-46c2-914d-2498a0be70c1",
      "sequence": 2,
      "start_time": "2026-07-27T08:15:00Z",
      "end_time": "2026-07-27T10:15:00Z",
      "duty_status": "driving",
      "event_type": "drive",
      "location_name": "Dallas, Texas",
      "latitude": "32.776700",
      "longitude": "-96.797000",
      "distance_miles": "35.00",
      "reason": "Driving leg 1 from Dallas, Texas to Fort Worth, Texas (BR-13)."
    },
    {
      "id": 3,
      "trip": "87a6c8b9-5a04-46c2-914d-2498a0be70c1",
      "sequence": 3,
      "start_time": "2026-07-27T10:15:00Z",
      "end_time": "2026-07-27T11:15:00Z",
      "duty_status": "on_duty_not_driving",
      "event_type": "pickup",
      "location_name": "Fort Worth, TX",
      "latitude": "32.755500",
      "longitude": "-97.330800",
      "distance_miles": null,
      "reason": "Loading at pickup: Fort Worth, TX (BR-17)."
    },
    {
      "id": 4,
      "trip": "87a6c8b9-5a04-46c2-914d-2498a0be70c1",
      "sequence": 4,
      "start_time": "2026-07-27T11:15:00Z",
      "end_time": "2026-07-27T14:15:00Z",
      "duty_status": "driving",
      "event_type": "drive",
      "location_name": "Fort Worth, Texas",
      "latitude": "32.755500",
      "longitude": "-97.330800",
      "distance_miles": "900.00",
      "reason": "Driving leg 2 from Fort Worth, Texas to Chicago, Illinois (BR-13)."
    },
    {
      "id": 5,
      "trip": "87a6c8b9-5a04-46c2-914d-2498a0be70c1",
      "sequence": 5,
      "start_time": "2026-07-27T14:15:00Z",
      "end_time": "2026-07-27T15:15:00Z",
      "duty_status": "on_duty_not_driving",
      "event_type": "dropoff",
      "location_name": "Chicago, IL",
      "latitude": "41.878100",
      "longitude": "-87.629800",
      "distance_miles": null,
      "reason": "Unloading at dropoff: Chicago, IL (BR-18)."
    },
    {
      "id": 6,
      "trip": "87a6c8b9-5a04-46c2-914d-2498a0be70c1",
      "sequence": 6,
      "start_time": "2026-07-27T15:15:00Z",
      "end_time": "2026-07-27T15:30:00Z",
      "duty_status": "on_duty_not_driving",
      "event_type": "posttrip_inspection",
      "location_name": "Chicago, IL",
      "latitude": "41.878100",
      "longitude": "-87.629800",
      "distance_miles": null,
      "reason": "Post-trip inspection closing the duty period after delivery (BR-22)."
    }
  ],
  "summary": {
    "event_count": 6,
    "driving_hours": "5.00",
    "on_duty_hours": "2.50",
    "off_duty_hours": "0.00",
    "total_elapsed_hours": "7.50",
    "total_distance_miles": "935.00",
    "total_duration_minutes": 300
  }
}
```

#### Response fields

| Field | Notes |
|---|---|
| `planning_status` | The Trip's status after the run — `planned` on success. Mirrors `trip.status`. |
| `trip` | Identical shape to `GET /api/trips/{id}/`. |
| `route` | Identical shape to `GET /api/trips/{id}/route/`, ordered by `sequence`. Read from what was committed, so it matches a subsequent GET exactly. |
| `timeline` | Identical shape to `GET /api/trips/{id}/timeline/`, ordered by `sequence`. Contiguous and gap-free: each event's `start_time` equals the previous event's `end_time`, the first starts at `trip_start_time`, and the last ends at delivery completion. |
| `summary.event_count` | Number of timeline events. |
| `summary.driving_hours` | Hours with `duty_status = driving`. |
| `summary.on_duty_hours` | Hours with `duty_status = on_duty_not_driving` (inspections, pickup, dropoff). |
| `summary.off_duty_hours` | Hours with `duty_status = off_duty` or `sleeper_berth` — non-zero only when a 34-hour cycle restart was required. |
| `summary.total_elapsed_hours` | Wall-clock span from the first event's start to the last event's end. |
| `summary.total_distance_miles`, `summary.total_duration_minutes` | The **route** totals from the Trip, as persisted by routing. Not timeline-derived — `total_duration_minutes` is driving time only, so it is smaller than `total_elapsed_hours × 60`. |

> The `summary` duty-hour figures are computed per request and **not stored** — `Trip` has no columns for them. They are a read projection (`docs/domain-analysis.md` §3.9).

**Example response — no legal plan exists — `422 Unprocessable Entity`**

```json
{
  "error": {
    "status_code": 422,
    "message": "Driving 20h would bring elapsed duty-window time to 23.25h, exceeding the 14-hour duty window (BR-2).",
    "details": {
      "detail": "Driving 20h would bring elapsed duty-window time to 23.25h, exceeding the 14-hour duty window (BR-2).",
      "trip_id": "41e22782-7515-42b5-a818-fcc3b60264c0",
      "rule_id": "BR-2",
      "evaluator": "DutyWindowEvaluator"
    }
  }
}
```

`rule_id` is the business rule that blocked the plan (`BR-1` 11-hour limit, `BR-2` 14-hour window, `BR-4` 30-minute break, `BR-8` 70-hour cycle, `BR-19` fuel interval); `evaluator` is the component that reported it.

**Example response — location cannot be geocoded — `422`**

```json
{
  "error": {
    "status_code": 422,
    "message": "Could not resolve location: 'Nowhere, ZZ'",
    "details": {
      "detail": "Could not resolve location: 'Nowhere, ZZ'",
      "location": "Nowhere, ZZ"
    }
  }
}
```

**Example response — no drivable route — `422`**

```json
{
  "error": {
    "status_code": 422,
    "message": "No drivable route found between 'Dallas' and 'Honolulu'",
    "details": {
      "detail": "No drivable route found between 'Dallas' and 'Honolulu'",
      "origin": "Dallas",
      "destination": "Honolulu"
    }
  }
}
```

**Example response — routing provider down — `503 Service Unavailable`**

```json
{
  "error": {
    "status_code": 503,
    "message": "The routing provider is temporarily unavailable. Please try again.",
    "details": { "detail": "The routing provider is temporarily unavailable. Please try again." }
  }
}
```

---

## curl examples

```bash
BASE=http://localhost:8000/api

# 1. Create a trip
TRIP=$(curl -s -X POST "$BASE/trips/" \
  -H 'Content-Type: application/json' \
  -d '{
    "current_location_text": "Dallas, TX",
    "pickup_location_text": "Fort Worth, TX",
    "dropoff_location_text": "Oklahoma City, OK",
    "cycle_hours_used": "10.00",
    "trip_start_time": "2026-07-27T08:00:00Z"
  }')
ID=$(echo "$TRIP" | python -c 'import sys,json; print(json.load(sys.stdin)["id"])')

# 2. Plan it (no request body)
curl -s -X POST "$BASE/trips/$ID/plan/" | python -m json.tool

# 3. Read back what was persisted — matches the plan response exactly
curl -s "$BASE/trips/$ID/timeline/" | python -m json.tool
curl -s "$BASE/trips/$ID/route/"    | python -m json.tool
curl -s "$BASE/trips/$ID/"          | python -m json.tool   # status: "planned"

# 4. Re-plan — replaces, does not duplicate
curl -s -X POST "$BASE/trips/$ID/plan/" | python -c 'import sys,json; d=json.load(sys.stdin); print(len(d["timeline"]), "events;", len(d["route"]), "legs")'

# 5. Force a 422: a cycle already at the 70-hour limit still plans (restart is
#    inserted), so instead use a dropoff far enough to breach the 14-hour window
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/trips/$ID/plan/"

# 6. Show the error envelope for an unknown trip (404)
curl -s -X POST "$BASE/trips/00000000-0000-0000-0000-000000000000/plan/" | python -m json.tool

# 7. GET on /plan/ is not allowed (405)
curl -s -X GET "$BASE/trips/$ID/plan/" | python -m json.tool
```

---

## Validation rules

| Rule | Enforced by | Failure response |
|---|---|---|
| `current_location_text`, `pickup_location_text`, `dropoff_location_text` required | Django model (`CharField`, non-blank) → DRF auto-generated `required=True` | `400`, field-scoped message |
| `cycle_hours_used` required | Model field, non-null | `400`, field-scoped message |
| `cycle_hours_used` ≥ 0 | `TripSerializer.validate_cycle_hours_used` | `400`, `"Cycle hours used cannot be negative."` |
| `trip_start_time` required | Model field, non-null | `400`, field-scoped message |
| `status` must be one of `pending`/`planned`/`failed` | Model `TextChoices` → DRF `ChoiceField` | `400`, `"... is not a valid choice."` |
| Trip must exist for retrieve/patch/delete/timeline/route | `get_object()` (404 on miss) | `404`, consistent error envelope |
| Only `GET/POST/PATCH/DELETE` allowed on `/trips/` (no `PUT`) | `http_method_names` on the viewset | `405`, consistent error envelope |

| Trip must exist for `plan` | `get_object()` (404 on miss) | `404`, consistent error envelope |
| Only `POST` allowed on `/plan/` | `@action(methods=['post'])` | `405`, consistent error envelope |
| A compliant HOS plan must exist | `PlanningEngine` via `TripPlanningService` | `422`, with `rule_id` and `evaluator` |

Note: the upper bound on `cycle_hours_used` (≤ 70) is not enforced by the API serializer. A value at or above 70 is a legitimate input — the engine responds by inserting a 34-hour cycle restart before any driving (BR-10, AC-11), not by rejecting the trip.

---

## Manual testing checklist

- [ ] `GET /api/health/` → `200`, `{"status": "ok"}`
- [ ] `GET /api/trips/` on empty DB → `200`, `{"count": 0, "results": []}`
- [ ] `POST /api/trips/` with all required fields → `201`, body echoes input + generated `id`/`created_at`/`updated_at`
- [ ] `POST /api/trips/` missing a required field → `400`, field-scoped error per missing field
- [ ] `POST /api/trips/` with `cycle_hours_used: -5` → `400`, `"Cycle hours used cannot be negative."`
- [ ] `GET /api/trips/{id}/` for a created trip → `200`, full Trip body
- [ ] `GET /api/trips/{bad-uuid}/` → `404`, consistent error envelope
- [ ] `PATCH /api/trips/{id}/` with `{"status": "planned"}` → `200`, `status` updated, `updated_at` changed
- [ ] `PUT /api/trips/{id}/` → `405 Method Not Allowed`
- [ ] `DELETE /api/trips/{id}/` → `204`, then `GET` the same id → `404`
- [ ] `GET /api/trips/{id}/timeline/` on a trip with no events → `200`, `[]`
- [ ] `GET /api/trips/{id}/route/` on a trip with no legs → `200`, `[]`
- [ ] Seed one `RouteLeg`/`TimelineEvent` directly (e.g. via `manage.py shell` or admin) → `GET /api/trips/{id}/route/` and `.../timeline/` return exactly that stored row, unmodified
- [ ] `POST /api/trips/{id}/plan/` on a freshly created trip → `200`, six timeline events, two route legs, `planning_status: "planned"`
- [ ] Re-`POST` the same `/plan/` → still six events / two legs (replaced, not duplicated), sequences restart at 1
- [ ] After planning, `GET .../timeline/` and `.../route/` return byte-identical arrays to the plan response's `timeline`/`route`
- [ ] After planning, `GET /api/trips/{id}/` shows `status: "planned"` and populated `total_distance_miles`/`total_duration_minutes`
- [ ] `POST /api/trips/{id}/plan/` with `cycle_hours_used: "70.00"` → first timeline event is `cycle_restart_34`, `summary.off_duty_hours` is `"34.00"`
- [ ] `POST /api/trips/{id}/plan/` for a dropoff far enough to breach the 14-hour window → `422`, `details.rule_id` is `"BR-2"`, trip `status` becomes `failed`, `GET .../timeline/` returns `[]`
- [ ] `POST /api/trips/{id}/plan/` with a nonsense dropoff (e.g. `"Nowhere, ZZ"`) → `422` with `details.location`
- [ ] `POST /api/trips/{bad-uuid}/plan/` → `404` in the error envelope
- [ ] `GET /api/trips/{id}/plan/` → `405 Method Not Allowed`
- [ ] Unset `OPENROUTESERVICE_API_KEY` and plan → `500` with a generic message, no credential name in the body
- [ ] No response body from any failure path contains `Traceback` or a file path
- [ ] `GET /api/trips/?status=failed` → only trips with `status=failed`
- [ ] `GET /api/trips/?ordering=created_at` vs `?ordering=-created_at` → order reverses
- [ ] Create 25+ trips → `GET /api/trips/` returns 20 per page with a non-null `next` link; `?page=2` returns the remainder
