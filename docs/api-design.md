# QuickNotes API Design

This document describes the **real QuickNotes REST API** the backend team should build. (The client in this repo uses JSONPlaceholder only for practice.)

## Conventions

- Base URL: `https://api.quicknotes.example/v1`
- Format: JSON (`Content-Type: application/json`), UTF-8, timestamps in ISO 8601 UTC.
- Authentication: `Authorization: Bearer <access_token>` on every endpoint except register and login.
- Resources are nouns, plural, and HTTP methods carry the action. A user can only reach their own notes.
- Lists use cursor pagination: `?limit=20&cursor=<opaque>` (default limit 20, max 100).

## Endpoints

| # | Method | Path | Description | Success status |
|---|--------|------|-------------|----------------|
| 1 | POST | `/auth/register` | Create a user account | 201 Created |
| 2 | POST | `/auth/login` | Exchange email and password for an access token | 200 OK |
| 3 | GET | `/notes` | List the current user's notes (optional `?tag=work`, `limit`, `cursor`) | 200 OK |
| 4 | POST | `/notes` | Create a note | 201 Created |
| 5 | GET | `/notes/{id}` | Get one note | 200 OK |
| 6 | PATCH | `/notes/{id}` | Update a note's title, body or tags | 200 OK |
| 7 | DELETE | `/notes/{id}` | Delete a note | 204 No Content |
| 8 | GET | `/tags` | List the current user's tags | 200 OK |
| 9 | POST | `/notes/{id}/tags` | Attach a tag (created if new) to a note | 201 Created |
| 10 | DELETE | `/notes/{id}/tags/{tagId}` | Remove a tag from a note | 204 No Content |

Notes on the design:
- `PATCH` changes only the fields sent; `DELETE` is idempotent (a second call returns 404 and changes nothing).
- `POST /notes` may accept an `Idempotency-Key` header so a retried request does not create a duplicate.

## Example: create a note

`POST /v1/notes`

Request:
```json
{
  "title": "Buy milk",
  "body": "2 litres, semi-skimmed",
  "tags": ["shopping", "home"]
}
```

Response: `201 Created`, `Location: /v1/notes/4821`
```json
{
  "id": 4821,
  "title": "Buy milk",
  "body": "2 litres, semi-skimmed",
  "tags": [
    { "id": 7, "name": "shopping" },
    { "id": 9, "name": "home" }
  ],
  "created_at": "2026-10-10T09:15:30Z",
  "updated_at": "2026-10-10T09:15:30Z"
}
```

Validation: `title` is required, 1 to 100 characters; `body` is optional (max 10,000 characters); at most 10 tags.

## Example: list notes

`GET /v1/notes?limit=2&tag=shopping`

Response: `200 OK`
```json
{
  "data": [
    {
      "id": 4821,
      "title": "Buy milk",
      "body": "2 litres, semi-skimmed",
      "tags": [{ "id": 7, "name": "shopping" }],
      "created_at": "2026-10-10T09:15:30Z",
      "updated_at": "2026-10-10T09:15:30Z"
    },
    {
      "id": 4790,
      "title": "Weekend list",
      "body": "",
      "tags": [{ "id": 7, "name": "shopping" }],
      "created_at": "2026-10-09T18:02:11Z",
      "updated_at": "2026-10-09T18:02:11Z"
    }
  ],
  "next_cursor": "eyJpZCI6NDc5MH0",
  "has_more": true
}
```

An empty list is not an error: it returns `200` with `"data": []` and `"has_more": false`.

## Error codes

| Status | When it is returned |
|--------|---------------------|
| 400 Bad Request | Malformed JSON or a failed validation (missing title, title over 100 characters, bad query parameter) |
| 401 Unauthorized | Missing, expired or invalid access token, or wrong login credentials |
| 403 Forbidden | Valid token, but the note belongs to another user |
| 404 Not Found | The note, tag or route does not exist (also returned after deleting) |
| 409 Conflict | Duplicate resource, for example registering an email that already exists |
| 429 Too Many Requests | Rate limit exceeded; includes a `Retry-After` header |
| 500 Internal Server Error | Unexpected server fault; no internal details are leaked |
| 503 Service Unavailable | Temporarily overloaded or in maintenance |

All errors use one body shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Title must be between 1 and 100 characters.",
    "details": [
      { "field": "title", "issue": "too_long", "max": 100 }
    ],
    "request_id": "req_8f3a2c91"
  }
}
```
