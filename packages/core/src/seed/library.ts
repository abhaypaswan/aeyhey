// SPDX-License-Identifier: AGPL-3.0-only
// The rest of the demo library: more links and more decks, across subjects far enough
// apart that the pile looks like one person's real learning and not a backend reading
// list. Distributed systems and a book on data systems sit next to class 11 physics,
// organic chemistry and how language models work.
//
// Tags are chosen to overlap on purpose. A Kafka article shares a tag with the questions
// on Kafka, a physics video with the mechanics deck, so anything that draws connections
// (the map, the stats by topic) has real ones to draw. Some questions carry a written
// answer and its score, so there are strong topics and weak ones.

import type { SeedLink, SeedQuestion } from "./data";

export interface SeedDeck {
  name: string;
  kind: "topics" | "document";
  /** For a topics deck, the topics it was written from, with the details given for each. */
  topics?: { name: string; details?: string }[];
  /** For a document deck, the title of what was uploaded. */
  documentTitle?: string;
  level: "beginner" | "intermediate" | "advanced";
  style: "study" | "interview" | "mixed";
  createdDaysAgo: number;
  questions: SeedQuestion[];
}

export const SEED_LIBRARY_LINKS: SeedLink[] = [
  // ------------------------------------------------------------ distributed systems
  {
    url: "https://kafka.apache.org/documentation/#design",
    title: "Kafka design: the log, partitions and consumer groups",
    siteName: "kafka.apache.org",
    contentType: "docs",
    summaryLines: [
      "Kafka is an append-only log split into partitions, each one ordered on its own.",
      "Consumers in a group share the partitions, so a partition is read by one of them at a time.",
      "Ordering is per partition, which is why the message key matters so much.",
    ],
    whySaved: "You probably saved this while choosing between a queue and a log for events.",
    tags: ["kafka", "distributed-systems", "messaging"],
    readMinutes: 18,
    savedDaysAgo: 9,
    status: "read",
  },
  {
    url: "https://raft.github.io/",
    title: "The Raft consensus algorithm",
    siteName: "raft.github.io",
    contentType: "paper",
    summaryLines: [
      "Raft splits consensus into leader election, log replication and safety.",
      "A leader is elected for a term and every write goes through it.",
      "It was designed to be easier to understand than Paxos, and it mostly is.",
    ],
    whySaved: "You probably saved this to finally understand how etcd stays consistent.",
    tags: ["consensus", "distributed-systems"],
    readMinutes: 25,
    savedDaysAgo: 16,
    status: "unread",
  },
  {
    url: "https://redis.io/docs/latest/develop/use/patterns/",
    title: "Caching patterns with Redis",
    siteName: "redis.io",
    contentType: "docs",
    summaryLines: [
      "Cache-aside is the default: read the cache, fall back to the database, then fill the cache.",
      "Write-through keeps the cache fresh at the cost of slower writes.",
      "Expiry and invalidation are where caches go wrong, not reads.",
    ],
    whySaved: "You probably saved this while fixing a stale-cache bug.",
    tags: ["caching", "redis", "system-design"],
    readMinutes: 12,
    savedDaysAgo: 4,
    status: "unread",
  },
  {
    url: "https://jepsen.io/consistency",
    title: "Consistency models, mapped",
    siteName: "jepsen.io",
    contentType: "article",
    summaryLines: [
      "A map of consistency models from strict serializability down to read-your-writes.",
      "Each model says which anomalies a database is allowed to show you.",
      "Most databases promise less than their marketing suggests.",
    ],
    whySaved: "You probably saved this after a debate about what linearizable really means.",
    tags: ["consistency", "distributed-systems", "databases"],
    readMinutes: 15,
    savedDaysAgo: 30,
    status: "snoozed",
    snoozeCount: 2,
  },
  {
    url: "https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html",
    title: "How to do distributed locking",
    siteName: "martin.kleppmann.com",
    contentType: "article",
    summaryLines: [
      "A lock with a timeout is not safe on its own, because a paused process can outlive it.",
      "Fencing tokens let the storage reject writes from a holder that lost the lock.",
      "Redlock does not give the guarantees people use it for.",
    ],
    whySaved: "You probably saved this before reaching for a Redis lock.",
    tags: ["distributed-systems", "redis", "consensus"],
    readMinutes: 14,
    savedDaysAgo: 2,
    status: "expiring",
  },
  {
    url: "https://dataintensive.net/",
    title: "Designing Data-Intensive Applications",
    siteName: "dataintensive.net",
    contentType: "other",
    summaryLines: [
      "The book on how databases, caches, queues and stream processors actually work.",
      "Part two, on replication and partitioning, is the most quoted in interviews.",
      "It trades vendor detail for the principles that outlast any one tool.",
    ],
    whySaved: "You probably saved this as the book to work through properly.",
    tags: ["databases", "replication", "distributed-systems"],
    readMinutes: 5,
    savedDaysAgo: 40,
    status: "read",
    note: "Reading chapter 5 next, replication",
  },
  {
    url: "https://www.youtube.com/watch?v=iJLL-KPqBpM",
    title: "Kafka in 100 seconds",
    siteName: "youtube.com",
    contentType: "video",
    summaryLines: [
      "Kafka is a distributed event log, not a message queue that deletes on read.",
      "Producers write to topics, consumers read at their own pace from an offset.",
      "Retention means you can replay history, which a queue cannot do.",
    ],
    whySaved: "You probably saved this as a quick refresher before an interview.",
    tags: ["kafka", "messaging"],
    readMinutes: 2,
    savedDaysAgo: 1,
    status: "unread",
  },

  // ------------------------------------------------------------ physics
  {
    url: "https://www.khanacademy.org/science/physics/forces-newtons-laws",
    title: "Forces and Newton's laws of motion",
    siteName: "khanacademy.org",
    contentType: "video",
    summaryLines: [
      "The three laws, worked through with free body diagrams.",
      "Most mistakes come from missing a force, not from the maths.",
      "Friction and normal force get their own careful examples.",
    ],
    whySaved: "You probably saved this to revise for the class 11 unit test.",
    tags: ["physics", "mechanics", "newtons-laws"],
    readMinutes: 40,
    savedDaysAgo: 12,
    status: "read",
  },
  {
    url: "http://hyperphysics.phy-astr.gsu.edu/hbase/rotq.html",
    title: "Rotational motion, the quantities",
    siteName: "hyperphysics.phy-astr.gsu.edu",
    contentType: "docs",
    summaryLines: [
      "Every linear quantity has a rotational twin: torque, moment of inertia, angular momentum.",
      "Moment of inertia depends on how mass is spread, not only on how much there is.",
      "Angular momentum is conserved when no external torque acts.",
    ],
    whySaved: "You probably saved this because rotational motion was the confusing chapter.",
    tags: ["physics", "mechanics", "rotational-motion"],
    readMinutes: 10,
    savedDaysAgo: 6,
    status: "unread",
  },
  {
    url: "https://www.feynmanlectures.caltech.edu/I_04.html",
    title: "Feynman Lectures, chapter 4: conservation of energy",
    siteName: "feynmanlectures.caltech.edu",
    contentType: "article",
    summaryLines: [
      "Energy is a number that stays the same, however things change around it.",
      "Feynman builds it from a child's blocks before any formula appears.",
      "Potential energy is introduced as bookkeeping, which is what it is.",
    ],
    whySaved: "You probably saved this to understand work and energy, not just memorise it.",
    tags: ["physics", "energy", "mechanics"],
    readMinutes: 30,
    savedDaysAgo: 20,
    status: "snoozed",
    snoozeCount: 1,
  },

  // ------------------------------------------------------------ chemistry
  {
    url: "https://www.khanacademy.org/science/organic-chemistry/gen-chem-review/hybrid-orbitals-jay/v/sp3-hybridized-orbitals-and-sigma-bonds",
    title: "sp3 hybridised orbitals and sigma bonds",
    siteName: "khanacademy.org",
    contentType: "video",
    summaryLines: [
      "Carbon mixes one s and three p orbitals into four equal sp3 orbitals.",
      "That is why methane is a tetrahedron with 109.5 degree angles.",
      "Sigma bonds come from head-on overlap and allow free rotation.",
    ],
    whySaved: "You probably saved this when hybridisation stopped making sense.",
    tags: ["chemistry", "organic-chemistry", "hybridisation"],
    readMinutes: 12,
    savedDaysAgo: 8,
    status: "read",
  },
  {
    url: "https://www.masterorganicchemistry.com/2012/08/08/comparing-the-sn1-and-sn2-reactions/",
    title: "Comparing the SN1 and SN2 reactions",
    siteName: "masterorganicchemistry.com",
    contentType: "article",
    summaryLines: [
      "SN2 is one step with a backside attack, so it inverts the stereocentre.",
      "SN1 goes through a carbocation, so it favours tertiary carbons and gives a mix.",
      "The substrate, the nucleophile and the solvent decide which one wins.",
    ],
    whySaved: "You probably saved this because SN1 and SN2 kept getting mixed up.",
    tags: ["chemistry", "organic-chemistry", "reaction-mechanisms"],
    readMinutes: 9,
    savedDaysAgo: 3,
    status: "unread",
  },
  {
    url: "https://chem.libretexts.org/Bookshelves/Organic_Chemistry/Map%3A_Organic_Chemistry_(Wade)/05%3A_Stereochemistry",
    title: "Stereochemistry: chirality and isomers",
    siteName: "chem.libretexts.org",
    contentType: "docs",
    summaryLines: [
      "A chiral molecule is not superimposable on its mirror image.",
      "R and S come from ranking the groups by the Cahn-Ingold-Prelog rules.",
      "Enantiomers share every property except how they rotate light and react with other chiral things.",
    ],
    whySaved: "You probably saved this to practise assigning R and S.",
    tags: ["chemistry", "organic-chemistry", "isomerism"],
    readMinutes: 20,
    savedDaysAgo: 25,
    status: "unread",
  },

  // ------------------------------------------------------------ machine learning
  {
    url: "https://jalammar.github.io/illustrated-transformer/",
    title: "The Illustrated Transformer",
    siteName: "jalammar.github.io",
    contentType: "article",
    summaryLines: [
      "The transformer, explained one diagram at a time.",
      "Self-attention lets every word look at every other word in one step.",
      "Multiple heads let the model attend to different relationships at once.",
    ],
    whySaved: "You probably saved this as the clearest explanation of attention.",
    tags: ["machine-learning", "transformers", "attention"],
    readMinutes: 20,
    savedDaysAgo: 11,
    status: "read",
  },
  {
    url: "https://www.youtube.com/watch?v=zduSFxRajkE",
    title: "Let's build the GPT tokenizer",
    siteName: "youtube.com",
    contentType: "video",
    summaryLines: [
      "Byte pair encoding merges the most frequent pairs of bytes, over and over.",
      "Many odd model behaviours, from spelling to arithmetic, trace back to tokenisation.",
      "The tokenizer is trained separately from the model, on its own data.",
    ],
    whySaved: "You probably saved this to understand why models cannot count letters.",
    tags: ["machine-learning", "llms", "tokenisation"],
    readMinutes: 133,
    savedDaysAgo: 18,
    status: "snoozed",
    snoozeCount: 3,
  },
  {
    url: "https://huggingface.co/docs/peft/index",
    title: "Parameter-efficient fine-tuning (PEFT)",
    siteName: "huggingface.co",
    contentType: "docs",
    summaryLines: [
      "Fine-tune a large model by training a small number of extra parameters.",
      "LoRA adds low-rank matrices beside the frozen weights.",
      "It cuts memory enough to fine-tune on a single consumer GPU.",
    ],
    whySaved: "You probably saved this for the side project that needs a tuned model.",
    tags: ["machine-learning", "llms", "fine-tuning"],
    readMinutes: 15,
    savedDaysAgo: 5,
    status: "unread",
  },

  // ------------------------------------------------------------ learning itself
  {
    url: "https://ncase.me/remember/",
    title: "How to remember anything forever-ish",
    siteName: "ncase.me",
    contentType: "article",
    summaryLines: [
      "An interactive comic on the forgetting curve and spaced repetition.",
      "Reviewing just before you forget makes each memory last longer.",
      "A few minutes a day beats hours the night before.",
    ],
    whySaved: "You probably saved this because it is why you use Aeyhey at all.",
    tags: ["learning", "spaced-repetition"],
    readMinutes: 25,
    savedDaysAgo: 50,
    status: "read",
  },
  {
    url: "https://www.gwern.net/Spaced-repetition",
    title: "Spaced repetition for efficient learning",
    siteName: "gwern.net",
    contentType: "article",
    summaryLines: [
      "A long review of the research on spacing and testing effects.",
      "Testing yourself beats rereading, by a wide margin.",
      "The gains are biggest for facts you would otherwise forget.",
    ],
    whySaved: "You probably saved this for the evidence behind spaced repetition.",
    tags: ["learning", "spaced-repetition"],
    readMinutes: 60,
    savedDaysAgo: 35,
    status: "unread",
  },
  {
    url: "https://www.youtube.com/watch?v=ukLnPbIffxE",
    title: "How to study for exams: active recall",
    siteName: "youtube.com",
    contentType: "video",
    summaryLines: [
      "Rereading feels productive and works badly; recalling works.",
      "Close the book and write what you remember, then check.",
      "Mix topics in a session rather than doing one at a time.",
    ],
    whySaved: "You probably saved this before exam season.",
    tags: ["learning", "active-recall", "exams"],
    readMinutes: 11,
    savedDaysAgo: 7,
    status: "unread",
  },
];

/** A written answer for the seed, with its score; the verdict follows from the score. */
const answered = (text: string, score: number): { text: string; score: number } => ({
  text,
  score,
});

export const SEED_LIBRARY_DECKS: SeedDeck[] = [
  {
    name: "Distributed systems",
    kind: "topics",
    topics: [
      {
        name: "Kafka",
        details: "For backend interviews, focus on ordering and delivery guarantees.",
      },
      { name: "Consensus" },
      { name: "Caching", details: "Redis in production, invalidation and stampedes." },
    ],
    level: "advanced",
    style: "interview",
    createdDaysAgo: 10,
    questions: [
      {
        text: "How does Kafka keep messages in order, and when does it not?",
        modelAnswer:
          "Kafka only orders messages within a partition. Messages with the same key go to the same partition, so they stay in order, while messages across partitions have no order between them. Retries with more than one request in flight can reorder writes unless the idempotent producer is on.",
        keyPoints: [
          "Order is per partition only",
          "The key picks the partition",
          "Retries can reorder without the idempotent producer",
        ],
        category: "technical",
        difficulty: "medium",
        tags: ["kafka", "messaging", "distributed-systems"],
        reviewHistory: ["good", "good"],
        answer: answered(
          "Within a partition messages are ordered, and the key decides the partition. Across partitions there is no ordering.",
          82,
        ),
      },
      {
        text: "What does exactly-once mean in Kafka, and what does it cost?",
        modelAnswer:
          "It combines the idempotent producer, which drops duplicate retries, with transactions that commit the output and the consumer offsets together. A consume-process-produce loop then either fully happens or does not. The cost is latency and throughput, and it only covers Kafka to Kafka: a side effect in another system can still happen twice.",
        keyPoints: [
          "Idempotent producer plus transactions",
          "Offsets are committed atomically with the output",
          "Only covers Kafka to Kafka",
        ],
        category: "technical",
        difficulty: "hard",
        tags: ["kafka", "distributed-systems"],
        reviewHistory: ["again", "hard"],
        answer: answered("Kafka never sends a message twice because of acknowledgements.", 28),
      },
      {
        text: "In Raft, what happens when the leader crashes?",
        modelAnswer:
          "Followers stop hearing heartbeats, and after a randomised election timeout one becomes a candidate for a new term and asks for votes. It wins with a majority, and only a node whose log is at least as up to date as the majority can win, so committed entries are never lost.",
        keyPoints: [
          "Election timeout, then a new term",
          "A majority vote is needed",
          "Only an up-to-date log can win, so commits survive",
        ],
        category: "concept",
        difficulty: "medium",
        tags: ["consensus", "distributed-systems"],
        reviewHistory: ["hard", "good", "good", "easy"],
        answer: answered(
          "A follower times out, starts an election for the next term, and needs a majority. Only an up-to-date log can win.",
          91,
        ),
      },
      {
        text: "What is a cache stampede, and how do you prevent one?",
        modelAnswer:
          "When a popular key expires, many requests miss at once and all hit the database to rebuild it. Prevent it by letting one request rebuild while others wait or get the stale value, by refreshing early before expiry, or by adding jitter to expiry times so keys do not expire together.",
        keyPoints: [
          "Many misses at once on a hot key",
          "One rebuilder, others wait or serve stale",
          "Early refresh and jittered expiry",
        ],
        category: "system_design",
        difficulty: "medium",
        tags: ["caching", "redis", "system-design"],
        reviewHistory: ["good"],
      },
      {
        text: "Why is a Redis lock with a timeout not enough on its own?",
        modelAnswer:
          "A process can pause, for garbage collection or a slow network, for longer than the lock's timeout. The lock expires, another process takes it, and the first one wakes and writes anyway. A fencing token, a number that grows with each lock, lets the storage reject writes from the older holder.",
        keyPoints: [
          "Pauses can outlive the timeout",
          "Two holders can then write",
          "Fencing tokens let storage reject stale writers",
        ],
        category: "concept",
        difficulty: "hard",
        tags: ["redis", "distributed-systems", "consensus"],
      },
    ],
  },
  {
    name: "Designing Data-Intensive Applications, chapter 5",
    kind: "document",
    documentTitle: "Designing Data-Intensive Applications, chapter 5: Replication",
    level: "advanced",
    style: "study",
    createdDaysAgo: 25,
    questions: [
      {
        text: "What is replication lag, and what anomalies can it cause for a user?",
        modelAnswer:
          "With asynchronous replication a follower can be behind the leader. A user can then fail to see their own write, see data go backwards between two reads from different followers, or see an answer before the question it replies to.",
        keyPoints: [
          "Followers can be behind the leader",
          "Reading your own writes can fail",
          "Monotonic reads and consistent prefix can break",
        ],
        category: "concept",
        difficulty: "medium",
        tags: ["replication", "databases", "consistency"],
        reviewHistory: ["good", "good", "good", "easy", "easy"],
        answer: answered(
          "Followers lag, so you might not see your own write, or see time go backwards across followers.",
          88,
        ),
      },
      {
        text: "How does leaderless replication decide what a read returns?",
        modelAnswer:
          "Writes go to several replicas and reads ask several. With n replicas, w write acknowledgements and r read responses, w plus r greater than n means at least one replica read has the latest write, and version numbers pick it. Read repair and anti-entropy bring stale replicas up to date.",
        keyPoints: [
          "Quorums: w plus r greater than n",
          "Versions pick the newest value",
          "Read repair and anti-entropy fix stale replicas",
        ],
        category: "concept",
        difficulty: "hard",
        tags: ["replication", "distributed-systems", "consistency"],
        reviewHistory: ["again"],
        answer: answered("It asks the leader for the newest value.", 18),
      },
      {
        text: "Why is failover in single-leader replication dangerous?",
        modelAnswer:
          "If the old leader had writes the new one never received, those writes are lost or conflict when it returns. Two nodes can both believe they are leader, split brain. And picking the timeout is hard: too short causes needless failovers under load, too long means a long outage.",
        keyPoints: [
          "Unreplicated writes can be lost",
          "Split brain",
          "The timeout is a hard trade-off",
        ],
        category: "concept",
        difficulty: "medium",
        tags: ["replication", "databases"],
        reviewHistory: ["hard", "good"],
        answer: answered("Writes can be lost and you can get two leaders.", 62),
      },
      {
        text: "What is the difference between synchronous and asynchronous replication?",
        modelAnswer:
          "Synchronous replication waits for a follower to confirm before acknowledging a write, so that follower is always up to date, but one slow follower stalls every write. Asynchronous replication acknowledges at once, which is faster but can lose recent writes if the leader fails.",
        keyPoints: [
          "Synchronous waits for the follower",
          "Asynchronous acknowledges at once",
          "Durability against latency",
        ],
        category: "concept",
        difficulty: "easy",
        tags: ["replication", "databases"],
        reviewHistory: ["good", "easy", "easy", "easy"],
      },
    ],
  },
  {
    name: "Class 11 Physics: mechanics",
    kind: "topics",
    topics: [
      { name: "Newton's laws", details: "CBSE class 11, with numericals in SI units." },
      { name: "Work, energy and power" },
      { name: "Rotational motion" },
    ],
    level: "beginner",
    style: "study",
    createdDaysAgo: 15,
    questions: [
      {
        text: "A 2 kg block is pushed with 10 N on a floor with 4 N of friction. What is its acceleration?",
        modelAnswer:
          "The net force is 10 N minus 4 N, which is 6 N. By Newton's second law, a equals F divided by m, so 6 N over 2 kg is 3 metres per second squared, in the direction of the push.",
        keyPoints: ["Net force is 6 N", "a = F / m", "3 m/s squared along the push"],
        category: "concept",
        difficulty: "easy",
        tags: ["physics", "mechanics", "newtons-laws"],
        reviewHistory: ["good", "good", "easy", "easy"],
        answer: answered("Net force 6 N, so a = 6 / 2 = 3 m/s².", 96),
      },
      {
        text: "Why does a passenger lurch forward when a bus brakes suddenly?",
        modelAnswer:
          "Inertia, Newton's first law. The bus slows because of the brakes, but the passenger's body keeps moving forward at the old speed until friction with the seat and floor acts on it. Nothing pushes the passenger forward; the bus slows down under them.",
        keyPoints: [
          "Newton's first law, inertia",
          "The body keeps its motion",
          "Nothing pushes it forward",
        ],
        category: "concept",
        difficulty: "easy",
        tags: ["physics", "newtons-laws"],
        reviewHistory: ["good", "good"],
      },
      {
        text: "State the work-energy theorem and use it for a 1 kg ball dropped from 5 m.",
        modelAnswer:
          "The work done by the net force equals the change in kinetic energy. Gravity does m g h of work, 1 times 9.8 times 5, which is 49 J, so the ball reaches the ground with 49 J of kinetic energy, a speed of about 9.9 m/s.",
        keyPoints: [
          "Net work equals change in kinetic energy",
          "W = m g h = 49 J",
          "v is about 9.9 m/s",
        ],
        category: "concept",
        difficulty: "medium",
        tags: ["physics", "energy", "mechanics"],
        reviewHistory: ["hard", "good"],
        answer: answered("Work equals change in KE. mgh = 49 J so v = sqrt(98).", 74),
      },
      {
        text: "Why does a figure skater spin faster when she pulls her arms in?",
        modelAnswer:
          "No external torque acts, so angular momentum, I times omega, stays constant. Pulling her arms in moves mass closer to the axis and lowers her moment of inertia, so her angular speed must rise to keep the product the same.",
        keyPoints: [
          "No external torque, so angular momentum is conserved",
          "Arms in lowers the moment of inertia",
          "Omega rises to keep I omega constant",
        ],
        category: "concept",
        difficulty: "medium",
        tags: ["physics", "rotational-motion", "mechanics"],
        reviewHistory: ["again", "hard"],
        answer: answered("Because her energy increases when she pulls her arms in.", 35),
      },
      {
        text: "What is the moment of inertia of a thin ring about its central axis, and why?",
        modelAnswer:
          "M R squared. Every bit of the ring's mass sits at the same distance R from the axis, so summing m r squared over the ring gives the total mass times R squared.",
        keyPoints: ["I = M R squared", "All mass at the same distance R", "Sum of m r squared"],
        category: "concept",
        difficulty: "medium",
        tags: ["physics", "rotational-motion"],
      },
    ],
  },
  {
    name: "Organic chemistry basics",
    kind: "topics",
    topics: [
      { name: "Hybridisation" },
      { name: "Reaction mechanisms", details: "SN1, SN2, E1 and E2, at NEET level." },
      { name: "Isomerism" },
    ],
    level: "intermediate",
    style: "study",
    createdDaysAgo: 8,
    questions: [
      {
        text: "What is the hybridisation of carbon in ethene, and what shape does it give?",
        modelAnswer:
          "sp2. Each carbon mixes one s and two p orbitals into three sp2 orbitals in a plane at 120 degrees, and keeps one p orbital that forms the pi bond. The molecule is flat.",
        keyPoints: [
          "sp2",
          "Trigonal planar, 120 degrees",
          "The leftover p orbital forms the pi bond",
        ],
        category: "concept",
        difficulty: "easy",
        tags: ["chemistry", "organic-chemistry", "hybridisation"],
        reviewHistory: ["good", "easy"],
        answer: answered(
          "sp2, planar with 120 degree angles, the p orbital makes the pi bond.",
          93,
        ),
      },
      {
        text: "Why does a tertiary alkyl halide react by SN1 and not SN2?",
        modelAnswer:
          "Three alkyl groups crowd the back of the carbon, so a nucleophile cannot make the backside attack SN2 needs. They also stabilise a carbocation by induction and hyperconjugation, which makes the SN1 route, through that carbocation, easy.",
        keyPoints: [
          "Steric hindrance blocks backside attack",
          "Tertiary carbocations are stable",
          "So the carbocation route wins",
        ],
        category: "concept",
        difficulty: "medium",
        tags: ["chemistry", "organic-chemistry", "reaction-mechanisms"],
        reviewHistory: ["again"],
        answer: answered("Because tertiary halides are more reactive.", 22),
      },
      {
        text: "What does SN2 do to the configuration of a chiral carbon?",
        modelAnswer:
          "It inverts it, like an umbrella turning inside out in the wind. The nucleophile attacks from the side opposite the leaving group, so the other three groups flip over in the transition state.",
        keyPoints: ["Inversion of configuration", "Backside attack", "Walden inversion"],
        category: "concept",
        difficulty: "medium",
        tags: ["chemistry", "reaction-mechanisms", "isomerism"],
        reviewHistory: ["hard"],
        answer: answered("It inverts it because the nucleophile comes from the back.", 70),
      },
      {
        text: "What is the difference between enantiomers and diastereomers?",
        modelAnswer:
          "Enantiomers are non-superimposable mirror images, differing at every chiral centre, with identical physical properties apart from optical rotation. Diastereomers are stereoisomers that are not mirror images, differing at some centres only, and they have different physical properties.",
        keyPoints: [
          "Enantiomers are mirror images",
          "Diastereomers are not",
          "Diastereomers differ in physical properties",
        ],
        category: "concept",
        difficulty: "medium",
        tags: ["chemistry", "isomerism"],
      },
    ],
  },
  {
    name: "Transformers and LLMs",
    kind: "topics",
    topics: [{ name: "Attention" }, { name: "Tokenisation" }, { name: "Fine-tuning" }],
    level: "intermediate",
    style: "mixed",
    createdDaysAgo: 6,
    questions: [
      {
        text: "In self-attention, what are the queries, keys and values?",
        modelAnswer:
          "Three projections of each token's vector. A token's query is compared with every token's key to get attention weights, by a scaled dot product and a softmax, and those weights mix the tokens' values into the output for that token.",
        keyPoints: [
          "Three learned projections of each token",
          "Query against keys gives the weights",
          "Weights mix the values",
        ],
        category: "concept",
        difficulty: "medium",
        tags: ["machine-learning", "transformers", "attention"],
        reviewHistory: ["good", "good", "easy"],
        answer: answered(
          "Each token gets a query, key and value. Query dot keys, softmax, then a weighted sum of values.",
          86,
        ),
      },
      {
        text: "Why is attention scaled by the square root of the key dimension?",
        modelAnswer:
          "Dot products grow with the dimension, and large values push the softmax into regions where it is nearly one-hot and the gradients are tiny. Dividing by the square root of the dimension keeps the scores at a sensible size.",
        keyPoints: [
          "Dot products grow with dimension",
          "Softmax saturates",
          "Scaling keeps gradients usable",
        ],
        category: "concept",
        difficulty: "hard",
        tags: ["transformers", "attention"],
        reviewHistory: ["hard"],
        answer: answered("To normalise the output.", 40),
      },
      {
        text: "Why do language models struggle to count the letters in a word?",
        modelAnswer:
          "They never see letters. Text is split into tokens, often whole words or chunks of them, so the model sees a few token ids rather than a sequence of characters, and has to have learned each token's spelling to count anything in it.",
        keyPoints: [
          "Models see tokens, not characters",
          "A word may be one token",
          "Spelling has to be learned",
        ],
        category: "concept",
        difficulty: "easy",
        tags: ["llms", "tokenisation"],
      },
      {
        text: "What does LoRA change when fine-tuning a model?",
        modelAnswer:
          "It freezes the original weights and learns a low-rank update beside each chosen weight matrix, two small matrices whose product is added to it. Only those small matrices are trained, which cuts memory and lets one base model carry many small adapters.",
        keyPoints: [
          "Base weights are frozen",
          "A low-rank update is learned",
          "Far fewer trainable parameters",
        ],
        category: "concept",
        difficulty: "medium",
        tags: ["llms", "fine-tuning", "machine-learning"],
        reviewHistory: ["good"],
      },
    ],
  },
];
