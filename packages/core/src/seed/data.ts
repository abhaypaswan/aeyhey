// SPDX-License-Identifier: AGPL-3.0-only
// Demo mode seed data (PRD 8.5 FR-DEMO-1).
//
// The point of demo mode is that someone can judge the product in thirty seconds with no
// key and no setup. That means the seed data has to look like a real pile: links of
// different ages and statuses, questions at different stages, and enough review history
// that the scheduling looks lived-in rather than brand new.
//
// Summaries here are pre-written, not generated, so demo mode makes no AI calls at all.

export interface SeedLink {
  url: string;
  title: string;
  siteName: string;
  contentType: "article" | "thread" | "video" | "paper" | "tool" | "docs" | "other";
  summaryLines: [string, string, string];
  whySaved: string;
  tags: string[];
  readMinutes: number;
  /** How long ago it was saved, in days. Spread out so the pile looks real. */
  savedDaysAgo: number;
  status?: "unread" | "snoozed" | "read" | "expiring";
  snoozeCount?: number;
  note?: string;
}

export const SEED_LINKS: SeedLink[] = [
  {
    url: "https://www.postgresql.org/docs/current/indexes-types.html",
    title: "Index types in Postgres",
    siteName: "postgresql.org",
    contentType: "docs",
    summaryLines: [
      "Postgres ships six index types, and b-tree is the default for a reason.",
      "GIN is for containment queries: jsonb, arrays and full text search.",
      "BRIN is for huge tables where the rows are already roughly ordered.",
    ],
    whySaved: "You probably saved this while deciding which index a slow query needed.",
    tags: ["postgres", "databases"],
    readMinutes: 9,
    savedDaysAgo: 12,
  },
  {
    url: "https://martinfowler.com/articles/patterns-of-distributed-systems/",
    title: "Patterns of distributed systems",
    siteName: "martinfowler.com",
    contentType: "article",
    summaryLines: [
      "A catalogue of the patterns behind consensus, replication and leader election.",
      "Each pattern has a problem, a solution and a real system that uses it.",
      "Useful as a reference rather than a read-through.",
    ],
    whySaved: "You probably saved this to have something solid to point at in design reviews.",
    tags: ["system-design", "distributed-systems"],
    readMinutes: 45,
    savedDaysAgo: 94,
    status: "snoozed",
    snoozeCount: 3,
  },
  {
    url: "https://x.com/jane_dev/status/1799999999999999999",
    title: "jane_dev: The fastest way to understand a codebase",
    siteName: "x.com",
    contentType: "thread",
    summaryLines: [
      "Read the tests before the source, because they say what the code is for.",
      "Then follow one request all the way through, end to end.",
      "Only then start reading files on their own.",
    ],
    whySaved: "You probably saved this when you were about to join a new codebase.",
    tags: ["career", "engineering"],
    readMinutes: 2,
    savedDaysAgo: 5,
  },
  {
    url: "https://www.youtube.com/watch?v=0SARbwvhupQ",
    title: "How Postgres handles concurrency",
    siteName: "youtube.com",
    contentType: "video",
    summaryLines: [
      "MVCC gives every transaction its own consistent snapshot of the data.",
      "Writers never block readers, which is the whole trick.",
      "The cost is dead tuples, which is why vacuum exists.",
    ],
    whySaved: "You probably saved this after an incident involving a long-running transaction.",
    tags: ["postgres", "databases"],
    readMinutes: 32,
    savedDaysAgo: 41,
  },
  {
    url: "https://arxiv.org/abs/1706.03762",
    title: "Attention is all you need",
    siteName: "arxiv.org",
    contentType: "paper",
    summaryLines: [
      "Introduces the transformer, which drops recurrence for self-attention entirely.",
      "Trains far faster than the recurrent models it replaced, and scores better.",
      "Every large language model since is a descendant of this architecture.",
    ],
    whySaved: "You probably saved this meaning to finally read the original paper.",
    tags: ["machine-learning", "papers"],
    readMinutes: 28,
    savedDaysAgo: 220,
    status: "expiring",
    snoozeCount: 5,
  },
  {
    url: "https://danluu.com/percentile-latency/",
    title: "Latency percentiles, and why the average lies",
    siteName: "danluu.com",
    contentType: "article",
    summaryLines: [
      "An average latency hides the requests that actually annoy people.",
      "p99 matters more than p50 once a page makes several calls.",
      "Tail latency compounds: ten p99 calls make a slow page likely, not rare.",
    ],
    whySaved: "You probably saved this to settle an argument about which metric to alert on.",
    tags: ["performance", "engineering"],
    readMinutes: 11,
    savedDaysAgo: 30,
    status: "read",
  },
  {
    url: "https://github.com/open-spaced-repetition/ts-fsrs",
    title: "ts-fsrs",
    siteName: "github.com",
    contentType: "tool",
    summaryLines: [
      "A TypeScript implementation of FSRS, the scheduler behind modern Anki.",
      "Takes a card and a rating, returns the next due date and the updated state.",
      "No dependencies, which is why it runs anywhere.",
    ],
    whySaved: "You probably saved this while looking for a spaced repetition library.",
    tags: ["tools", "spaced-repetition"],
    readMinutes: 4,
    savedDaysAgo: 2,
    note: "for the scheduler",
  },
  {
    url: "https://www.sqlite.org/whentouse.html",
    title: "When to use SQLite",
    siteName: "sqlite.org",
    contentType: "docs",
    summaryLines: [
      "SQLite suits most applications, not just small ones or embedded ones.",
      "It struggles with many concurrent writers, and nothing else.",
      "The authors are unusually honest about where it does not fit.",
    ],
    whySaved: "You probably saved this while choosing a database for a side project.",
    tags: ["databases", "sqlite"],
    readMinutes: 7,
    savedDaysAgo: 60,
    status: "snoozed",
    snoozeCount: 1,
  },
];

export interface SeedQuestion {
  text: string;
  modelAnswer: string;
  keyPoints: string[];
  category:
    | "technical"
    | "behavioral"
    | "system_design"
    | "project_deep_dive"
    | "concept"
    | "coding_concept";
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  resumeAnchor?: string;
  /** How many times it has been reviewed already, so scheduling looks real. */
  reviewHistory?: ("again" | "hard" | "good" | "easy")[];
}

export const SEED_RESUME_DECK: { name: string; questions: SeedQuestion[] } = {
  name: "Senior Backend Engineer prep",
  questions: [
    {
      text: "In your payments service, how did you stop a retried request charging the customer twice?",
      modelAnswer:
        "An idempotency key, supplied by the client and unique per logical operation. On the first request the server stores the key together with the response it produced, inside the same transaction as the charge. A repeat request with the same key finds that row and returns the stored response rather than charging again.\n\nThe details that matter: the key has to be stored atomically with the side effect, or a crash between the two reopens the hole. The stored response needs an expiry, because keeping every response forever is a slow leak. And a key that arrives with a different payload should be rejected rather than treated as a repeat, since that is a client bug worth surfacing.",
      keyPoints: [
        "Client supplies a unique idempotency key",
        "Key and response are stored in the same transaction as the side effect",
        "A repeat request returns the stored response instead of acting again",
        "A key reused with a different payload is an error, not a repeat",
      ],
      category: "project_deep_dive",
      difficulty: "medium",
      tags: ["apis", "payments"],
      resumeAnchor: "payments service",
      reviewHistory: ["good", "good"],
    },
    {
      text: "You migrated from MySQL to Postgres with no downtime. Walk me through how.",
      modelAnswer:
        "Dual write, backfill, verify, then cut over. Start writing to both databases while reads still come from MySQL, so Postgres begins accumulating new data. Backfill the history in batches, keeping an eye on replication lag. Then verify: compare row counts and checksums per table, and reconcile what disagrees.\n\nThe cutover itself is a read switch, ideally behind a flag you can flip back. Keep writing to both for a while afterwards, so a rollback is still possible without losing anything. The riskiest part is not the data, it is the differences in behaviour: the two databases disagree about collation, about how they handle zero dates, and about isolation level defaults, and each of those needs finding before cutover rather than after.",
      keyPoints: [
        "Dual write while reads stay on the old database",
        "Backfill history in batches",
        "Verify with counts or checksums before cutting over",
        "Switch reads behind something reversible",
        "Behaviour differences, not just data, are the real risk",
      ],
      category: "project_deep_dive",
      difficulty: "hard",
      tags: ["databases", "migrations"],
      resumeAnchor: "MySQL to Postgres migration",
      reviewHistory: ["hard", "good"],
    },
    {
      text: "What is the difference between a b-tree and a GIN index, and when would you reach for each?",
      modelAnswer:
        "A b-tree indexes whole values in sorted order, so it serves equality and range queries on a column: created_at between two dates, or status equals something. It is the default and it is usually right.\n\nA GIN index indexes the pieces inside a value, so it serves containment: does this jsonb document contain this key, does this array contain this element, does this text contain these words. The trade-off is write cost and disk. A GIN index is slower to update and larger, and it pays that back when your queries ask about what is inside a value rather than what the value is.",
      keyPoints: [
        "B-tree indexes whole values in order, for equality and ranges",
        "GIN indexes the parts inside a value, for containment",
        "GIN costs more to write and more disk",
        "Choose on the query shape, not the column type",
      ],
      category: "technical",
      difficulty: "medium",
      tags: ["postgres", "databases"],
      reviewHistory: ["good", "easy", "good"],
    },
    {
      text: "Design a rate limiter for an API with several instances behind a load balancer.",
      modelAnswer:
        "The hard part is that the counter has to be shared, so per-instance memory is out. A token bucket in Redis per key is the usual answer: one key per API key or IP, holding the token count and the last refill time, updated with a small Lua script so the read and the write are atomic.\n\nThen decide what happens when Redis is unavailable, and that is a product question rather than a technical one. Failing open lets abuse through; failing closed takes the API down because the limiter is down. Usually you fail open with a per-instance fallback limit, so there is still a ceiling.\n\nSliding window counters are more accurate than fixed windows at the boundary, and cost one more key. Always return the limit, the remaining count and a retry-after, because a limiter without those headers forces clients to guess.",
      keyPoints: [
        "State has to be shared, not per instance",
        "Token bucket or sliding window in a shared store",
        "The update must be atomic",
        "Decide deliberately whether to fail open or closed",
        "Return limit, remaining and retry-after headers",
      ],
      category: "system_design",
      difficulty: "hard",
      tags: ["system-design", "apis"],
      reviewHistory: ["again", "hard"],
    },
    {
      text: "Tell me about a time you made a technical decision you later regretted.",
      modelAnswer:
        "This is a STAR answer, and it should be a real one. Situation: the decision and what was at stake. Task: what you were trying to achieve. Action: what you chose, and why it looked right at the time, which is the part that makes the answer credible rather than performative. Result: what went wrong, how you found out, and what you did about it.\n\nUse a real example where you chose something for a good reason that turned out to be the wrong trade-off. The interviewer is checking whether you can judge your own work without either defending it or over-apologising, so finish with what you changed in how you decide, not just what you changed in the code.",
      keyPoints: [
        "A real example, structured as STAR",
        "Say why the decision looked right at the time",
        "Say how you found out it was wrong",
        "Finish with what changed in how you decide, not only the fix",
      ],
      category: "behavioral",
      difficulty: "medium",
      tags: ["behavioral", "career"],
    },
    {
      text: "Your notifications service sends about two million messages a day. What breaks first at ten times that?",
      modelAnswer:
        "Probably the database the queue lives in, or whatever single writer serialises the sends. At two million a day you are averaging about 23 a second, which almost anything handles; at twenty million you are at 230 a second average and the peaks are what matter.\n\nThe order I would look: the queue's write throughput, then the per-provider rate limits, which are a hard ceiling you cannot engineer around, then connection pool exhaustion as concurrency rises, then the retry storm that follows the first partial outage. That last one is the real risk, because a naive retry turns a provider blip into a self-inflicted outage.\n\nThe fixes are partitioning the queue by provider, a token bucket per provider, and retries with jitter and a circuit breaker.",
      keyPoints: [
        "Identify the bottleneck rather than guessing",
        "Provider rate limits are a hard ceiling",
        "Connection pool exhaustion as concurrency grows",
        "Retry storms turn a blip into an outage",
        "Partition, limit per provider, retry with jitter",
      ],
      category: "project_deep_dive",
      difficulty: "hard",
      tags: ["system-design", "scaling"],
      resumeAnchor: "notifications service",
    },
  ],
};

export const SEED_TOPIC_DECK: { name: string; questions: SeedQuestion[] } = {
  name: "Postgres and system design",
  questions: [
    {
      text: "What does MVCC actually do, and what does it cost?",
      modelAnswer:
        "Multi-version concurrency control gives every transaction a consistent snapshot of the database as it was when the transaction started. An update does not overwrite a row, it writes a new version of it, and each version carries the transaction ids that make it visible or invisible to a given snapshot.\n\nThat is why writers never block readers in Postgres, which is the main thing people want from it. The cost is dead tuples: old versions that no snapshot can see any more, taking up space. Vacuum reclaims them, and a table that is updated heavily without vacuum keeping up will bloat and slow down. Long-running transactions make this worse, because nothing older than the oldest live snapshot can be reclaimed.",
      keyPoints: [
        "Each transaction sees a consistent snapshot",
        "Updates write a new row version rather than overwriting",
        "Writers do not block readers",
        "The cost is dead tuples, which vacuum reclaims",
        "A long-running transaction stops vacuum reclaiming anything newer",
      ],
      category: "concept",
      difficulty: "medium",
      tags: ["postgres", "databases"],
      reviewHistory: ["good"],
    },
    {
      text: "Why can adding an index make a query slower?",
      modelAnswer:
        "Two ways. The first is writes: every index has to be updated on insert, update and delete, so an extra index is a tax on every write to that table. A table with eight indexes is slow to write to, and that is often the real cost.\n\nThe second is the planner. An index that looks useful can lead the planner to an index scan where a sequential scan would have been faster, usually because the statistics are stale or because the index is not selective enough. Reading 40 percent of a table through an index is slower than just reading the table, because of the random IO and the heap fetches. The planner usually gets this right, and gets it wrong when ANALYZE has not run recently.",
      keyPoints: [
        "Every index is a cost on every write",
        "A non-selective index scan can be slower than a sequential scan",
        "Random IO and heap fetches are why",
        "Stale statistics are the usual cause of a bad plan",
      ],
      category: "technical",
      difficulty: "medium",
      tags: ["postgres", "performance"],
    },
    {
      text: "Explain the difference between at-least-once and exactly-once delivery.",
      modelAnswer:
        "At-least-once means a message may arrive more than once but will not be lost: the sender retries until it gets an acknowledgement. At-most-once means it may be lost but never duplicated. Exactly-once delivery, across a network, is not achievable in general, because the sender cannot distinguish a lost message from a lost acknowledgement.\n\nWhat is achievable is exactly-once processing, built out of at-least-once delivery plus an idempotent consumer. The consumer records which message ids it has handled, in the same transaction as the effect, and ignores a repeat. So in practice you choose at-least-once and make the handler idempotent, and talk about exactly-once as a property of the processing rather than the transport.",
      keyPoints: [
        "At-least-once may duplicate, at-most-once may lose",
        "Exactly-once delivery is not achievable across a network",
        "The sender cannot tell a lost message from a lost ack",
        "Exactly-once processing comes from at-least-once plus an idempotent consumer",
      ],
      category: "concept",
      difficulty: "hard",
      tags: ["distributed-systems", "apis"],
      reviewHistory: ["hard", "hard", "good"],
    },
    {
      text: "When would you choose a queue over a direct call between two services?",
      modelAnswer:
        "When the caller does not need the result to continue, and when the two sides should be able to fail independently. A queue buys you three things: the caller returns immediately, a slow or down consumer does not take the caller down with it, and a burst is absorbed rather than rejected.\n\nWhat it costs is everything that comes with eventual consistency. The caller no longer knows whether the work succeeded, so you need somewhere to report failures. Ordering is no longer free. Debugging is harder, because the stack trace stops at the publish. And you have a new thing to operate.\n\nSo: a direct call for anything the user is waiting on and needs the answer to, a queue for work that can finish later, like sending email, generating a report or updating a search index.",
      keyPoints: [
        "Use a queue when the caller does not need the result",
        "It decouples failure and absorbs bursts",
        "The cost is eventual consistency and harder debugging",
        "Failures need somewhere to be reported",
        "Direct call for anything the user is waiting on",
      ],
      category: "system_design",
      difficulty: "medium",
      tags: ["system-design", "architecture"],
    },
    {
      text: "What is connection pooling, and why does Postgres need it more than most?",
      modelAnswer:
        "A pool keeps a set of open database connections and hands them out to requests, rather than each request opening its own. Opening a connection is slow, so this saves latency on every query.\n\nPostgres needs it more than most databases because every connection is a separate operating system process with its own memory, so a few hundred connections is genuinely expensive in a way that it is not for a threaded database. An application that opens a connection per request will exhaust max_connections and start refusing work long before the database runs out of capacity to answer queries.\n\nThe usual answer is a pool in the application plus pgbouncer in front for many application instances, in transaction mode so a connection is held only for the length of a transaction.",
      keyPoints: [
        "A pool reuses open connections instead of opening per request",
        "Each Postgres connection is a process with its own memory",
        "Connection count becomes the limit before query capacity does",
        "pgbouncer in transaction mode for many app instances",
      ],
      category: "technical",
      difficulty: "easy",
      tags: ["postgres", "performance"],
      reviewHistory: ["easy", "easy"],
    },
  ],
};

export const SEED_RESUME_TEXT = `Jane Roe
Senior Backend Engineer

Experience

Acme Payments, Senior Engineer, 2022 to now
Built the idempotency layer for the payments service, handling retries across three
payment providers. Brought duplicate charges to zero by keying every request and
storing the response alongside the charge.
Led the migration from MySQL to Postgres with no downtime, over four weeks of dual
writes and verification.
Owned the on-call rotation for the payments domain.

Previous Co, Engineer, 2019 to 2022
Owned the notifications service, sending about two million messages a day across
email, push and SMS.
Introduced structured logging and cut incident triage time roughly in half.
Built the internal rate limiter used by every outbound integration.

Skills
TypeScript, Go, Postgres, Redis, Kubernetes, Terraform, AWS, RabbitMQ

Education
BSc Computer Science`;
