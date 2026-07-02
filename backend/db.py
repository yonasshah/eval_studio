"""
db.py

Minimal SQLite persistence for Evaluation Studio.

Two tables:
  - cycles: user-created admissions cycles/datasets (e.g. "2026-2027"),
    each with a name and creation timestamp. Applicants are uploaded INTO
    a specific cycle, chosen by the user before uploading.
  - applicants: one row per uploaded applicant PDF -- its generated
    file_id, original filename, path to the saved PDF on disk, the full
    parsed report as JSON, a review_status (not_reviewed / invited /
    not_invited / waitlisted), a review_comment (justification for
    not_invited, "MIR" + optional notes for invited), and a cycle_id
    linking it to its cycle.

This lets uploads AND review decisions survive a backend restart -- on
startup, the app can list everything previously uploaded instead of
starting empty.

Deliberately simple: two tables, no migrations framework, no ORM. This is
a single-user local tool; a single SQLite file is the right amount of
persistence for that, not a reason to reach for Postgres/SQLAlchemy.
"""

import sqlite3
import json
import os
import uuid
from contextlib import contextmanager

DB_PATH = os.path.join(os.path.dirname(__file__), "evaluation_studio.db")

VALID_STATUSES = {"not_reviewed", "invited", "not_invited", "waitlisted"}
# Statuses that require a review_comment to be recorded alongside the
# status change:
#   - not_invited: comment is REQUIRED (a justification for the decision).
#   - invited: comment is auto-set to "MIR" (Meets Interview Requirements)
#     if none is supplied, with any additional text appended after it.
STATUSES_REQUIRING_COMMENT = {"not_invited"}
INVITED_DEFAULT_NOTE = "MIR"
DEFAULT_STATUS = "not_reviewed"
UNASSIGNED_CYCLE_NAME = "Unassigned"


def init_db():
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cycles (
                cycle_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS applicants (
                file_id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                pdf_path TEXT NOT NULL,
                report_json TEXT NOT NULL,
                review_status TEXT NOT NULL DEFAULT 'not_reviewed',
                review_comment TEXT,
                cycle_id TEXT,
                uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (cycle_id) REFERENCES cycles(cycle_id)
            )
            """
        )

        # Safe migrations for databases created before a given column
        # existed, so upgrading the app never requires deleting existing
        # data.
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(applicants)")}
        if "review_status" not in existing_cols:
            conn.execute(
                "ALTER TABLE applicants ADD COLUMN review_status TEXT NOT NULL DEFAULT 'not_reviewed'"
            )
        if "cycle_id" not in existing_cols:
            conn.execute("ALTER TABLE applicants ADD COLUMN cycle_id TEXT")
        if "review_comment" not in existing_cols:
            conn.execute("ALTER TABLE applicants ADD COLUMN review_comment TEXT")

        conn.commit()

        # If there are applicants with no cycle_id (either freshly migrated
        # from a pre-cycles database, or some other gap), assign them to a
        # default "Unassigned" cycle so every applicant always has SOME
        # cycle, and the UI never has to handle a null-cycle case.
        orphans = conn.execute(
            "SELECT COUNT(*) FROM applicants WHERE cycle_id IS NULL"
        ).fetchone()[0]
        if orphans > 0:
            unassigned_id = _get_or_create_unassigned_cycle(conn)
            conn.execute(
                "UPDATE applicants SET cycle_id = ? WHERE cycle_id IS NULL",
                (unassigned_id,),
            )
            conn.commit()


def _get_or_create_unassigned_cycle(conn) -> str:
    row = conn.execute(
        "SELECT cycle_id FROM cycles WHERE name = ?", (UNASSIGNED_CYCLE_NAME,)
    ).fetchone()
    if row:
        return row[0]
    new_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO cycles (cycle_id, name) VALUES (?, ?)", (new_id, UNASSIGNED_CYCLE_NAME)
    )
    return new_id


@contextmanager
def _connect():
    conn = sqlite3.connect(DB_PATH)
    try:
        yield conn
    finally:
        conn.close()


# --- Cycles ---

def create_cycle(name: str) -> dict:
    cycle_id = str(uuid.uuid4())
    with _connect() as conn:
        conn.execute(
            "INSERT INTO cycles (cycle_id, name) VALUES (?, ?)", (cycle_id, name)
        )
        conn.commit()
    return {"cycle_id": cycle_id, "name": name}


def list_cycles() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT c.cycle_id, c.name, c.created_at, COUNT(a.file_id) as applicant_count
            FROM cycles c
            LEFT JOIN applicants a ON a.cycle_id = c.cycle_id
            GROUP BY c.cycle_id
            ORDER BY c.created_at DESC
            """
        ).fetchall()
        return [
            {"cycle_id": r[0], "name": r[1], "created_at": r[2], "applicant_count": r[3]}
            for r in rows
        ]


def delete_cycle(cycle_id: str) -> bool:
    """Deletes a cycle. Does NOT delete its applicants -- they're
    reassigned to the Unassigned cycle instead, so deleting a cycle by
    mistake can't silently orphan or destroy applicant data."""
    with _connect() as conn:
        row = conn.execute("SELECT cycle_id FROM cycles WHERE cycle_id = ?", (cycle_id,)).fetchone()
        if not row:
            return False
        unassigned_id = _get_or_create_unassigned_cycle(conn)
        if cycle_id != unassigned_id:
            conn.execute(
                "UPDATE applicants SET cycle_id = ? WHERE cycle_id = ?", (unassigned_id, cycle_id)
            )
            conn.execute("DELETE FROM cycles WHERE cycle_id = ?", (cycle_id,))
        conn.commit()
        return True


# --- Applicants ---

def save_applicant(
    file_id: str, filename: str, pdf_path: str, report_dict: dict, cycle_id: str
) -> dict:
    """Saves the applicant and returns the report dict with review_status,
    review_comment, and cycle_id included, so callers (e.g. the upload
    endpoint) can return a response that already has these fields set."""
    existing_status = DEFAULT_STATUS
    existing_comment = None
    with _connect() as conn:
        row = conn.execute(
            "SELECT review_status, review_comment FROM applicants WHERE file_id = ?", (file_id,)
        ).fetchone()
        if row:
            existing_status = row[0]
            existing_comment = row[1]

        report_dict = {
            **report_dict,
            "review_status": existing_status,
            "review_comment": existing_comment,
            "cycle_id": cycle_id,
        }
        conn.execute(
            """
            INSERT OR REPLACE INTO applicants
                (file_id, filename, pdf_path, report_json, review_status, review_comment, cycle_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                file_id,
                filename,
                pdf_path,
                json.dumps(report_dict, default=str),
                existing_status,
                existing_comment,
                cycle_id,
            ),
        )
        conn.commit()
        return report_dict


def get_pdf_path(file_id: str) -> str | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT pdf_path FROM applicants WHERE file_id = ?", (file_id,)
        ).fetchone()
        return row[0] if row else None


def list_all_applicants(cycle_id: str | None = None) -> list[dict]:
    """Returns previously-uploaded applicants, most recent first, with
    each report's review_status, review_comment, and cycle_id kept in sync
    with their dedicated columns. If cycle_id is given, only that cycle's
    applicants are returned; otherwise all applicants across all cycles."""
    with _connect() as conn:
        if cycle_id:
            rows = conn.execute(
                "SELECT report_json, review_status, review_comment, cycle_id FROM applicants WHERE cycle_id = ? ORDER BY uploaded_at DESC",
                (cycle_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT report_json, review_status, review_comment, cycle_id FROM applicants ORDER BY uploaded_at DESC"
            ).fetchall()
        results = []
        for report_json, status, comment, applicant_cycle_id in rows:
            report = json.loads(report_json)
            report["review_status"] = status
            report["review_comment"] = comment
            report["cycle_id"] = applicant_cycle_id
            results.append(report)
        return results


def update_review_status(file_id: str, status: str, comment: str | None = None) -> tuple[bool, str | None]:
    """Updates an applicant's review status and, where relevant, their
    review_comment. Returns (updated, final_comment) -- final_comment is
    the actual comment now stored (e.g. "MIR; <extra>" for invited), so
    callers can echo the canonical value back to the frontend rather than
    re-deriving it.

      - not_invited: `comment` is REQUIRED (a non-empty justification).
        Raises ValueError if missing so the caller can 400 back to the
        user instead of silently recording an unexplained rejection.
      - invited: the note "MIR" is always recorded. If `comment` is
        provided (extra notes the reviewer typed), it's appended after
        the MIR note as "MIR; <comment>"; otherwise the comment is just
        "MIR".
      - waitlisted / not_reviewed: `comment`, if provided, is stored as-is
        (lets these also carry an optional note); if omitted (None), any
        existing comment is left untouched.
    """
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status {status!r}. Must be one of {VALID_STATUSES}.")

    if status in STATUSES_REQUIRING_COMMENT and not (comment and comment.strip()):
        raise ValueError(
            "A comment is required to justify marking an applicant Not Invited to Interview."
        )

    with _connect() as conn:
        row = conn.execute(
            "SELECT report_json FROM applicants WHERE file_id = ?", (file_id,)
        ).fetchone()
        if not row:
            return False, None
        report = json.loads(row[0])
        report["review_status"] = status

        if status == "invited":
            extra = comment.strip() if comment else ""
            final_comment = f"{INVITED_DEFAULT_NOTE}; {extra}" if extra else INVITED_DEFAULT_NOTE
        elif status == "not_invited":
            final_comment = comment.strip()
        elif comment is not None:
            final_comment = comment.strip()
        else:
            # No comment supplied for waitlisted/not_reviewed -- leave
            # whatever comment (if any) was already recorded untouched.
            final_comment = report.get("review_comment")

        report["review_comment"] = final_comment
        conn.execute(
            "UPDATE applicants SET review_status = ?, review_comment = ?, report_json = ? WHERE file_id = ?",
            (status, final_comment, json.dumps(report, default=str), file_id),
        )
        conn.commit()
        return True, final_comment


def delete_applicant(file_id: str) -> bool:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM applicants WHERE file_id = ?", (file_id,))
        conn.commit()
        return cur.rowcount > 0