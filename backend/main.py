"""
main.py

Evaluation Studio backend.

  POST   /api/cycles          -- creates a new cycle/dataset (e.g. "2026-2027").
  GET    /api/cycles          -- lists all cycles with their applicant counts.
  DELETE /api/cycles/{cycle_id} -- deletes a cycle; its applicants are
                                  reassigned to an "Unassigned" cycle rather
                                  than deleted.

  POST   /api/parse-batch     -- accepts multiple CAAPID PDFs plus a
                                  cycle_id, parses each, saves them
                                  persistently under that cycle, returns
                                  one ApplicantReport per file.

  GET    /api/applicants      -- returns previously-uploaded applicants.
                                  Optional ?cycle_id= query param scopes
                                  this to one cycle; omitted, returns all.

  GET    /api/pdf/{file_id}   -- serves a previously-uploaded PDF back so
                                  the frontend's PDF.js viewer can open it
                                  and jump to the page returned in the
                                  report.

  DELETE /api/applicants/{file_id} -- removes an applicant and its stored
                                  PDF, in case a bad upload needs clearing.

  PATCH  /api/applicants/{file_id}/status -- updates an applicant's review
                                  status (not_reviewed / invited /
                                  not_invited). This is set manually by the
                                  user once they've made a decision; it is
                                  never set automatically by parsing.

PDFs are saved to a folder on disk; metadata + parsed report JSON are saved
to a local SQLite file (db.py). Both persist across server restarts.
"""

import os
import shutil
import uuid

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import sys
from fastapi.staticfiles import StaticFiles
import signal


from backend.parser import parse_caapid_pdf
import db

app = FastAPI(title="Evaluation Studio API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],  # Vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)

STORAGE_DIR = os.path.join(os.path.dirname(__file__), "_uploaded_pdfs")
os.makedirs(STORAGE_DIR, exist_ok=True)

db.init_db()


class CycleCreate(BaseModel):
    name: str


@app.post("/api/cycles")
async def create_cycle(body: CycleCreate):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Cycle name cannot be empty.")
    cycle = db.create_cycle(name)
    return cycle


@app.get("/api/cycles")
async def list_cycles():
    return {"results": db.list_cycles()}


@app.delete("/api/cycles/{cycle_id}")
async def delete_cycle(cycle_id: str):
    deleted = db.delete_cycle(cycle_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Cycle not found.")
    return {"deleted": cycle_id}


@app.post("/api/parse-batch")
async def parse_batch(files: list[UploadFile] = File(...), cycle_id: str = Form(...)):
    results = []
    for upload in files:
        if not upload.filename.lower().endswith(".pdf"):
            results.append(
                {
                    "filename": upload.filename,
                    "error": "Not a PDF file -- skipped.",
                }
            )
            continue

        file_id = str(uuid.uuid4())
        dest_path = os.path.join(STORAGE_DIR, f"{file_id}.pdf")
        with open(dest_path, "wb") as f:
            shutil.copyfileobj(upload.file, f)

        try:
            report = parse_caapid_pdf(dest_path, filename=upload.filename)
            payload = report.to_dict()
            payload["file_id"] = file_id
            payload = db.save_applicant(file_id, upload.filename, dest_path, payload, cycle_id)
            results.append(payload)
        except Exception as e:
            # Clean up the saved PDF if parsing failed, so we don't keep an
            # orphaned file with no usable report attached to it.
            if os.path.exists(dest_path):
                os.remove(dest_path)
            results.append(
                {
                    "filename": upload.filename,
                    "file_id": file_id,
                    "error": f"Could not parse this PDF: {e}",
                }
            )

    return {"results": results}


@app.get("/api/applicants")
async def list_applicants(cycle_id: str | None = None):
    """Previously-uploaded applicants, most recently uploaded first.
    Called on app load so the triage list survives a backend restart.
    Pass ?cycle_id=... to scope to one cycle; omit to get all cycles."""
    return {"results": db.list_all_applicants(cycle_id=cycle_id)}


@app.get("/api/pdf/{file_id}")
async def get_pdf(file_id: str):
    path = db.get_pdf_path(file_id)
    if not path or not os.path.exists(path):
        raise HTTPException(
            status_code=404,
            detail="File not found. It may have been deleted.",
        )
    return FileResponse(path, media_type="application/pdf")


@app.delete("/api/applicants/{file_id}")
async def delete_applicant(file_id: str):
    path = db.get_pdf_path(file_id)
    deleted = db.delete_applicant(file_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Applicant not found.")
    if path and os.path.exists(path):
        os.remove(path)
    return {"deleted": file_id}


class StatusUpdate(BaseModel):
    status: str  # 'not_reviewed' | 'invited' | 'not_invited'


@app.patch("/api/applicants/{file_id}/status")
async def set_review_status(file_id: str, body: StatusUpdate):
    try:
        updated = db.update_review_status(file_id, body.status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not updated:
        raise HTTPException(status_code=404, detail="Applicant not found.")
    return {"file_id": file_id, "review_status": body.status}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# Determine the base directory (handles PyInstaller sandbox extraction)
if getattr(sys, 'frozen', False):
    base_dir = sys._MEIPASS
else:
    base_dir = os.path.dirname(os.path.abspath(__file__))

# In the PyInstaller bundle, the frontend 'dist' contents will sit here
frontend_path = os.path.join(base_dir, "frontend")

if os.path.exists(frontend_path):
    # Mount static assets (js, css)
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_path, "assets")), name="assets")

    # Catch-all route to serve index.html for React Router
    @app.get("/{catchall:path}")
    async def serve_frontend(catchall: str):
        # Explicitly allow backend API routes to bypass this handler
        if catchall.startswith("api"):
            return {"error": "Not Found"}
        return FileResponse(os.path.join(frontend_path, "index.html"))
    
@app.post("/api/shutdown")
def shutdown():
    # Sends a termination signal to the running script itself
    os.kill(os.getpid(), signal.SIGTERM)
    return {"status": "Shutting down background service..."}