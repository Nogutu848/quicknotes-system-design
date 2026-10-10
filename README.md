# QuickNotes System Design

QuickNotes is a notes app that is moving from a browser-only tool to an online service for 1 million users. This repository has two parts:

1. **A small API client** (`index.html`, `api.js`, `style.css`) that proves the front end can talk to a REST API. It uses the [JSONPlaceholder](https://jsonplaceholder.typicode.com/posts) practice API to load, create and delete notes, with loading, success, error and empty states, input validation and disabled buttons while requests run.
2. **Design documents** for the real backend that the engineering team will build: the REST API, the database, and the overall architecture.

## How to run the API client

No build step or installs are needed.

1. Clone the repository and open the folder.
2. Open `index.html` in a browser (double-click it), or serve it locally:
   ```bash
   python3 -m http.server 8000
   ```
   then visit http://localhost:8000.
3. Click **Load notes** to fetch 10 notes (`GET /posts?_limit=10`).
4. Fill in the form (title required, max 100 characters) and click **Add note** to send a `POST`.
5. Click **Delete** on any note to send a `DELETE`.

An internet connection is required. Note that JSONPlaceholder is a fake API: it replies as if creates and deletes worked but does not store them, so the page keeps the list itself (explained in a comment in `api.js`).

## Design documents

- [API design](docs/api-design.md): REST endpoints, JSON examples, error codes
- [Data model](docs/data-model.md): tables, keys, SQL, indexes, SQL vs NoSQL
- [Architecture](docs/architecture.md): requirements, load estimate, diagram, request flows, trade-offs

## Project structure

```
index.html
api.js
style.css
README.md
docs/
  api-design.md
  data-model.md
  architecture.md
```

## What I learned

- **One reusable `request()` function keeps error handling in one place.** `fetch` only rejects on network failures, so I must check `response.ok` myself and throw, then use `try / catch / finally` in every caller to show friendly errors and always re-enable the buttons.
- **Good UIs show every state.** Loading, success, error and empty states, plus disabled buttons during requests, stop double submits and keep the user informed. Using `textContent` instead of `innerHTML` stops user text from injecting HTML.
- **A fake API changes how you design the client.** JSONPlaceholder never saves changes, so I had to decide how the page treats created and deleted notes and document that decision.
- **Capacity estimates guide the architecture.** Turning 1 million users into about 69 reads/s and 7 writes/s (average), with a 5x peak, showed the system is read-heavy, so a cache and a read replica matter more than sharding.
- **Every component should solve a named problem, and each has a trade-off.** The cache gives speed but stale data; replicas give read scale but lag; queues give fast responses but eventual consistency. Planning redundancy for every layer is how you avoid single points of failure.
- **Model many-to-many relationships with a join table.** `note_tags` links notes and tags, and a composite index keeps the most common query (a user's newest notes) fast.
