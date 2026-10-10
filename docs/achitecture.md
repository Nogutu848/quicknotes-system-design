# QuickNotes Architecture

## 1. Requirements

### Functional
- Users register and log in.
- Users create, read, update and delete their own notes (title up to 100 characters, optional body).
- Users add tags to notes and filter their notes by tag.
- Users see a paginated list of their notes, newest first.

### Non-functional
- **Scale:** 1 million registered users.
- **Availability:** 99.9% (about 8.8 hours of downtime per year at most); no single point of failure.
- **Latency:** list and read requests under 200 ms at the 95th percentile.
- **Durability:** a saved note is never lost (replicated database, backups).
- **Security:** HTTPS everywhere, hashed passwords, users can only access their own notes.
- **Scalability:** add servers to handle growth without a redesign.
- **Consistency:** a user sees their own changes immediately; other views may lag by a few seconds.

## 2. Load estimate for 1 million users

### Assumptions
- 1,000,000 registered users, 20% active per day = **200,000 daily active users**.
- Each active user reads (list or open) notes 30 times a day and writes (create, edit, delete, tag) 3 times a day.
- Average note is about 1 KB (title, body, metadata). Peak traffic = 5x the average. A day has 86,400 seconds.

### Calculations
| Metric | Working | Average | Peak (5x) |
|---|---|---|---|
| Reads per second | 200,000 x 30 = 6,000,000 per day / 86,400 | **about 69/s** | **about 347/s** |
| Writes per second | 200,000 x 3 = 600,000 per day / 86,400 | **about 7/s** | **about 35/s** |
| Storage per year | 600,000 writes/day, assuming all create a new 1 KB note: 219 million notes x 1 KB | **about 219 GB** | n/a |

Allowing about 2x for indexes, tags and overhead, plan for **roughly 0.5 TB per year**. This is read-heavy (about 10 reads for each write), and the load is small enough that a cache, one primary database and a read replica comfortably handle it.

## 3. Architecture diagram

```
                           +-----------------+
                           |     Client      |
                           | (browser/mobile)|
                           +--------+--------+
                                    |
                                    v
                           +-----------------+
                           |       DNS       |
                           +--------+--------+
                                    |
              +---------------------+---------------------+
              | static files (HTML/JS/CSS)                | API calls
              v                                           v
        +-----------+                           +--------------------+
        |    CDN    |                           |   Load Balancer    |
        +-----+-----+                           | (active + standby) |
              |                                 +----------+---------+
              v                                            |
        +-----------+                      +---------------+---------------+
        |  Static   |                      |                               |
        |  hosting  |                      v                               v
        +-----------+               +-------------+                +-------------+
                                    | App Server 1|                | App Server 2|   (... N)
                                    +------+------+                +------+------+
                                           |                              |
                    +----------------------+------------+-----------------+
                    |                      |            |                 |
                    v                      v            |                 v
             +-------------+        +-------------+     |          +-------------+
             |    Cache    |        | Primary DB  |     |          |    Queue    |
             |   (Redis)   |        |  (writes)   |     |          +------+------+
             +-------------+        +------+------+     |                 |
                    ^                      | replicate  |                 v
                    |                      v            |          +-------------+
                    |               +-------------+     |          |   Worker(s) |
                    |               | Read Replica|<----+          +------+------+
                    |               |  (reads)    |  reads                |
                    |               +-------------+                       |
                    +-----------------------------------------------------+
                          (worker updates search index / cache)
```

How to read it: static files come from the CDN; API calls go through DNS to the load balancer, then to any app server. App servers read from the cache first, then the read replica, write to the primary, and push background jobs onto the queue for workers.

## 4. Components, one sentence each

- **Client:** The web or mobile app that the user interacts with, sending API requests and showing loading, success, error and empty states.
- **DNS:** Translates `api.quicknotes.example` into the load balancer's address, and can route users to a healthy region if one fails.
- **CDN:** Serves the static front-end files from servers close to the user, which cuts latency and keeps that traffic off our servers.
- **Load balancer:** Spreads requests across app servers and stops sending traffic to unhealthy ones, so no single server is overloaded.
- **App servers (two or more):** Run the stateless API logic (auth, validation, business rules), so we can add or remove servers as traffic changes and survive a server failure.
- **Cache (Redis):** Keeps recent note lists and single notes in memory so repeated reads skip the database and stay fast under the ~347 reads/s peak.
- **Primary database:** Is the single source of truth for all writes, giving transactions, constraints and durable storage.
- **Read replica:** Serves read queries from a live copy of the primary, spreading the read-heavy load and acting as a failover candidate.
- **Queue:** Accepts background jobs immediately so the API can respond fast and traffic spikes are absorbed rather than dropped.
- **Worker:** Takes jobs from the queue and does slow work (updating the search index, sending notifications, cleaning up deleted notes, analytics) outside the request path.

## 5. Request flows

### GET /notes (read)
1. The client sends `GET /v1/notes?limit=20` with its access token.
2. DNS resolves the API hostname and the request reaches the **load balancer**, which picks a healthy **app server**.
3. The app server validates the token and works out the user's id.
4. It builds a cache key (for example `notes:user42:first-page`) and checks the **cache**.
5. **Cache hit:** it returns the stored list immediately (go to step 8).
6. **Cache miss:** it runs the query (newest 20 notes plus their tags) on the **read replica**.
7. It stores the result in the cache with a short expiry (for example 60 seconds).
8. The app server returns `200 OK` with the JSON list, or `200` with an empty list if the user has no notes.

### POST /notes (write)
1. The client sends `POST /v1/notes` with the JSON body and its token.
2. The **load balancer** forwards it to an **app server**.
3. The app server authenticates the user and validates the body (title required, at most 100 characters).
4. It writes the note (and tags) to the **primary database** in one transaction.
5. It deletes that user's cached list entries so the next read is fresh (cache invalidation).
6. It publishes a job to the **queue** (for example "update search index for note 4821").
7. It returns `201 Created` with the new note and a `Location` header, without waiting for the job.
8. A **worker** takes the job and does the background work; failed jobs are retried, then moved to a dead-letter queue.
9. The primary **replicates** the new row to the read replica within moments.

## 6. Trade-offs

1. **Cache speed vs freshness.** The cache makes reads fast and protects the database, but a cached list can be stale. We invalidate on writes and use short expiry times, so users see their own changes immediately while accepting that rare edge cases may lag a few seconds.
2. **Read replica scale vs replication lag.** Replicas spread reads and give us a failover copy, but a replica can be slightly behind the primary. To avoid a user not seeing the note they just created, reads right after a write can go to the primary (or use the cache entry we just refreshed).
3. **Queue and workers vs simplicity.** Background jobs keep API responses fast and absorb spikes, but add components to run and monitor, and make some results (such as search) eventually consistent.
4. **SQL consistency vs horizontal write scaling.** One primary keeps transactions and constraints simple, but all writes go to one machine. At about 35 writes/s peak this is far below its limit; if we outgrow it, we shard by `user_id`.
5. **More servers vs cost.** Two or more of every component costs more than one, but is what makes the availability target possible.

## 7. Avoiding single points of failure

| Component | How a single failure is survived |
|---|---|
| DNS | Use a managed DNS provider with several name servers and health checks |
| CDN | Provider is globally distributed; on a CDN failure, clients fall back to the origin |
| Load balancer | Run an active/standby pair (or managed multi-zone LB) with a shared virtual IP and health checks |
| App servers | Two or more, stateless (no data kept on the server), spread across availability zones; auto-replaced when unhealthy |
| Cache | Redis with a replica and automatic failover; if the cache is down, the app falls back to the database (slower but working) |
| Primary database | Synchronous or near-synchronous standby; if the primary fails, a read replica is promoted automatically; nightly backups plus point-in-time recovery |
| Read replica | More than one replica in different zones; losing one only reduces read capacity |
| Queue | Managed, replicated queue; jobs are persisted until a worker acknowledges them |
| Workers | Several workers; if one dies its unacknowledged job is retried by another |

Everything is also deployed across at least two availability zones, so losing one data center does not take the service down.
