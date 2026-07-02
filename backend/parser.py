"""
parser.py

CAAPID application PDF parser. Determines, per applicant:
  1. Whether each required "jump to" section is present, and where (page + bbox).
  2. Whether at least one letter evaluator holds a Dean/Principal title or
     occupation, scoped strictly to EVALUATOR INFORMATION blocks (avoids false
     hits on job titles like "Principal Dentist and Owner" in work experience).
  3. Whether an "Employment" (compensated experience) entry exists.

Built on PyMuPDF (fitz) instead of pdfplumber so that, in addition to page
numbers, we get exact text bounding boxes -- needed later to highlight the
matched text in the PDF.js viewer, not just flip to the right page.

Pure text-layer parsing. No OCR. Validated against a real CAAPID export with
both a complete version and a deliberately-stripped "incomplete" version.
"""

import re
import fitz  # PyMuPDF
from dataclasses import dataclass, field, asdict


@dataclass
class BBox:
    page: int          # 1-indexed
    x0: float
    y0: float
    x1: float
    y1: float


@dataclass
class SectionMatch:
    key: str
    label: str
    found: bool
    page: int | None = None
    bbox: BBox | None = None


@dataclass
class EvaluatorInfo:
    name: str
    title: str
    occupation: str
    info_page: int
    is_dean_or_principal: bool
    letter_page: int | None = None


@dataclass
class ApplicantReport:
    filename: str
    applicant_name: str | None
    applicant_id: str | None
    total_pages: int
    sections: list[SectionMatch] = field(default_factory=list)
    evaluators: list[EvaluatorInfo] = field(default_factory=list)
    employment_found: bool = False
    employment_page: int | None = None
    employment_note: str = "default rule: any 'Recognition Type: Compensated' entry -- confirm with stakeholder"
    is_complete: bool = False
    missing_items: list[str] = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


SECTION_HEADERS = {
    "official_nbde": ("Official NBDE", r"(?<![A-Za-z])OFFICIAL NBDE\b"),
    "official_toefl": ("Official TOEFL", r"(?<![A-Za-z])OFFICIAL TOEFL\b"),
    "official_ece_gpa": ("Official ECE GPA", r"(?<![A-Za-z])OFFICIAL ECE GPA\b"),
    "dental_experience": ("Dental Related Experience", r"DENTAL RELATED EXPERIENCE\s+TOTAL HOURS"),
}

EVALUATOR_BLOCK_HEADER = "EVALUATOR INFORMATION"
DEAN_PRINCIPAL_PATTERN = re.compile(r"\b(dean|principal)\b", re.IGNORECASE)
COMPENSATED_PATTERN = re.compile(r"Recognition Type:\s*Compensated", re.IGNORECASE)


def _find_employment(doc) -> tuple[bool, int | None]:
    for page_idx in range(len(doc)):
        text = doc[page_idx].get_text()
        normalized = re.sub(r"\s+", " ", text)
        if COMPENSATED_PATTERN.search(normalized):
            return True, page_idx + 1
    return False, None


def _page_lines_with_boxes(page) -> list[tuple[str, fitz.Rect]]:
    """Return each line of text on a page along with its bounding box."""
    lines = []
    data = page.get_text("dict")
    for block in data.get("blocks", []):
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line.get("spans", [])).strip()
            if not text:
                continue
            bbox = fitz.Rect(line["bbox"])
            lines.append((text, bbox))
    return lines


def _find_section_headers(doc) -> dict[str, SectionMatch]:
    results = {}
    for key, (label, pattern) in SECTION_HEADERS.items():
        results[key] = SectionMatch(key=key, label=label, found=False)

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        page_text = page.get_text()
        # Collapse all whitespace (including newlines from wrapped headers,
        # e.g. PyMuPDF splits "DENTAL RELATED EXPERIENCE" and "TOTAL HOURS: 11551"
        # onto separate lines even though pdfplumber joins them) so header
        # matching is robust to how a given extraction engine wraps text.
        normalized = re.sub(r"\s+", " ", page_text)
        lines = _page_lines_with_boxes(page)

        for key, (label, pattern) in SECTION_HEADERS.items():
            if results[key].found:
                continue
            if re.search(pattern, normalized, re.IGNORECASE):
                results[key].found = True
                results[key].page = page_idx + 1
                # Best-effort bbox: use the first line whose text starts with
                # the first word of the label, for highlighting purposes.
                first_word = label.split()[0]
                for text, bbox in lines:
                    if text.upper().startswith(first_word.upper()):
                        results[key].bbox = BBox(
                            page=page_idx + 1, x0=bbox.x0, y0=bbox.y0, x1=bbox.x1, y1=bbox.y1
                        )
                        break
    return results


def _extract_evaluator_block_text(doc, page_idx: int) -> str:
    """
    Extract the Title/Occupation/Organization/etc. lines that follow an
    EVALUATOR INFORMATION header on this page, using position-sorted lines
    rather than raw get_text() order. PyMuPDF's default text order does not
    reliably match visual top-to-bottom reading order for this document's
    two-column, header/footer-heavy layout -- a running corner header can be
    emitted after the main body text it visually precedes. Sorting by
    vertical position (top to bottom) before scanning avoids depending on
    extraction-order quirks.
    """
    lines = _page_lines_with_boxes(doc[page_idx])
    lines_sorted = sorted(lines, key=lambda lb: (round(lb[1].y0), lb[1].x0))

    capture, capturing = [], False
    for text, _bbox in lines_sorted:
        if EVALUATOR_BLOCK_HEADER in text:
            capturing = True
            continue
        if capturing:
            if "REFERENCE RATINGS" in text:
                break
            capture.append(text)
    return "\n".join(capture)


def _parse_title_occupation(block_text: str) -> tuple[str, str]:
    """
    block_text is newline-joined lines in visual top-to-bottom order. Each
    field appears as its own "Label:" line immediately followed by one or
    more value lines (e.g. "Title:\nGovt" or "Title:\nProfessor and Head of\nDepartment"),
    unlike pdfplumber's layout which kept label and value on the same line.
    """
    field_labels = {"Title", "Occupation", "Organization", "Email", "Phone", "Date Completed", "Status"}
    lines = block_text.split("\n")

    title, occupation = "", ""
    current_label = None
    current_value_parts = []

    def flush():
        if current_label == "Title":
            nonlocal title
            title = " ".join(current_value_parts).strip()
        elif current_label == "Occupation":
            nonlocal occupation
            occupation = " ".join(current_value_parts).strip()

    for raw_line in lines:
        line = raw_line.strip()
        label_match = None
        for lbl in field_labels:
            if line == f"{lbl}:" or line.startswith(f"{lbl}:"):
                label_match = lbl
                # value might be on the same line after the colon (pdfplumber-style)
                same_line_value = line[len(lbl) + 1:].strip()
                break
        if label_match:
            flush()
            current_label = label_match
            current_value_parts = [same_line_value] if same_line_value else []
        elif current_label:
            current_value_parts.append(line)
    flush()

    return title, occupation


def _extract_evaluator_name(doc, page_idx: int) -> str:
    """
    The evaluator's name is the first line immediately following the
    EVALUATOR INFORMATION header, in visual top-to-bottom order, e.g.
    'EVALUATOR INFORMATION' -> 'Renu Bala Sroa' -> 'Title:' -> 'Govt' ...
    """
    lines = _page_lines_with_boxes(doc[page_idx])
    lines_sorted = sorted(lines, key=lambda lb: (round(lb[1].y0), lb[1].x0))

    for idx, (text, _bbox) in enumerate(lines_sorted):
        if EVALUATOR_BLOCK_HEADER in text:
            if idx + 1 < len(lines_sorted):
                candidate = lines_sorted[idx + 1][0].strip()
                if candidate and not candidate.startswith("Type:"):
                    return candidate
    return "Unknown evaluator"


def _find_letter_page_for_evaluator(doc, info_page_idx: int) -> int:
    """
    The evaluator's free-text letter narrative typically begins on the same
    page as their EVALUATOR INFORMATION block, directly after REFERENCE
    RATINGS. If not found there, scan forward up to 4 pages for their
    attached scanned letter, stopping if we hit the next evaluator's block.
    """
    text = doc[info_page_idx].get_text()
    if "(" in text and "REFERENCE RATINGS" in text:
        return info_page_idx + 1

    for offset in range(1, 5):
        idx = info_page_idx + offset
        if idx >= len(doc):
            break
        next_text = doc[idx].get_text()
        if EVALUATOR_BLOCK_HEADER in next_text:
            break
        if next_text.strip():
            return idx + 1

    return info_page_idx + 1


def _find_evaluators(doc) -> list[EvaluatorInfo]:
    evaluators = []
    seen_names = set()

    for page_idx in range(len(doc)):
        text = doc[page_idx].get_text()
        if EVALUATOR_BLOCK_HEADER not in text:
            continue

        block_text = _extract_evaluator_block_text(doc, page_idx)
        title, occupation = _parse_title_occupation(block_text)
        name = _extract_evaluator_name(doc, page_idx)

        if not title and not occupation:
            continue  # continuation page of an already-seen evaluator
        if name in seen_names:
            continue
        seen_names.add(name)

        is_match = bool(
            DEAN_PRINCIPAL_PATTERN.search(title) or DEAN_PRINCIPAL_PATTERN.search(occupation)
        )
        letter_page = _find_letter_page_for_evaluator(doc, page_idx) if is_match else None

        evaluators.append(
            EvaluatorInfo(
                name=name,
                title=title,
                occupation=occupation,
                info_page=page_idx + 1,
                is_dean_or_principal=is_match,
                letter_page=letter_page,
            )
        )

    return evaluators


def _extract_applicant_identity(doc) -> tuple[str | None, str | None]:
    """
    Pull applicant name + ID from the repeated page header/footer text, e.g.
    'Kant, Disha' / 'Applicant ID:7563886789'. These appear as their own
    lines somewhere on page 1, but NOT necessarily as the first line --
    PyMuPDF's block-reading order can place the main body content (e.g.
    'BIOGRAPHIC INFORMATION') before the page-corner header text it
    visually follows. So we search every line on the page, not just the
    first one. The pattern requires a comma (Last, First) to avoid
    matching a bare single-word line like 'Kant' that appears separately
    as the value of the 'Last Name:' field.

    CAAPID pages also contain "Country, State of"-shaped values (e.g.
    citizenship/country of birth fields such as "Palestine, State of" or
    "Korea, Republic of") which match this same "Word, Word" comma pattern.
    When more than one candidate line matches on a page, picking the first
    one in extraction order is unreliable and can grab the country field
    instead of the applicant's actual name. To disambiguate, we use the
    fact that the applicant's name and "Applicant ID:" are printed
    together as part of the same repeated page header -- so among all
    comma-pattern candidates, we pick whichever sits closest (vertically)
    to the "Applicant ID:" line, rather than just the first match found.
    """
    if len(doc) == 0:
        return None, None

    lines = _page_lines_with_boxes(doc[0])

    id_pattern = re.compile(r"Applicant ID:\s*(\d+)")
    applicant_id = None
    id_bbox = None
    for text, bbox in lines:
        m = id_pattern.search(text)
        if m:
            applicant_id = m.group(1)
            id_bbox = bbox
            break
    if applicant_id is None:
        # Fallback in case the ID line's spans didn't come through cleanly
        # in _page_lines_with_boxes for some reason.
        full_text = doc[0].get_text()
        m = id_pattern.search(full_text)
        applicant_id = m.group(1) if m else None

    name_pattern = re.compile(r"^[A-Za-z'\-]+,\s*[A-Za-z'\- ]+$")
    candidates = [
        (text.strip(), bbox) for text, bbox in lines if name_pattern.match(text.strip())
    ]

    name = None
    if candidates:
        if id_bbox is not None:
            candidates.sort(key=lambda c: abs(c[1].y0 - id_bbox.y0))
        name = candidates[0][0]

    return name, applicant_id


def parse_caapid_pdf(path: str, filename: str | None = None) -> ApplicantReport:
    doc = fitz.open(path)
    try:
        name, applicant_id = _extract_applicant_identity(doc)

        report = ApplicantReport(
            filename=filename or path,
            applicant_name=name,
            applicant_id=applicant_id,
            total_pages=len(doc),
        )

        section_results = _find_section_headers(doc)
        report.sections = list(section_results.values())

        report.evaluators = _find_evaluators(doc)
        dean_principal_found = any(e.is_dean_or_principal for e in report.evaluators)

        report.employment_found, report.employment_page = _find_employment(doc)

        missing = [s.label for s in report.sections if not s.found]
        if not dean_principal_found:
            missing.append("Dean/Principal evaluator letter")
        if not report.employment_found:
            missing.append("Employment")

        report.missing_items = missing
        report.is_complete = len(missing) == 0

        return report
    finally:
        # Previously doc.close() only ran on the success path -- if any of
        # the parsing steps above raised (e.g. a malformed/unusual PDF),
        # the fitz.Document was left open. On Windows especially, PyMuPDF
        # holds an OS-level lock on the file until close() runs, so a
        # leaked handle here would make the caller's cleanup
        # (os.remove(dest_path) in main.py's except block) fail with a
        # PermissionError instead of actually deleting the bad upload.
        # finally guarantees close() runs on every exit path, exception or
        # not.
        doc.close()


if __name__ == "__main__":
    import sys
    import json

    path = sys.argv[1]
    report = parse_caapid_pdf(path)
    print(json.dumps(report.to_dict(), indent=2, default=str))
    print()
    print(f"COMPLETE: {report.is_complete}")
    if not report.is_complete:
        print(f"MISSING: {report.missing_items}")