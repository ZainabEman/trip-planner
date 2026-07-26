# API Documentation — Phase 3: REST API Foundation

**Scope of this document:** the REST API surface built on top of the Phase 2B persistence layer (`Trip`, `RouteLeg`, `TimelineEvent`). This is a **CRUD + read-only nested access** API. It contains no HOS logic, no route/geocoding calls, and no plan-generation endpoint — those are out of scope until a later phase. `timeline` and `route` return exactly what is stored; if nothing has been persisted yet for a trip, they return `[]`.

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
- `details` carries the field-level breakdown for validation errors, or `{"detail": "..."}` for non-field errors (404, 405, etc.).

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

Note: the upper bound on `cycle_hours_used` (≤ 70) and any cross-field business validation belong to the HOS engine (future phase), not this persistence-facing API — this phase validates only what the API layer itself is responsible for.

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
- [ ] `GET /api/trips/?status=failed` → only trips with `status=failed`
- [ ] `GET /api/trips/?ordering=created_at` vs `?ordering=-created_at` → order reverses
- [ ] Create 25+ trips → `GET /api/trips/` returns 20 per page with a non-null `next` link; `?page=2` returns the remainder
