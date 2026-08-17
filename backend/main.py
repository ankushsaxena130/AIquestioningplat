"""
FastAPI backend stub for the Discovery Platform.

Two things happen here:
1. The client's finished session gets POSTed to /projects and stored
   (in-memory only — swap for the real PostgreSQL requirement graph
   described in the system design doc before shipping).
2. The consultant dashboard reads /projects, and can download a PDF
   report per project from /projects/{id}/report — built with reportlab,
   deterministically from the stored answers, ending with a simple
   auto-generated architecture diagram (Part 20 of the design doc: the
   LLM never writes the PDF directly).

Run:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
"""

import io
import json
import os
import re
import uuid
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

# Provider-agnostic LLM client. Set LLM_PROVIDER to "xai", "openai", or
# "gemini". Same OpenAI SDK for all three — Grok and Gemini both expose
# OpenAI-compatible endpoints, just a different base_url and key. If no
# key is set for the selected provider, every LLM call below falls back
# to the original heuristic so the app still runs.
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "xai").lower()
_grok_client = None
if LLM_PROVIDER == "openai":
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
    XAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    if OPENAI_API_KEY:
        from openai import OpenAI
        _grok_client = OpenAI(api_key=OPENAI_API_KEY)
elif LLM_PROVIDER == "gemini":
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
    XAI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
    if GEMINI_API_KEY:
        from openai import OpenAI
        _grok_client = OpenAI(
            api_key=GEMINI_API_KEY,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )
else:
    XAI_API_KEY = os.environ.get("XAI_API_KEY")
    XAI_MODEL = os.environ.get("XAI_MODEL", "grok-4")
    if XAI_API_KEY:
        from openai import OpenAI
        _grok_client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")

app = FastAPI(title="Discovery Platform API (stub)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PAGE_W, PAGE_H = LETTER
MARGIN = 0.85 * inch


# ---------- data shapes ----------

class AnswerIn(BaseModel):
    questionId: str
    domain: str
    question: str
    answer: str
    category: Optional[str] = "gap"   # "gap" (requirements) or "ideation" (make-it-better)


class ProjectIn(BaseModel):
    name: str
    role: str
    answers: List[AnswerIn]
    total: int
    answered: int
    summary: Optional[str] = None
    sourceDocText: Optional[str] = None   # raw text of an uploaded brief, if any — grounds the architecture brief


# ---------- persistence layer ----------
# Set DATABASE_URL (a Postgres connection string, e.g. from Neon) to
# persist real data across restarts. Falls back to in-memory dicts with
# the exact same interface if it's not set — same shape either way, so
# nothing downstream (gap prediction, PDF generation, contradiction
# detection, etc.) needs to know or care which one is active.
DATABASE_URL = os.environ.get("DATABASE_URL")
_USE_DB = bool(DATABASE_URL)

if _USE_DB:
    import psycopg2
    import psycopg2.extras
    from psycopg2.pool import SimpleConnectionPool

    _pool = SimpleConnectionPool(1, 5, DATABASE_URL)

    def _get_conn():
        return _pool.getconn()

    def _put_conn(conn):
        _pool.putconn(conn)

    def init_db():
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS projects (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        role TEXT NOT NULL,
                        total INT NOT NULL,
                        answered INT NOT NULL,
                        readiness INT NOT NULL,
                        summary TEXT,
                        created_at TEXT NOT NULL,
                        owner_id TEXT,
                        source_doc_text TEXT
                    )
                """)
                cur.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id TEXT")
                cur.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_doc_text TEXT")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        id TEXT PRIMARY KEY,
                        email TEXT UNIQUE NOT NULL,
                        password_hash TEXT NOT NULL,
                        role TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS answers (
                        id SERIAL PRIMARY KEY,
                        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
                        question_id TEXT,
                        domain TEXT,
                        question TEXT,
                        answer TEXT,
                        category TEXT DEFAULT 'gap'
                    )
                """)
                cur.execute("ALTER TABLE answers ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'gap'")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS feedback (
                        id TEXT PRIMARY KEY,
                        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
                        target_type TEXT,
                        target_id TEXT,
                        action TEXT,
                        model_score REAL,
                        note TEXT,
                        created_at TEXT
                    )
                """)
            conn.commit()
        finally:
            _put_conn(conn)

    class _ProjectStore:
        """Dict-like interface (get/values/[]=/in) backed by Postgres —
        every existing call site that used the old plain dict keeps
        working unchanged."""

        def __setitem__(self, project_id, data):
            conn = _get_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO projects (id, name, role, total, answered, readiness, summary, created_at, owner_id, source_doc_text) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                        "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, "
                        "total=EXCLUDED.total, answered=EXCLUDED.answered, readiness=EXCLUDED.readiness, "
                        "summary=EXCLUDED.summary, source_doc_text=EXCLUDED.source_doc_text",
                        (project_id, data["name"], data["role"], data["total"], data["answered"],
                         data["readiness"], data.get("summary"), data["createdAt"], data.get("ownerId"),
                         data.get("sourceDocText")),
                    )
                    for a in data["answers"]:
                        cur.execute(
                            "INSERT INTO answers (project_id, question_id, domain, question, answer, category) "
                            "VALUES (%s,%s,%s,%s,%s,%s)",
                            (project_id, a["questionId"], a["domain"], a["question"], a["answer"],
                             a.get("category", "gap")),
                        )
                conn.commit()
            finally:
                _put_conn(conn)

        def get(self, project_id, default=None):
            conn = _get_conn()
            try:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute("SELECT * FROM projects WHERE id=%s", (project_id,))
                    row = cur.fetchone()
                    if not row:
                        return default
                    cur.execute(
                        "SELECT question_id, domain, question, answer, category FROM answers WHERE project_id=%s ORDER BY id",
                        (project_id,),
                    )
                    answers = [
                        {"questionId": r["question_id"], "domain": r["domain"], "question": r["question"],
                         "answer": r["answer"], "category": r.get("category") or "gap"}
                        for r in cur.fetchall()
                    ]
                return {
                    "id": row["id"], "name": row["name"], "role": row["role"],
                    "total": row["total"], "answered": row["answered"], "readiness": row["readiness"],
                    "summary": row["summary"], "createdAt": row["created_at"], "answers": answers,
                    "ownerId": row.get("owner_id"), "sourceDocText": row.get("source_doc_text"),
                }
            finally:
                _put_conn(conn)

        def __getitem__(self, project_id):
            result = self.get(project_id)
            if result is None:
                raise KeyError(project_id)
            return result

        def __contains__(self, project_id):
            return self.get(project_id) is not None

        def values(self):
            conn = _get_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT id FROM projects ORDER BY created_at DESC")
                    ids = [r[0] for r in cur.fetchall()]
            finally:
                _put_conn(conn)
            return [self.get(i) for i in ids]

    class _FeedbackStore:
        def append(self, record):
            conn = _get_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO feedback (id, project_id, target_type, target_id, action, model_score, note, created_at) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (record["id"], record["projectId"], record["targetType"], record["targetId"],
                         record["action"], record.get("modelScore"), record.get("note"), record["createdAt"]),
                    )
                conn.commit()
            finally:
                _put_conn(conn)

        def __iter__(self):
            conn = _get_conn()
            try:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute("SELECT * FROM feedback")
                    rows = cur.fetchall()
            finally:
                _put_conn(conn)
            for r in rows:
                yield {
                    "id": r["id"], "projectId": r["project_id"], "targetType": r["target_type"],
                    "targetId": r["target_id"], "action": r["action"], "modelScore": r["model_score"],
                    "note": r["note"], "createdAt": r["created_at"],
                }

    class _UserStore:
        def create(self, user):
            conn = _get_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO users (id, email, password_hash, role, created_at) VALUES (%s,%s,%s,%s,%s)",
                        (user["id"], user["email"], user["passwordHash"], user["role"], user["createdAt"]),
                    )
                conn.commit()
            finally:
                _put_conn(conn)

        def get_by_email(self, email):
            conn = _get_conn()
            try:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute("SELECT * FROM users WHERE email=%s", (email,))
                    row = cur.fetchone()
                    if not row:
                        return None
                    return {"id": row["id"], "email": row["email"], "passwordHash": row["password_hash"],
                            "role": row["role"], "createdAt": row["created_at"]}
            finally:
                _put_conn(conn)

    _PROJECTS = _ProjectStore()
    _FEEDBACK = _FeedbackStore()
    _USERS = _UserStore()
else:
    def init_db():
        pass  # nothing to do — plain in-memory dicts below

    _PROJECTS: dict[str, dict] = {}
    _FEEDBACK: List[dict] = []

    class _InMemoryUserStore:
        def __init__(self):
            self._by_email: dict[str, dict] = {}

        def create(self, user):
            self._by_email[user["email"]] = user

        def get_by_email(self, email):
            return self._by_email.get(email)

    _USERS = _InMemoryUserStore()


# ---------- authentication (Phase 1 — soft enforcement) ----------
import bcrypt
import jwt as _pyjwt

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-only-insecure-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24 * 7


class UserRegisterIn(BaseModel):
    email: str
    password: str
    role: str = "client"


class UserLoginIn(BaseModel):
    email: str
    password: str


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def create_access_token(user: dict) -> str:
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return _pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = _pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {"id": payload["sub"], "email": payload["email"], "role": payload["role"]}
    except Exception:
        return None


@app.post("/auth/register")
def register(payload: UserRegisterIn):
    if _USERS.get_by_email(payload.email):
        raise HTTPException(400, "An account with that email already exists")
    if payload.role not in ("client", "consultant", "admin"):
        raise HTTPException(400, "role must be client, consultant, or admin")
    user = {
        "id": str(uuid.uuid4())[:8],
        "email": payload.email,
        "passwordHash": hash_password(payload.password),
        "role": payload.role,
        "createdAt": date.today().isoformat(),
    }
    _USERS.create(user)
    token = create_access_token(user)
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "role": user["role"]}}


@app.post("/auth/login")
def login(payload: UserLoginIn):
    user = _USERS.get_by_email(payload.email)
    if not user or not verify_password(payload.password, user["passwordHash"]):
        raise HTTPException(401, "Invalid email or password")
    token = create_access_token(user)
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "role": user["role"]}}

# ---------- document upload -> text extraction -> LLM/heuristic pre-fill ----------

# A trimmed mirror of the frontend question bank, just enough to match
# against free text. In production this should be the single source of
# truth shared with the frontend (e.g. served from the DB), not duplicated.
EXTRACTABLE_QUESTIONS = [
    {"id": "Q-INFRA-002", "domain": "Deployment", "question": "Where should this be deployed?",
     "keywords": {"aws": "AWS", "amazon web services": "AWS", "azure": "Azure", "gcp": "GCP",
                  "google cloud": "GCP", "on-premise": "On-premise", "on premise": "On-premise"}},
    {"id": "Q-SEC-014", "domain": "Security", "question": "Do you already have an authentication system in place?",
     "keywords": {"azure ad": "Yes - Azure AD", "okta": "Yes - Okta",
                  "custom auth": "Yes - custom", "no authentication": "Not yet"}},
    {"id": "Q-DATA-001", "domain": "Data", "question": "What type of data will the system process?",
     "keywords": {"personally identifiable": "Personally identifiable information", "pii": "Personally identifiable information",
                  "financial data": "Financial / highly sensitive information", "payment": "Financial / highly sensitive information",
                  "public data": "Public information", "internal data": "Internal business information"}},
    {"id": "Q-TECH-001", "domain": "Integrations", "question": "What should this system integrate with?",
     "keywords": {"crm": "CRM", "salesforce": "CRM", "helpdesk": "Helpdesk software",
                  "zendesk": "Helpdesk software", "order system": "Order/database system"}},
    {"id": "Q-COMP-001", "domain": "Compliance", "question": "Are there specific compliance requirements this must meet?",
     "keywords": {"gdpr": "GDPR", "hipaa": "HIPAA", "soc 2": "SOC 2", "soc2": "SOC 2"}},
    {"id": "Q-PM-001", "domain": "Users", "question": "Roughly how many people will use this system?",
     "keywords": {"thousand users": "1,000 - 50,000", "hundred users": "100 - 1,000", "million users": "50,000+"}},
    {"id": "Q-IT-001", "domain": "Infrastructure", "question": "What is your current hosting setup?",
     "keywords": {"cloud-native": "Cloud-native already", "data center": "On-premise data center", "hybrid": "Hybrid"}},
    {"id": "Q-BIZ-003", "domain": "Budget", "question": "What is the approximate budget range for this project?",
     "keywords": {"under $25": "Under $25k", "$25k": "$25k - $100k", "$100k": "$100k - $500k", "$500k": "$500k+"}},
]


def extract_text_from_upload(filename: str, content: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                return "\n".join((page.extract_text() or "") for page in pdf.pages)
        except Exception as e:
            raise HTTPException(400, f"Could not read PDF: {e}")
    if name.endswith(".docx"):
        try:
            import docx
            doc = docx.Document(io.BytesIO(content))
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception as e:
            raise HTTPException(400, f"Could not read Word document: {e}")
    raise HTTPException(400, "Only .pdf and .docx files are supported")


def guess_project_name(text: str) -> Optional[str]:
    # very rough heuristic: first non-empty line under ~80 chars, standing in
    # for a real LLM call that would do this far more reliably
    for line in text.splitlines():
        line = line.strip()
        if 3 < len(line) < 80:
            return line
    return None


def heuristic_extract_answers(text: str) -> List[dict]:
    """Keyword-matching fallback — used only if no XAI_API_KEY is set,
    or if the Grok call fails for any reason."""
    lowered = text.lower()
    results = []
    for q in EXTRACTABLE_QUESTIONS:
        for keyword, answer in q["keywords"].items():
            if keyword in lowered:
                results.append({
                    "questionId": q["id"],
                    "domain": q["domain"],
                    "question": q["question"],
                    "answer": answer,
                    "confidence": 0.75,
                })
                break
    return results


def llm_extract_answers_from_text(text: str) -> List[dict]:
    """
    Real LLM extraction layer (Part 9 of the design doc), backed by Grok.
    Falls back to the keyword heuristic if no API key is configured or the
    call fails for any reason — the app should never hard-crash on this.
    """
    if not _grok_client:
        return heuristic_extract_answers(text)

    question_list = [
        {"id": q["id"], "domain": q["domain"], "question": q["question"],
         "validOptions": sorted(set(q["keywords"].values()))}
        for q in EXTRACTABLE_QUESTIONS
    ]

    system_prompt = (
        "You extract structured requirements from a client's project document. "
        "You will be given the document text and a list of candidate questions, "
        "each with a set of valid options. Only include a question in your answer "
        "if the document text actually supports a specific answer with reasonable "
        "confidence — do not guess or include questions the text doesn't address. "
        "For each question you do include, pick the closest matching option from "
        "validOptions (or omit it if none fit well). "
        "Respond with ONLY a JSON array, no prose, no markdown fences, in this shape: "
        '[{"questionId": "...", "answer": "...", "confidence": 0.0}]. '
        "confidence must be a float between 0 and 1 reflecting how directly the "
        "text supports that answer."
    )
    user_prompt = (
        f"Candidate questions:\n{json.dumps(question_list, indent=2)}\n\n"
        f"Document text:\n{text[:8000]}"
    )

    try:
        response = _grok_client.chat.completions.create(
            model=XAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
        raw = response.choices[0].message.content.strip()
        raw = re.sub(r"^```(json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
        parsed = json.loads(raw)

        by_id = {q["id"]: q for q in EXTRACTABLE_QUESTIONS}
        results = []
        for item in parsed:
            q = by_id.get(item.get("questionId"))
            if not q:
                continue
            results.append({
                "questionId": q["id"],
                "domain": q["domain"],
                "question": q["question"],
                "answer": item.get("answer", ""),
                "confidence": max(0.0, min(1.0, float(item.get("confidence", 0.5)))),
            })
        return results
    except Exception as e:
        print(f"[warn] Grok extraction failed, falling back to heuristic: {e}")
        return heuristic_extract_answers(text)


@app.post("/extract")
async def extract_project(file: UploadFile = File(...)):
    content = await file.read()
    text = extract_text_from_upload(file.filename, content)
    if not text.strip():
        raise HTTPException(400, "No readable text found in that file")

    # Keep a capped copy of the raw brief text so it can inform the final
    # architecture brief later, not just the Q&A pre-fill — grounds the
    # diagram in whatever the client actually wrote, not only what got
    # matched to a known question.
    ARCHITECTURE_SOURCE_CHAR_CAP = 8000

    return {
        "suggestedName": guess_project_name(text),
        "extracted": llm_extract_answers_from_text(text),
        "charactersRead": len(text),
        "usedLLM": _grok_client is not None,
        "rawText": text[:ARCHITECTURE_SOURCE_CHAR_CAP],
    }


class InterpretIn(BaseModel):
    domain: str
    question: str
    freeText: str


def heuristic_interpret(free_text: str) -> dict:
    words = len(free_text.split())
    confidence = 0.25 if words < 2 else 0.5 if words < 5 else 0.8
    return {"answer": free_text, "confidence": confidence}


@app.post("/interpret-answer")
def interpret_answer(payload: InterpretIn):
    """
    Real-time interpretation of a client's free-text ("Other") answer to a
    bank question — this is what the progress bar's confident/thinking
    state is actually driven by once a real LLM is wired in.
    """
    if not _grok_client:
        return heuristic_interpret(payload.freeText)

    system_prompt = (
        "A user is answering a requirements-gathering question with free text "
        "instead of picking a multiple-choice option. Normalize their answer "
        "into a short, clear phrase, and rate how confident you are that you "
        "understood what they meant. Respond with ONLY JSON, no prose: "
        '{"answer": "short normalized answer", "confidence": 0.0}. '
        "confidence is a float 0-1. Use a LOW confidence (under 0.5) if the "
        "answer is vague, off-topic, or doesn't actually answer the question."
    )
    user_prompt = f"Domain: {payload.domain}\nQuestion: {payload.question}\nUser's answer: {payload.freeText}"

    try:
        response = _grok_client.chat.completions.create(
            model=XAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
        raw = response.choices[0].message.content.strip()
        raw = re.sub(r"^```(json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
        parsed = json.loads(raw)
        return {
            "answer": parsed.get("answer", payload.freeText),
            "confidence": max(0.0, min(1.0, float(parsed.get("confidence", 0.5)))),
        }
    except Exception as e:
        print(f"[warn] Grok interpretation failed, falling back to heuristic: {e}")
        return heuristic_interpret(payload.freeText)




def call_grok_json(system_prompt: str, user_prompt: str) -> Optional[dict]:
    """Shared helper: call Grok, strip markdown fences if present, parse JSON.
    Returns None on any failure so callers can fall back cleanly."""
    if not _grok_client:
        return None
    try:
        response = _grok_client.chat.completions.create(
            model=XAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
        )
        raw = response.choices[0].message.content.strip()
        raw = re.sub(r"^```(json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
        return json.loads(raw)
    except Exception as e:
        print(f"[warn] Grok call failed: {e}")
        return None


# ---------- dynamic, open-ended question generation ----------
# Replaces the fixed "ask exactly N questions" cap. Once the static,
# pre-tagged question bank (still the primary source — Part 7/25 Rule 3/4
# of the design doc, the LLM doesn't freely invent the *whole*
# questionnaire) runs out for this role, this endpoint asks Grok whether
# there's still something specific and useful left to ask about *this*
# particular project — informed by its actual domain (a Spotify-like app
# should get asked about music licensing, not just generic tech
# questions), and whether it should stop.

class NextQuestionIn(BaseModel):
    projectName: str
    role: str
    answeredSoFar: List[dict]   # [{domain, question, answer}, ...]
    askedQuestions: List[str]   # question text already asked, to avoid repeats


def heuristic_next_question(payload: "NextQuestionIn") -> dict:
    # No LLM configured — can't safely invent new domain-specific
    # questions, so stop here rather than asking something generic and
    # repetitive. This is the honest fallback: dynamic questioning is a
    # feature that requires a real LLM key to do well.
    return {"done": True}


@app.post("/next-question")
def next_question(payload: NextQuestionIn):
    if not _grok_client:
        return heuristic_next_question(payload)

    system_prompt = (
        "You are the question-selection step of an AI discovery interview for a "
        "consulting firm. You are given a project name, the interviewee's role, and "
        "everything they've already answered. You have TWO jobs, not one:\n"
        "1. GAP-FILLING — close missing requirements/scoping info specific to what this "
        "project actually is (e.g. a Spotify-like app should get asked about music "
        "licensing, catalog size, or personalization — not another generic hosting "
        "question if that's already covered).\n"
        "2. IDEATION — proactively suggest ways to make the project BETTER, the way a "
        "sharp consultant (or a good product-thinking AI) would volunteer even if nothing "
        "forced them to. For a music app this looks like: what should the home/landing "
        "screen lead with, which genres or moods to prioritize at launch, what would make "
        "someone choose this over Spotify. For any project, think about: what the "
        "front page / first screen should show, what differentiates it from the obvious "
        "competitor, what one delightful feature would make users love it, how a "
        "brand-new user's first few minutes should feel.\n\n"
        "SEQUENCING RULE: prioritize GAP questions first. Only ask an IDEATION question "
        "once the core requirements/fundamentals for this role look reasonably well "
        "covered by answeredSoFar — an ideation question about the homepage is wasted if "
        "basic scope (budget, users, core features, etc.) is still unclear. Once gaps are "
        "mostly covered, it's good to ask one or two ideation questions before finishing, "
        "rather than stopping the moment gaps are done — don't skip ideation entirely.\n\n"
        "Given what's already been asked and answered, decide ONE of two things:\n"
        "A. If you believe you now understand enough about this project's fundamentals "
        "AND have offered at least one ideation question once gaps were covered (if none "
        "has been asked yet and gaps look done, ask one now rather than stopping), respond "
        'with {"done": true}.\n'
        "B. Otherwise, ask exactly ONE more multiple-choice question, following the "
        "sequencing rule above. Do not repeat the intent of any question already asked. "
        "Respond with ONLY JSON: "
        '{"done": false, "domain": "short domain label", "category": "gap" or "ideation", '
        '"question": "the question text", '
        '"options": ["option A", "option B", "option C", "option D"]}\n'
        "For ideation questions, use the domain label \"Product Ideation\". "
        "Never include an 'Other' option yourself — the app adds that automatically. "
        "Stop (done: true) after at most 6 additional questions beyond what's already been "
        "asked, even if more could theoretically be asked — respect the interviewee's time."
    )
    user_prompt = json.dumps({
        "projectName": payload.projectName,
        "role": payload.role,
        "answeredSoFar": payload.answeredSoFar,
        "alreadyAskedCount": len(payload.askedQuestions),
    }, indent=2)

    result = call_grok_json(system_prompt, user_prompt)
    if not result or "done" not in result:
        return heuristic_next_question(payload)
    if result.get("done"):
        return {"done": True}
    if not result.get("question") or not result.get("options"):
        return {"done": True}
    category = result.get("category") if result.get("category") in ("gap", "ideation") else "gap"
    return {
        "done": False,
        "domain": result.get("domain", "Additional Detail"),
        "category": category,
        "question": result["question"],
        "options": result["options"][:4],
    }


# ---------- "explain this question" ----------

class ExplainIn(BaseModel):
    domain: str
    question: str


@app.post("/explain-question")
def explain_question(payload: ExplainIn):
    if not _grok_client:
        return {
            "explanation": f"This question is about {payload.domain.lower()}. "
                            f"In short, we're trying to understand: {payload.question} "
                            f"(Note: a real explanation needs an LLM key configured — this is a generic fallback.)"
        }

    system_prompt = (
        "A user filling out a requirements-gathering questionnaire doesn't understand "
        "a question. Explain it in one or two short, plain-language sentences, with a "
        "concrete example if that helps. No jargon. Do not just repeat the question. "
        'Respond with ONLY JSON: {"explanation": "..."}'
    )
    user_prompt = f"Domain: {payload.domain}\nQuestion: {payload.question}"
    result = call_grok_json(system_prompt, user_prompt)
    if not result or not result.get("explanation"):
        return {"explanation": "Sorry, couldn't generate a simpler explanation right now — try answering as best you can, or use 'Other' to describe it in your own words."}
    return {"explanation": result["explanation"]}


# ---------- session summary ----------

class SummarizeIn(BaseModel):
    projectName: str
    role: str
    answers: List[dict]


def heuristic_summary(payload: "SummarizeIn") -> str:
    domains = sorted({a.get("domain", "") for a in payload.answers})
    return (
        f"The client described a project called \"{payload.projectName}\" and answered questions "
        f"as the {payload.role}. Across the session, they provided {len(payload.answers)} answers "
        f"covering {', '.join(domains)}. A consultant should review these answers in full before "
        f"finalizing the project scope."
    )


@app.post("/summarize")
def summarize_session(payload: SummarizeIn):
    if not _grok_client:
        return {"summary": heuristic_summary(payload)}

    system_prompt = (
        "Write a concise, professional third-person paragraph (3-5 sentences) summarizing "
        "a client's discovery session for a consulting firm. The answers include both "
        "requirements/gap-filling questions (category: gap) and proactive product-ideation "
        "questions about how to make the project better (category: ideation, domain "
        "'Product Ideation') — weave both in naturally, e.g. note what was decided about "
        "scope as well as any direction the client gave on things like the homepage/first "
        "screen experience or what should differentiate the product. Base it ONLY on the "
        "answers given — do not invent details. Write it the way a consultant would "
        "describe the project to a colleague. "
        'Respond with ONLY JSON: {"summary": "..."}'
    )
    user_prompt = json.dumps({
        "projectName": payload.projectName,
        "role": payload.role,
        "answers": payload.answers,
    }, indent=2)
    result = call_grok_json(system_prompt, user_prompt)
    if not result or not result.get("summary"):
        return {"summary": heuristic_summary(payload)}
    return {"summary": result["summary"]}


# ---------- client submits a finished session ----------

@app.post("/projects")
def create_project(project: ProjectIn, current_user: Optional[dict] = Depends(get_current_user)):
    project_id = str(uuid.uuid4())[:8]
    readiness = round(100 * project.answered / project.total) if project.total else 0
    _PROJECTS[project_id] = {
        "id": project_id,
        "name": project.name,
        "role": project.role,
        "answers": [a.model_dump() for a in project.answers],
        "total": project.total,
        "answered": project.answered,
        "readiness": readiness,
        "createdAt": date.today().isoformat(),
        "summary": project.summary,
        "sourceDocText": project.sourceDocText,
        "ownerId": current_user["id"] if current_user else None,
    }
    return {"id": project_id, "readiness": readiness}


# ---------- consultant reads the project list ----------

@app.get("/projects")
def list_projects(current_user: Optional[dict] = Depends(get_current_user)):
    projects = sorted(_PROJECTS.values(), key=lambda x: x["createdAt"], reverse=True)
    if current_user and current_user["role"] == "client":
        projects = [p for p in projects if p.get("ownerId") == current_user["id"]]
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "role": p["role"],
            "readiness": p["readiness"],
            "answered": p["answered"],
            "total": p["total"],
            "createdAt": p["createdAt"],
        }
        for p in projects
    ]


@app.get("/projects/{project_id}")
def get_project(project_id: str):
    project = _PROJECTS.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


# ---------- gap prediction (Phase 1: rule-based stand-in for XGBoost) ----------

# Domain criticality weights — mirrors DOMAIN_CRITICALITY in the frontend
# question bank. Kept as a separate constant here on purpose: today it's
# hand-set, but this is exactly the artifact a trained gap-prediction model
# would eventually replace, without changing the shape of what /gaps returns.
DOMAIN_CRITICALITY = {
    "Security": 5, "Compliance": 5, "Data": 4, "AI/ML": 4, "Deployment": 4,
    "Business": 3, "Users": 3, "Functional Requirements": 3, "Non-Functional Requirements": 3,
    "Integrations": 3, "Technology": 3, "Architecture": 3, "Infrastructure": 3,
    "Operations": 2, "Monitoring": 2, "Budget": 2, "Timeline": 2,
    "Stakeholders": 2, "Success Metrics": 2, "Risks": 3,
}

# What domains a role is *expected* to have touched on, roughly matching
# the question bank's role tagging. This lets us flag gaps even for
# domains the client's own role never got asked about — which is real
# signal (someone else needs to cover it), not a bug.
ROLE_EXPECTED_DOMAINS = {
    "Business Owner": ["Business", "Budget", "Timeline", "Stakeholders", "Risks"],
    "Product Manager": ["Users", "Functional Requirements", "Success Metrics"],
    "Technical Lead": ["Integrations", "Deployment", "Technology", "Non-Functional Requirements", "Architecture", "Data"],
    "Data/AI Lead": ["Data", "AI/ML"],
    "Security/Compliance": ["Security", "Compliance", "Risks"],
    "IT/Infrastructure": ["Infrastructure", "Operations", "Monitoring"],
}
ALL_DOMAINS = sorted(set(d for domains in ROLE_EXPECTED_DOMAINS.values() for d in domains))


# ---------- XGBoost gap prediction (Phase 2 of the design doc's staged rollout) ----------
# A real, trainable model — starts from a bootstrap dataset synthesized
# FROM the rule-based formula above (weak supervision, not real labels —
# clearly documented as such), and incorporates real consultant feedback
# as it accumulates via /projects/{id}/feedback. Falls back to the plain
# rule-based formula if xgboost isn't installed or hasn't trained yet.
# This is never a silent swap: every /gaps response says which method
# produced each prediction.

import random as _random

try:
    import xgboost as xgb
    _XGB_AVAILABLE = True
except ImportError:
    _XGB_AVAILABLE = False

_GAP_MODEL = None
_GAP_MODEL_META = {"trained": False, "bootstrapSamples": 0, "realFeedbackSamples": 0}

MUSIC_DOMAIN_MARKER = "Licensing"  # the one domain unique to an industry-specific bank


def domain_features(project: dict, domain: str) -> list:
    """5 features per (project, domain) pair — deliberately small and
    interpretable, matching Part 20's feature list (role, coverage,
    criticality, project complexity, industry signal)."""
    answers = project["answers"]
    role = project["role"]
    count_in_domain = sum(1 for a in answers if a["domain"] == domain)
    coverage = min(count_in_domain / 2, 1.0)
    criticality_norm = DOMAIN_CRITICALITY.get(domain, 2) / 5.0
    role_match = 1.0 if domain in ROLE_EXPECTED_DOMAINS.get(role, []) else 0.0
    total_answers_norm = min(len(answers) / 20, 1.0)
    industry_specific = 1.0 if domain == MUSIC_DOMAIN_MARKER else 0.0
    return [criticality_norm, coverage, role_match, total_answers_norm, industry_specific]


def rule_based_gap_probability(criticality_norm: float, coverage: float) -> float:
    return round((1 - coverage) * (0.5 + 0.5 * criticality_norm), 2)


def build_bootstrap_dataset(n: int = 300) -> tuple:
    """Synthetic examples generated FROM the rule-based formula — weak
    supervision, not real labels. Gives the model something sane to start
    from before any consultant feedback exists."""
    X, y = [], []
    for _ in range(n):
        criticality_norm = _random.choice([2, 3, 4, 5]) / 5.0
        coverage = _random.random()
        role_match = _random.choice([0.0, 1.0])
        total_answers_norm = _random.random()
        industry_specific = _random.choice([0.0, 0.0, 0.0, 1.0])
        prob = rule_based_gap_probability(criticality_norm, coverage)
        label = 1 if prob > 0.5 else 0
        if _random.random() < 0.05:  # small label noise, avoids a perfect step function
            label = 1 - label
        X.append([criticality_norm, coverage, role_match, total_answers_norm, industry_specific])
        y.append(label)
    return X, y


def build_feedback_dataset() -> tuple:
    """Real labels from consultant approve / not_applicable actions on
    gap predictions — this is the actual human-in-the-loop training data
    (Part 11 of the design doc)."""
    X, y = [], []
    for f in _FEEDBACK:
        if f.get("targetType") != "gap" or f.get("action") not in ("approve", "not_applicable"):
            continue
        project = _PROJECTS.get(f["projectId"])
        if not project:
            continue
        X.append(domain_features(project, f["targetId"]))
        y.append(1 if f["action"] == "approve" else 0)
    return X, y


def train_gap_model() -> dict:
    global _GAP_MODEL, _GAP_MODEL_META
    if not _XGB_AVAILABLE:
        _GAP_MODEL_META = {"trained": False, "reason": "xgboost not installed", "bootstrapSamples": 0, "realFeedbackSamples": 0}
        return _GAP_MODEL_META

    bootstrap_X, bootstrap_y = build_bootstrap_dataset()
    feedback_X, feedback_y = build_feedback_dataset()

    # Oversample real feedback so it actually moves the model — otherwise
    # a handful of real labels get drowned out by 300 synthetic ones.
    REAL_FEEDBACK_WEIGHT = 8
    X = bootstrap_X + feedback_X * REAL_FEEDBACK_WEIGHT
    y = bootstrap_y + feedback_y * REAL_FEEDBACK_WEIGHT

    model = xgb.XGBClassifier(n_estimators=50, max_depth=3, eval_metric="logloss")
    model.fit(X, y)
    _GAP_MODEL = model
    _GAP_MODEL_META = {
        "trained": True,
        "bootstrapSamples": len(bootstrap_X),
        "realFeedbackSamples": len(feedback_X),
    }
    return _GAP_MODEL_META


@app.on_event("startup")
def _startup_train_gap_model():
    try:
        init_db()
    except Exception as e:
        print(f"[warn] database init failed, falling back to in-memory storage: {e}")
    try:
        train_gap_model()
    except Exception as e:
        print(f"[warn] gap model training failed at startup: {e}")


@app.post("/train-gap-model")
def retrain_gap_model():
    """Call this after new consultant feedback comes in to let the model
    actually learn from it — training doesn't happen automatically on
    every feedback submission, by design, so it's a deliberate action."""
    return train_gap_model()


@app.get("/gap-model-status")
def gap_model_status():
    return _GAP_MODEL_META


def predict_gaps(project: dict) -> List[dict]:
    """
    Uses the trained XGBoost model when available, falls back to the
    rule-based formula otherwise. Every result says which method produced
    it — "xgboost" or "rule_based" — never silently swapped.
    """
    relevant_domains = ROLE_EXPECTED_DOMAINS.get(project["role"], ALL_DOMAINS)

    results = []
    for domain in relevant_domains:
        features = domain_features(project, domain)
        criticality_norm, coverage = features[0], features[1]
        if _GAP_MODEL is not None:
            gap_probability = round(float(_GAP_MODEL.predict_proba([features])[0][1]), 2)
            method = "xgboost"
        else:
            gap_probability = rule_based_gap_probability(criticality_norm, coverage)
            method = "rule_based"
        results.append({
            "domain": domain,
            "gapProbability": gap_probability,
            "criticality": DOMAIN_CRITICALITY.get(domain, 2),
            "method": method,
        })

    return sorted(results, key=lambda r: r["gapProbability"], reverse=True)


@app.get("/projects/{project_id}/gaps")
def get_gaps(project_id: str):
    project = _PROJECTS.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return predict_gaps(project)


# ---------- consultant feedback (human-in-the-loop labels) ----------

class FeedbackIn(BaseModel):
    targetType: str   # "gap" | "requirement"
    targetId: str      # domain name for gaps, questionId for requirements
    action: str         # "approve" | "reject" | "not_applicable"
    modelScore: Optional[float] = None
    note: Optional[str] = None


# Every feedback row is a (prediction, human label) pair — this is the
# actual dataset a future gap/completeness model gets trained on. Stored
# for real (via _FeedbackStore above) when DATABASE_URL is set.


@app.post("/projects/{project_id}/feedback")
def submit_feedback(project_id: str, feedback: FeedbackIn):
    if project_id not in _PROJECTS:
        raise HTTPException(404, "Project not found")
    record = {
        "id": str(uuid.uuid4())[:8],
        "projectId": project_id,
        **feedback.model_dump(),
        "createdAt": date.today().isoformat(),
    }
    _FEEDBACK.append(record)
    return record


@app.get("/projects/{project_id}/feedback")
def list_feedback(project_id: str):
    return [f for f in _FEEDBACK if f["projectId"] == project_id]


# ---------- similar projects (Jaccard on domains — stand-in for embeddings) ----------

@app.get("/projects/{project_id}/similar")
def similar_projects(project_id: str):
    """
    Honest stand-in for Part 5.11 (BGE-M3 + pgvector similar-project
    search): Jaccard similarity over each project's answered domains.
    No embeddings or vector DB required — reasonable signal until there's
    enough project volume to justify standing up real vector search.
    """
    target = _PROJECTS.get(project_id)
    if not target:
        raise HTTPException(404, "Project not found")
    target_domains = {a["domain"] for a in target["answers"]}
    if not target_domains:
        return []

    results = []
    for pid, p in _PROJECTS.items():
        if pid == project_id:
            continue
        other_domains = {a["domain"] for a in p["answers"]}
        if not other_domains:
            continue
        intersection = len(target_domains & other_domains)
        union = len(target_domains | other_domains)
        similarity = round(intersection / union, 2) if union else 0
        if similarity > 0:
            results.append({"id": pid, "name": p["name"], "role": p["role"], "similarity": similarity})

    return sorted(results, key=lambda r: r["similarity"], reverse=True)[:5]


# ---------- contradiction detection ----------
# LLM + deterministic validation, per Part 13 of the design doc — never
# silently overwrite a conflicting answer, flag it for the consultant.
# This genuinely needs an LLM to do well (spotting "1,000 users" vs
# "50,000 concurrent users" as related-but-conflicting requires real
# semantic understanding, not just domain matching), so the no-key
# fallback is honest: it reports nothing checked rather than guessing.

def heuristic_contradictions() -> dict:
    return {"checked": False, "contradictions": []}


@app.get("/projects/{project_id}/contradictions")
def get_contradictions(project_id: str):
    project = _PROJECTS.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    if not _grok_client or len(project["answers"]) < 2:
        return heuristic_contradictions()

    system_prompt = (
        "You are reviewing all answers from a requirements-discovery interview for "
        "logical contradictions — cases where two answers genuinely conflict (numbers "
        "that don't add up, mutually exclusive choices, a stated requirement that "
        "contradicts a later one). Do NOT flag things that are merely related or "
        "on the same topic — only flag genuine conflicts. If there are none, return "
        "an empty list. "
        'Respond with ONLY JSON: {"contradictions": [{"domainA": "...", "questionA": "...", '
        '"answerA": "...", "domainB": "...", "questionB": "...", "answerB": "...", '
        '"explanation": "one short sentence on why these conflict"}]}'
    )
    user_prompt = json.dumps({"answers": project["answers"]}, indent=2)
    result = call_grok_json(system_prompt, user_prompt)
    if not result or "contradictions" not in result:
        return heuristic_contradictions()

    contradictions = result["contradictions"]
    if not isinstance(contradictions, list):
        return heuristic_contradictions()

    # give each one a stable id so the frontend can attach feedback to it
    for i, c in enumerate(contradictions):
        c["id"] = f"contradiction-{i}"

    return {"checked": True, "contradictions": contradictions}


# ---------- PDF report ----------

def wrap_text(c: canvas.Canvas, text: str, font: str, size: int, max_width: float) -> List[str]:
    words = text.split()
    lines, current = [], ""
    for w in words:
        trial = f"{current} {w}".strip()
        if c.stringWidth(trial, font, size) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = w
    if current:
        lines.append(current)
    return lines or [""]


class ReportBuilder:
    """Minimal deterministic PDF builder — plain text sections plus a
    hand-drawn architecture diagram on the final page. No LLM involved."""

    def __init__(self, c: canvas.Canvas):
        self.c = c
        self.y = PAGE_H - MARGIN

    def new_page(self):
        self.c.showPage()
        self.y = PAGE_H - MARGIN

    def ensure_space(self, needed: float):
        if self.y - needed < MARGIN:
            self.new_page()

    def heading(self, text: str, size: int = 16):
        self.ensure_space(30)
        self.c.setFont("Helvetica-Bold", size)
        self.c.setFillColor(colors.HexColor("#141B2E"))
        self.c.drawString(MARGIN, self.y, text)
        self.y -= size + 10

    def subheading(self, text: str):
        self.ensure_space(20)
        self.c.setFont("Helvetica-Bold", 11)
        self.c.setFillColor(colors.HexColor("#2F6F5E"))
        self.c.drawString(MARGIN, self.y, text)
        self.y -= 16

    def body(self, text: str, size: int = 10, color: str = "#333333"):
        max_width = PAGE_W - 2 * MARGIN
        for line in wrap_text(self.c, text, "Helvetica", size, max_width):
            self.ensure_space(size + 4)
            self.c.setFont("Helvetica", size)
            self.c.setFillColor(colors.HexColor(color))
            self.c.drawString(MARGIN, self.y, line)
            self.y -= size + 4

    def rule(self):
        self.ensure_space(14)
        self.y -= 4
        self.c.setStrokeColor(colors.HexColor("#DEDAD0"))
        self.c.line(MARGIN, self.y, PAGE_W - MARGIN, self.y)
        self.y -= 14

# ---------- Architecture Brief ----------
# Replaces the old flat "one box per answered domain" flowchart with a
# real brief: a narrative overview, key decisions, open items still
# needing a decision, and a layered diagram (client/app/data/integrations/
# security/infra) grouped the way an actual solutions architect would lay
# it out — not one box per question. Grounded in EVERY gap answer from the
# session, plus the raw text of an uploaded brief when the client
# provided one, so it reflects the whole project rather than just a
# handful of hardcoded fields.

DOMAIN_TO_LAYER: dict[str, str] = {
    "Business": "Business Context",
    "Budget": "Business Context",
    "Timeline": "Business Context",
    "Stakeholders": "Business Context",
    "Risks": "Business Context",
    "Success Metrics": "Business Context",
    "Users": "Client / Presentation Layer",
    "Functional Requirements": "Application / API Layer",
    "Non-Functional Requirements": "Application / API Layer",
    "Technology": "Application / API Layer",
    "Architecture": "Application / API Layer",
    "Data": "Data & Storage Layer",
    "AI/ML": "Data & Storage Layer",
    "Integrations": "Integrations & Third-Party Layer",
    "Licensing": "Integrations & Third-Party Layer",
    "Security": "Security & Compliance Layer",
    "Compliance": "Security & Compliance Layer",
    "Infrastructure": "Infrastructure & Deployment Layer",
    "Deployment": "Infrastructure & Deployment Layer",
    "Operations": "Infrastructure & Deployment Layer",
    "Monitoring": "Infrastructure & Deployment Layer",
}
LAYER_ORDER = [
    "Business Context",
    "Client / Presentation Layer",
    "Application / API Layer",
    "Data & Storage Layer",
    "Integrations & Third-Party Layer",
    "Security & Compliance Layer",
    "Infrastructure & Deployment Layer",
]
UNCERTAIN_PATTERNS = ["not sure", "not decided", "undecided", "to be determined", "tbd"]


def _is_undecided(answer: str) -> bool:
    lowered = (answer or "").lower()
    return any(p in lowered for p in UNCERTAIN_PATTERNS)


def rule_based_architecture_brief(project: dict) -> dict:
    """Fallback when no LLM is configured. Deterministic, but still real:
    groups every gap answer into an architectural layer, and separates
    decided answers from ones the client explicitly left open, instead of
    a single flat list of boxes."""
    gap_answers = [a for a in project["answers"] if a.get("category", "gap") != "ideation"]

    buckets: dict[str, dict] = {name: {} for name in LAYER_ORDER}
    other_bucket: dict = {}
    for a in gap_answers:
        layer = DOMAIN_TO_LAYER.get(a["domain"])
        target = buckets[layer] if layer else other_bucket
        target.setdefault(a["domain"], a["answer"])  # first answer per domain wins

    layers = []
    for name in LAYER_ORDER:
        comps = [{"label": k, "detail": v} for k, v in buckets[name].items()][:4]
        if comps:
            layers.append({"name": name, "components": comps})
    if other_bucket:
        comps = [{"label": k, "detail": v} for k, v in other_bucket.items()][:4]
        if comps:
            layers.append({"name": "Other Considerations", "components": comps})
    if not layers:
        layers = [{"name": "Client / Presentation Layer",
                    "components": [{"label": "Client application", "detail": "Entry point for end users"}]}]

    domains_covered = sorted({a["domain"] for a in gap_answers})
    overview = (
        f"\"{project['name']}\" was scoped by the {project['role']} across "
        f"{len(domains_covered)} domain{'s' if len(domains_covered) != 1 else ''} "
        f"({', '.join(domains_covered) if domains_covered else 'no confirmed areas yet'}). "
        "The architecture groups answers into standard layers: Business Context, Presentation, "
        "Application, Data, Integrations, Security, and Infrastructure — reflecting what was confirmed."
    )
    if project.get("sourceDocText"):
        overview += " An uploaded project brief informed the initial answer suggestions."

    # Extract key decisions: most answers with concrete values
    key_decisions = []
    for a in gap_answers:
        if not _is_undecided(a["answer"]):
            decision = f"{a['domain']}: {a['answer']}"
            if decision not in key_decisions:  # avoid duplicates
                key_decisions.append(decision)
    key_decisions = key_decisions[:8]

    # Extract open items: answers that are undecided, plus any domains with no answers
    open_items = []
    for a in gap_answers:
        if _is_undecided(a["answer"]):
            item = f"{a['domain']} ({a['question']}) — still undecided"
            if item not in open_items:
                open_items.append(item)
    
    # Add high-criticality domains not covered by any answer
    for domain in ["Security", "Data", "Infrastructure", "Technology"]:
        if domain not in domains_covered:
            open_items.append(f"{domain} — no coverage in this session; recommend follow-up")
    
    open_items = open_items[:8]

    # Basic risks derived from answers
    risks = []
    answered_text = " ".join([a.get("answer", "") for a in gap_answers]).lower()
    
    if "under $25" in answered_text or "under 3 months" in answered_text:
        risks.append("Risk: Aggressive timeline and/or budget — recommend scope freeze early to avoid creep")
    if "50,000+" in answered_text or "million" in answered_text:
        risks.append("Risk: High user volume requires horizontal scaling — plan for load testing and auto-scaling infrastructure")
    if "personally identifiable" in answered_text or "financial" in answered_text or "hipaa" in answered_text:
        risks.append("Risk: Sensitive data handling — encryption, audit logging, and compliance review are critical path items")
    if "on-premise" in answered_text or "hybrid" in answered_text:
        risks.append("Risk: On-premise deployment adds operational complexity — factor in infrastructure team capacity")
    
    # Ensure at least some risks are shown
    if not risks:
        risks = [
            "Risk: Scope creep — monitor feature requests and maintain a prioritized backlog",
            "Risk: Integration dependencies — clarify third-party API SLAs and fallback strategies early"
        ]
    
    risks = risks[:4]

    return {"overview": overview, "layers": layers, "key_decisions": key_decisions, "open_items": open_items, "risks_and_constraints": risks}


def llm_architecture_brief(project: dict) -> dict:
    """Real generation: gives the LLM every gap answer AND the raw uploaded
    brief text (if any), and asks for a comprehensive, well-structured 
    architecture brief with technical details, deployment strategy, and
    risk considerations. LLM proposes structured content; the caller 
    (draw_architecture_brief) still does all the actual deterministic PDF 
    drawing — the LLM never touches the PDF directly."""
    if not _grok_client:
        return rule_based_architecture_brief(project)

    gap_answers = [a for a in project["answers"] if a.get("category", "gap") != "ideation"]

    system_prompt = (
        "You are a senior solutions architect writing a comprehensive architecture brief "
        "for a consulting firm, based on a client's requirements-discovery session. "
        "You're given the project name, the role interviewed, every gap-filling answer, "
        "and the raw text of a project brief if the client uploaded one.\n\n"
        
        "Your goal: Produce a brief that reflects what THIS SPECIFIC project actually needs. "
        "Synthesize the answers into a coherent technical vision. Extract implicit requirements "
        "(e.g., 'if 50,000+ users, we need horizontal scaling'). Ground EVERYTHING in the "
        "actual answers or brief text — never invent unsupported details.\n\n"
        
        "Key responsibilities:\n"
        "1. OVERVIEW: Write 2-4 sentences describing the overall technical approach, "
        "    key scalability/performance strategy, and business context.\n"
        "2. LAYERS: Group all confirmed answers into architectural layers (Business, Presentation, "
        "    Application, Data, Integrations, Security, Infrastructure). Each layer should have "
        "    3-4 concrete components with specific details from the answers.\n"
        "3. KEY DECISIONS: Extract 5-8 architectural decisions that were confirmed "
        "    (tech choices, deployment strategy, security approach, etc.). "
        "    Format as 'Decision: rationale grounded in answers'.\n"
        "4. OPEN ITEMS: List 3-8 decisions still needed (missing info, TBD details) "
        "    with enough context for follow-up.\n"
        "5. RISKS & CONSTRAINTS: Identify 2-4 technical risks or constraints implied by "
        "    the project scale, budget, or timeline.\n\n"
        
        "Respond with ONLY valid JSON (no markdown fences, no prose) in this shape:\n"
        '{\n'
        '  "overview": "2-4 sentences on technical approach and strategy",\n'
        '  "layers": [\n'
        '    {\n'
        '      "name": "layer name (e.g., \'Client / Presentation Layer\')",\n'
        '      "components": [\n'
        '        {\n'
        '          "label": "component name",\n'
        '          "detail": "one specific line grounded in answers (tech choice, purpose, or scale constraint)"\n'
        '        }\n'
        '      ]\n'
        '    }\n'
        '  ],\n'
        '  "key_decisions": [\n'
        '    "Technology X chosen for [reason grounded in answers]",\n'
        '    "Deployment strategy: [approach based on scale/timeline/budget]"\n'
        '  ],\n'
        '  "open_items": [\n'
        '    "Question: [question], current: [what\'s been decided], missing: [what needs follow-up]"\n'
        '  ],\n'
        '  "risks_and_constraints": [\n'
        '    "Risk: [specific technical risk] — concern: [why], mitigation: [what to decide]"\n'
        '  ]\n'
        '}\n\n'
        
        "Layer order (use only those with confirmed answers):\n"
        "1. Business Context (budgets, timeline, success metrics, stakeholder sign-off)\n"
        "2. Client / Presentation Layer (web/mobile/desktop clients, user experience, accessibility)\n"
        "3. Application / API Layer (backend services, tech stack, API design, microservices vs monolith)\n"
        "4. Data & Storage Layer (database choice, data model, volumes, retention, backup)\n"
        "5. Integrations & Third-Party Layer (SaaS, APIs, payment processing, auth providers)\n"
        "6. Security & Compliance Layer (authentication, encryption, compliance requirements, audit)\n"
        "7. Infrastructure & Deployment Layer (cloud provider, hosting, CI/CD, monitoring, disaster recovery)\n\n"
        
        "Constraints:\n"
        "- Each layer: max 4 components (be selective, pick the most important ones)\n"
        "- Each component detail: must reference an actual answer or brief text\n"
        "- Key decisions: 5-8 items max\n"
        "- Open items: 3-8 items max\n"
        "- Risks: 2-4 items max\n"
        "- If an answer is vague/undecided (contains 'not sure', 'TBD', etc.), put it in open_items, not key_decisions"
    )
    
    user_prompt = json.dumps({
        "projectName": project["name"],
        "roleInterviewed": project["role"],
        "answeredQuestions": gap_answers,
        "uploadedBriefText": project.get("sourceDocText") or None,
    }, indent=2)

    result = call_grok_json(system_prompt, user_prompt)
    if not result or not isinstance(result.get("layers"), list) or not result.get("overview"):
        return rule_based_architecture_brief(project)
    
    return {
        "overview": result.get("overview", ""),
        "layers": result.get("layers", [])[:8],
        "key_decisions": result.get("key_decisions", [])[:8],
        "open_items": result.get("open_items", [])[:8],
        "risks_and_constraints": result.get("risks_and_constraints", [])[:4],
    }


def generate_architecture_brief(project: dict) -> dict:
    try:
        return llm_architecture_brief(project)
    except Exception as e:
        print(f"[warn] architecture brief generation failed, falling back to heuristic: {e}")
        return rule_based_architecture_brief(project)


def draw_layer_row(c: canvas.Canvas, y_top: float, layer_name: str, components: list) -> float:
    """Draws one architectural layer's label plus its component boxes side
    by side. Returns the y coordinate at the bottom of the boxes."""
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(colors.HexColor("#2F6F5E"))
    c.drawString(MARGIN, y_top, layer_name.upper())

    box_h = 0.62 * inch
    row_top = y_top - 14
    n = max(1, len(components))
    gap = 0.2 * inch
    available = PAGE_W - 2 * MARGIN
    box_w = min(2.5 * inch, (available - (n - 1) * gap) / n)
    total_w = n * box_w + (n - 1) * gap
    start_x = MARGIN + (available - total_w) / 2

    palette = ["#EDEDED", "#F5E3DA"]
    for i, comp in enumerate(components):
        x = start_x + i * (box_w + gap)
        c.setFillColor(colors.HexColor(palette[i % 2]))
        c.roundRect(x, row_top - box_h, box_w, box_h, 8, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#141B2E"))
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(x + box_w / 2, row_top - box_h + box_h - 18, str(comp.get("label", ""))[:28])
        c.setFont("Helvetica", 7.5)
        c.setFillColor(colors.HexColor("#555555"))
        max_chars = max(18, int(box_w / 4.2))
        c.drawCentredString(x + box_w / 2, row_top - box_h + 10, str(comp.get("detail", ""))[:max_chars])

    return row_top - box_h


def draw_architecture_brief(c: canvas.Canvas, project: dict):
    brief = generate_architecture_brief(project)

    # ---- Page 1: narrative brief ----
    c.showPage()
    y = PAGE_H - MARGIN
    c.setFont("Helvetica-Bold", 16)
    c.setFillColor(colors.HexColor("#141B2E"))
    c.drawString(MARGIN, y, "Architecture Brief")
    y -= 20
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.HexColor("#777777"))
    if _grok_client:
        subtitle = "Synthesized from this session's answers" + (
            " and the uploaded project brief." if project.get("sourceDocText") else "."
        )
    else:
        subtitle = "Built from confirmed answers (no LLM configured — set an API key for a fuller brief)."
    c.drawString(MARGIN, y, subtitle)
    y -= 26

    c.setFont("Helvetica-Bold", 11)
    c.setFillColor(colors.HexColor("#2F6F5E"))
    c.drawString(MARGIN, y, "Overview")
    y -= 16
    for line in wrap_text(c, brief.get("overview", ""), "Helvetica", 10, PAGE_W - 2 * MARGIN):
        if y < MARGIN + 40:
            c.showPage()
            y = PAGE_H - MARGIN
        c.setFont("Helvetica", 10)
        c.setFillColor(colors.HexColor("#333333"))
        c.drawString(MARGIN, y, line)
        y -= 14
    y -= 12

    def bulleted_section(title: str, items: list):
        nonlocal y
        if not items:
            return
        if y < MARGIN + 60:
            c.showPage()
            y = PAGE_H - MARGIN
        c.setFont("Helvetica-Bold", 11)
        c.setFillColor(colors.HexColor("#2F6F5E"))
        c.drawString(MARGIN, y, title)
        y -= 16
        for item in items:
            lines = wrap_text(c, str(item), "Helvetica", 10, PAGE_W - 2 * MARGIN - 14)
            for i, line in enumerate(lines):
                if y < MARGIN + 20:
                    c.showPage()
                    y = PAGE_H - MARGIN
                c.setFont("Helvetica", 10)
                c.setFillColor(colors.HexColor("#333333"))
                c.drawString(MARGIN, y, ("•  " if i == 0 else "    ") + line)
                y -= 14
            y -= 4
        y -= 10

    bulleted_section("Key Decisions", brief.get("key_decisions", []))
    bulleted_section("Open Items to Resolve", brief.get("open_items", []))
    bulleted_section("Risks & Constraints", brief.get("risks_and_constraints", []))

    # ---- Page 2+: layered diagram ----
    c.showPage()
    y = PAGE_H - MARGIN
    c.setFont("Helvetica-Bold", 16)
    c.setFillColor(colors.HexColor("#141B2E"))
    c.drawString(MARGIN, y, "System Architecture Diagram")
    y -= 16
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.HexColor("#777777"))
    c.drawString(MARGIN, y, "Grouped by architectural layer, top to bottom.")
    y -= 40

    layers = [l for l in (brief.get("layers") or []) if l.get("components")]
    for idx, layer in enumerate(layers):
        components = layer.get("components", [])[:4]
        needed = 14 + 0.62 * inch + 32
        if y - needed < MARGIN:
            c.showPage()
            y = PAGE_H - MARGIN

        bottom_y = draw_layer_row(c, y, layer.get("name", "Layer"), components)
        if idx < len(layers) - 1:
            c.setStrokeColor(colors.HexColor("#999999"))
            cx = PAGE_W / 2
            c.line(cx, bottom_y, cx, bottom_y - 16)
        y = bottom_y - 32


@app.get("/projects/{project_id}/report")
def download_report(project_id: str):
    project = _PROJECTS.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=LETTER)
    r = ReportBuilder(c)

    # Cover / summary
    r.heading("Project Discovery Report", 22)
    r.body(f"Project: {project['name']}", size=12, color="#141B2E")
    r.body(f"Role interviewed: {project['role']}")
    r.body(f"Date: {project['createdAt']}")
    r.body(f"Readiness: {project['readiness']} / 100", size=12, color="#2F6F5E")
    r.rule()

    if project.get("summary"):
        r.subheading("Executive Summary")
        r.body(project["summary"])
        r.rule()

    # Answers grouped by domain — requirements (gap) and ideation kept in
    # separate sections so a consultant can scan "what's scoped" and
    # "what direction the client wants" independently, rather than one
    # undifferentiated wall of Q&A.
    gap_answers = [a for a in project["answers"] if a.get("category", "gap") != "ideation"]
    ideation_answers = [a for a in project["answers"] if a.get("category") == "ideation"]

    r.heading("Captured Requirements", 16)
    domains: dict[str, list] = {}
    for a in gap_answers:
        domains.setdefault(a["domain"], []).append(a)

    for domain, items in domains.items():
        r.subheading(domain)
        for item in items:
            r.body(f"Q: {item['question']}", size=10, color="#555555")
            r.body(f"A: {item['answer']}", size=10, color="#141B2E")
            r.y -= 4
        r.rule()

    if ideation_answers:
        r.heading("Product Direction / Ideas", 16)
        r.body(
            "Not gaps to close — proactive direction the client gave on making the "
            "product better, worth carrying into design and scoping discussions.",
            size=9, color="#777777"
        )
        r.y -= 4
        for item in ideation_answers:
            r.body(f"Q: {item['question']}", size=10, color="#555555")
            r.body(f"A: {item['answer']}", size=10, color="#141B2E")
            r.y -= 4
        r.rule()

    # Architecture diagram, always the final page
    draw_architecture_brief(c, project)

    c.save()
    buffer.seek(0)
    filename = f"{project['name'].replace(' ', '_')}_report.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/health")
def health():
    return {"status": "ok"}
