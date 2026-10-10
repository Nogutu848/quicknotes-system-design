# QuickNotes Data Model

## Entities

### users
| Column | Type | Key / constraint |
|---|---|---|
| id | BIGINT (identity) | **Primary key** |
| email | VARCHAR(255) | NOT NULL, UNIQUE |
| password_hash | VARCHAR(255) | NOT NULL |
| display_name | VARCHAR(100) | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, default now() |

### notes
| Column | Type | Key / constraint |
|---|---|---|
| id | BIGINT (identity) | **Primary key** |
| user_id | BIGINT | NOT NULL, **Foreign key** to users(id) |
| title | VARCHAR(100) | NOT NULL |
| body | TEXT | NOT NULL, default '' |
| created_at | TIMESTAMPTZ | NOT NULL, default now() |
| updated_at | TIMESTAMPTZ | NOT NULL, default now() |

### tags
| Column | Type | Key / constraint |
|---|---|---|
| id | BIGINT (identity) | **Primary key** |
| user_id | BIGINT | NOT NULL, **Foreign key** to users(id) |
| name | VARCHAR(50) | NOT NULL; UNIQUE with user_id |

### note_tags (join table)
| Column | Type | Key / constraint |
|---|---|---|
| note_id | BIGINT | **Primary key (part 1)**, **Foreign key** to notes(id) |
| tag_id | BIGINT | **Primary key (part 2)**, **Foreign key** to tags(id) |

## Relationships

```
users 1 ----< notes >----< note_tags >----< tags >---- 1 users
        (one-to-many)       (many-to-many via join table)
```

- **users to notes: one-to-many.** One user owns many notes; each note belongs to exactly one user (`notes.user_id`).
- **users to tags: one-to-many.** One user owns many tags (`tags.user_id`); tag names are unique per user.
- **notes to tags: many-to-many.** A note can have many tags and a tag can be on many notes. A relational database cannot store this directly, so the join table `note_tags` holds one row per (note, tag) pair. Its composite primary key stops the same tag being attached twice.
- Deleting a user, note or tag cascades to the rows that depend on it (`ON DELETE CASCADE`).

## CREATE TABLE statements (PostgreSQL)

```sql
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE notes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(100) NOT NULL CHECK (char_length(title) >= 1),
  body       TEXT         NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    VARCHAR(50) NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE note_tags (
  note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  BIGINT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
```

## Indexes

```sql
-- Serves "list my newest notes" (GET /notes) without scanning or sorting every row.
CREATE INDEX idx_notes_user_created ON notes (user_id, created_at DESC);

-- Serves "find all notes with this tag" (GET /notes?tag=...). The primary key
-- covers lookups by note_id; this covers lookups by tag_id.
CREATE INDEX idx_note_tags_tag ON note_tags (tag_id, note_id);
```

**Why the first index:** the most common query filters by `user_id` and sorts by newest first. A composite index on `(user_id, created_at DESC)` returns the first page directly in order, so the query stays fast with hundreds of millions of rows. The cost is slightly slower writes and more storage, which is acceptable for a read-heavy service. (`users.email` and `tags (user_id, name)` are already indexed by their UNIQUE constraints.)

## Example queries

```sql
-- 1. Newest 20 notes for user 42 (uses idx_notes_user_created)
SELECT id, title, body, created_at
FROM notes
WHERE user_id = 42
ORDER BY created_at DESC
LIMIT 20;

-- 2. JOIN: each note of user 42 with its tags
SELECT n.id, n.title, t.name AS tag
FROM notes n
JOIN note_tags nt ON nt.note_id = n.id
JOIN tags t       ON t.id = nt.tag_id
WHERE n.user_id = 42
ORDER BY n.created_at DESC, t.name;

-- 3. Notes of user 42 that have the tag 'shopping'
SELECT n.id, n.title
FROM notes n
JOIN note_tags nt ON nt.note_id = n.id
JOIN tags t       ON t.id = nt.tag_id
WHERE n.user_id = 42 AND t.name = 'shopping';

-- 4. How many notes each tag has for user 42 (aggregate with LEFT JOIN)
SELECT t.name, COUNT(nt.note_id) AS note_count
FROM tags t
LEFT JOIN note_tags nt ON nt.tag_id = t.id
WHERE t.user_id = 42
GROUP BY t.name
ORDER BY note_count DESC;

-- 5. Create a note
INSERT INTO notes (user_id, title, body)
VALUES (42, 'Buy milk', '2 litres')
RETURNING id, created_at;
```

## SQL or NoSQL?

I choose **SQL (PostgreSQL)**. The data is clearly structured and relational: users own notes, and notes and tags form a many-to-many relationship that joins express naturally. We need integrity guarantees (foreign keys, unique emails and tag names, atomic note-plus-tag writes in one transaction), and a user's data is far from the size where a single primary with read replicas runs out of room: about 220 GB of notes per year at 1 million users. A document store such as MongoDB could embed tags inside each note, which makes single-note reads simple, but it would make "all notes with tag X" and tag renames harder and weaken consistency. If QuickNotes later outgrows one primary, we can shard by `user_id`, since almost every query is already scoped to one user.
