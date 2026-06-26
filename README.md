# Evaluation Studio — CAAPID application triage tool

This is a standalone tool, separate from the Kornberg Admissions Portal.
You upload CAAPID application PDFs, and it checks each one against 6
required items, flags which applications are complete vs. missing
something, and lets you jump straight to the relevant page in the PDF.

It has two parts that both need to be running at the same time:

- `backend/` — a Python (FastAPI) server that does the actual PDF parsing.
- `frontend/` — a React app (the thing you look at in your browser).

You need **two terminal windows/tabs open at once**, one for each.

## One-time setup

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # on Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

(This needs Node.js installed on your machine first. If `npm` isn't
recognized, install Node from https://nodejs.org — any recent LTS version
is fine.)

## Running it (every time you want to use the app)

**Terminal 1 — start the backend:**

```bash
cd backend
source venv/bin/activate        # skip this line on Windows if you didn't use a venv
python3 -m uvicorn main:app --port 8000
```

Leave this terminal open. You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
```

**Terminal 2 — start the frontend:**

```bash
cd frontend
npm run dev
```

Leave this terminal open too. You should see something like:
```
VITE ready
Local: http://localhost:5173/
```

**Now open your browser** to `http://localhost:5173`. That's the app.

If you close either terminal, that half of the app stops working — the
browser tab will still be open but uploads will fail. Just re-run the
relevant command above to bring it back.

## What it actually does right now (v2)

The app now has a sidebar with three pages: **Triage**, **Archive**, and
**Dashboard**. A cycle switcher in the header lets you create and switch
between admissions cycles (e.g. "2026-2027") — applicants are uploaded
into whichever cycle is currently selected, and every page only shows
that cycle's data.

### Cycles

Click the cycle switcher in the header to create a new cycle or switch
between existing ones. You must select (or create) a cycle before
uploading — applicants always belong to exactly one cycle. Deleting a
cycle does NOT delete its applicants; they're moved to an automatic
"Unassigned" cycle instead.

### Triage page

This is the original main screen. For each uploaded CAAPID PDF, it checks
for:

1. Official NBDE
2. Official TOEFL
3. Official ECE GPA
4. Dental Related Experience
5. A letter of recommendation from an evaluator whose Title or Occupation
   is "Dean" or "Principal" (this deliberately ignores job titles like
   "Principal Dentist and Owner" found in work experience entries — only
   real letter-of-recommendation evaluators count)
6. Employment — **default rule, not yet confirmed**: flagged present if
   there is at least one experience entry marked "Recognition Type:
   Compensated," regardless of whether it's dental-related. If this isn't
   the intended definition, this is the one item still worth raising with
   the stakeholder.

Applicants are organized into **Not Reviewed** (split into Complete vs.
Incomplete), **Invited to Interview**, and **Not Invited to Interview**.
Click a row to expand it in place and see the checklist, change status,
or open the full PDF viewer. Search, filter by missing item, bulk-select
and bulk-change status, export to CSV, undo-able delete, keyboard
shortcuts, and "next unreviewed" all work as before.

### Archive page

Shows only Invited and Not Invited applicants for the current cycle —
the ones you've already made a decision on. Same expandable-row checklist
and status-change controls as Triage. If you change someone's status back
to Not Reviewed, they disappear from here and reappear on Triage.

### Dashboard page

Shows counts (total / complete / incomplete / invited / not invited) for
the current cycle, a review-progress bar, and a breakdown of which
checklist items are most commonly missing across all applicants — useful
for spotting patterns (e.g. if half of applicants are missing the same
item, that may point to an upstream issue).

Uploaded PDFs and their parsed results are saved to a local SQLite
database (`backend/evaluation_studio.db`) and a `backend/_uploaded_pdfs/`
folder. Closing and restarting the backend does NOT lose your data.

## What it does NOT do yet

- No OCR. Everything is read from the PDF's native text layer. This works
  because CAAPID applications are machine-generated with consistent text,
  not scanned images, for all the sections this tool checks. Embedded
  scanned attachments (diplomas, license cards, signed letter images) are
  viewable in the PDF viewer but not auto-verified by the app.
- No login/accounts. It's a single-user local tool for now.
- No multi-machine sync. The database and PDFs live only on whichever
  machine runs the backend.
- No Settings page yet (deliberately skipped per request).

## Files

```
backend/
  main.py            FastAPI app — the endpoints the frontend calls
  parser.py          The actual PDF-checking logic (PyMuPDF-based)
  db.py              SQLite persistence (cycles + applicants + reports)
  requirements.txt

frontend/
  src/App.tsx                    Shell: navbar, cycle switcher, footer
  src/CycleContext.tsx           Shared cycle state used by every page
  src/components/CycleSwitcher.tsx   Header dropdown to switch/create cycles
  src/pages/TriagePage.tsx       Main triage screen (upload, review, status)
  src/pages/ArchivePage.tsx      Invited / Not Invited applicants
  src/pages/DashboardPage.tsx    Counts and missing-item breakdown
  src/ApplicantDetail.tsx        Checklist + PDF viewer for one application
  src/types.ts                   Shared data shapes matching the backend's JSON
```

## A note on this specific copy

If you already have an `evaluation_studio.db` file from a previous
version of this app (before cycles existed), **you don't need to delete
it.** The backend automatically adds the new `cycle_id` column on
startup and creates an "Unassigned" cycle, moving all your existing
applicants there. Nothing is lost — switch to "Unassigned" in the cycle
switcher after upgrading to see them.

This version has Vite and its React plugin pinned to specific, stable
versions (`vite@5.4.10`, `@vitejs/plugin-react@4.3.2`) instead of
whatever the newest release happens to be. Newer Vite releases can pull
in an experimental bundler that has a known crash on some Windows/Node
combinations. If `npm install` ever tries to upgrade these on its own
later, and `npm run dev` starts failing with a `styleText` or
`rolldown`-related error, downgrade back to these exact versions:

```
npm install vite@5.4.10 @vitejs/plugin-react@4.3.2 --save-exact
```
