# Discovery Platform — Starter Scaffold

## Flow

```
Landing (Client / Consultant)
  │
  ├─ Client → Q1: project name — type it, OR upload a .pdf/.docx brief
  │           and let AI pre-fill what it can find (you review & edit before it counts)
  │         → Q2: your role
  │         → any pre-filled answers matching your role, shown for review
  │         → remaining role-based questions, 4 options + "write your own answer"
  │         → submitted, forwarded to the consultant side
  │
  └─ Consultant → project list (readiness %, answered count)
               → click a project → FULL overview: readiness ring, every
                 answer grouped by domain, open gaps, PDF download
```

## Run it — copy/paste these

**Terminal 1 — backend (start this first):**
```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Terminal 2 — frontend:**
```powershell
cd frontend
npm install
npm run dev
```
Open the printed URL (`http://localhost:5173`).

## What's new in this version

1. **File upload + AI pre-fill.** On the project name step, switch to
   "Upload a document" — a `.pdf` or `.docx` gets sent to `POST /extract`,
   which reads the text and matches it against known questions. Matches
   show up on a review screen (`ReviewExtracted.tsx`) where you edit or
   confirm each one before it counts as answered — nothing gets silently
   accepted. Currently uses keyword matching (`extract_answers_from_text`
   in `backend/main.py`) so it works without any API key; swap that
   function for a real LLM call when you're ready — same input/output
   shape, same confidence field, nothing downstream changes.
2. **More questions per role** — up from 4 to 8-9 per role (see
   `frontend/src/data/questionBank.ts`), no artificial 4-question cap.
3. **Full consultant project view** (`ProjectDetail.tsx`) — readiness ring,
   every answer grouped by domain, a note on how many mandatory questions
   are still open, and the PDF download. Click any project card to open it.
4. **Visual polish** — fade-in transitions on every screen, a proper
   landing page mark, hover/lift effects on the landing cards.

## What's real vs. mocked

- **Real:** the full client → backend → consultant → PDF loop, including
  file upload and extraction. I ran this end-to-end before handing it to
  you (uploaded a test .docx, confirmed the right answers came back).
- **In-memory only:** backend storage resets on restart — swap for
  PostgreSQL before this is more than a local demo.
- **Mocked:** `mockConfidence()` (bank question confidence) and
  `extract_answers_from_text()` (document extraction) are both heuristics
  standing in for real LLM calls — same shape, ready to swap in.

## Is this ML, or just LLM + rules?

Just LLM + deterministic rules right now — no trained ML model, and there
shouldn't be one yet (no training data exists). The rules engine (question
bank, dependency graph, scoring formula) makes every decision about *what*
to ask; the LLM only ever interprets free text. See Part 16/24 of the
system design doc for where real ML models come in later, once real
session data exists.

## Installing Node.js / Python (if you don't have them)

- **Node.js:** [nodejs.org](https://nodejs.org/) → LTS installer → restart
  terminal → `node -v` should print a version.
- **Python:** [python.org/downloads](https://www.python.org/downloads/) →
  check "Add python.exe to PATH" during install → restart terminal →
  `python --version` should print a version.

## Using a real LLM (Grok / xAI)

Both the document-extraction pipeline and the free-text answer confidence
scoring can now call Grok instead of the keyword-matching fallback.

```powershell
cd backend
$env:XAI_API_KEY = "your-key-here"
uvicorn main:app --reload --port 8000
```

No key set → everything still works, just using the original heuristic
fallback (you'll see `"usedLLM": false` in `/extract` responses). Set the
key and it switches over automatically — nothing else to configure.

## What's new: Phase 1 ML-adjacent features

Straight from the "AI/ML Requirements Intelligence" design doc's own
staged rollout (Phase 1 = rules + LLM, no trained models yet — Phase 2+
needs real usage data first). What's implemented now, honestly:

- **Real next-best-question ranking** (`selectNextQuestion` in
  `data/questionBank.ts`) — replaces "first eligible question in list
  order" with an actual scored selection (domain criticality × mandatory
  weight). Same formula shape a future learned ranking model would plug
  into.
- **Rule-based gap prediction** (`GET /projects/{id}/gaps`) — a
  deterministic stand-in for the eventual XGBoost gap model, same output
  shape (`domain`, `gapProbability`), shown on the consultant's project
  view with a bar chart.
- **Consultant feedback capture** (`POST /projects/{id}/feedback`) —
  "Confirm real gap" / "Not applicable" buttons next to each predicted
  gap. Every click is a (prediction, human label) pair — this **is** the
  training data a real model gets built from later. This is the single
  most valuable thing to have running before any real ML work starts.
- **Similar projects** (`GET /projects/{id}/similar`) — Jaccard
  similarity over shared requirement domains. An honest stand-in for real
  BGE-M3 + pgvector embedding search until there's enough project volume
  (and a real database) to justify standing that up.

**Deliberately not built:** XGBoost models, BGE-M3 embeddings, pgvector,
LambdaMART ranking, contextual bandits. All of these need real training
data or real infrastructure (a persistent vector DB) that doesn't exist
yet — building them now would mean fitting models to zero real usage,
which is worse than not having them. The feedback capture above is what
makes building them for real, later, actually possible.

## What's new: adaptive questioning, explanations, and a real architecture diagram

Straight from your last set of requests:

1. **No more fixed question count.** Once the static, role-filtered bank
   runs out, the app calls `POST /next-question` — Grok decides, based on
   this specific project (a Spotify-like app gets asked about licensing,
   not more generic hosting questions), whether there's something useful
   left to ask, or whether to stop. Capped at 8 extra questions
   client-side as a safety net even if the model misbehaves — verified
   this actually works with two live test scenarios (a well-behaved model
   that says "done", and a misbehaving one that never does).
2. **"I don't understand this — explain it differently"** — under every
   question now. Calls `POST /explain-question`, shows a plain-language
   explanation inline. Doesn't count as an answer.
3. **Session summary** — after the last question, `POST /summarize`
   generates a 3-5 sentence third-person paragraph, shown to the client
   on the confirmation screen and saved with the project for the
   consultant.
4. **Real architecture diagrams** — the PDF's final page now calls Grok
   with the project's FULL answer set (not 4 hardcoded question IDs like
   before) and asks it to propose components that actually reflect what
   this project is. Verified with a real rendered PDF: a music-streaming
   project correctly got a "Licensing service" and "Streaming CDN"
   component instead of the old generic template.

All four fall back gracefully with no `XAI_API_KEY` set — dynamic
questioning stops immediately (honest: can't safely invent questions
without an LLM), explanations show a generic fallback, summaries use a
template, and the architecture diagram falls back to scanning whatever
domains were actually answered instead of just 4 fixed fields.

## Real database (Neon — free, no install, no admin rights needed)

1. Go to [neon.tech](https://neon.tech), sign up (free tier, no credit card).
2. Create a project — it gives you a connection string immediately, looks like:
   `postgresql://user:password@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require`
3. Set it as an environment variable before starting the backend:
   ```powershell
   $env:DATABASE_URL = "your-neon-connection-string-here"
   uvicorn main:app --reload --port 8000
   ```
4. Tables are created automatically on startup — nothing to run manually.

**No `DATABASE_URL` set → falls back to the original in-memory behavior**, exactly as before. This was tested against a real local Postgres instance before being handed to you: created a project, killed the process, started a completely fresh one, and confirmed the project, its answers, and its feedback were all still there — plus that gap prediction and PDF generation both still work unchanged on DB-backed data.

## Frontend engagement features

- **Domain-completion chips** — a strip above the progress bar showing every domain for your role, checked off (✓, green) as you answer questions in that area.
- **Milestone celebrations** — a brief toast at 25/50/75/100% ("🔥 Halfway done — great pace.").
- **Time estimate** — "~X min left", based on remaining questions.
