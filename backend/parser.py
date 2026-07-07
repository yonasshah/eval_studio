"""
parser.py

CAAPID application PDF parser. Determines, per applicant:
  1. Whether each required "jump to" section is present, and where (page + bbox).
  2. Whether at least one letter evaluator holds a Dean/Principal title or
     occupation, scoped strictly to EVALUATOR INFORMATION blocks (avoids false
     hits on job titles like "Principal Dentist and Owner" in work experience).
  3. Whether an "Employment" (compensated experience) entry exists.
  4. ECE GPA, TOEFL total score, aggregated dental experience hours, and
     applicant country -- displayed in the checklist for quick review.

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
    employment_note: str = "Any compensated dental/healthcare experience"
    is_complete: bool = False
    missing_items: list[str] = field(default_factory=list)
    # New parsed data fields
    ece_gpa: str | None = None
    toefl_total: float | None = None
    toefl_is_new_scale: bool = False
    dental_experience_hours: int | None = None
    applicant_country: str | None = None

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
    EVALUATOR INFORMATION header, in visual top-to-bottom order.
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
    lines somewhere on page 1, but NOT necessarily as the first line.
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
        full_text = doc[0].get_text()
        m = id_pattern.search(full_text)
        applicant_id = m.group(1) if m else None

    name_pattern = re.compile(r"^[A-Za-z'\- ]+,\s*[A-Za-z'\- ]+$")
    candidates = [
        (text.strip(), bbox) for text, bbox in lines if name_pattern.match(text.strip())
    ]

    name = None
    if candidates:
        if id_bbox is not None:
            candidates.sort(key=lambda c: abs(c[1].y0 - id_bbox.y0))
        name = candidates[0][0]

    return name, applicant_id


def _extract_ece_gpa(doc) -> str | None:
    """
    Extract the Comprehensive GPA from the OFFICIAL ECE GPA section.

    The section renders as a table with columns:
        Institution | Credential | Best GPA | Comprehensive GPA

    After whitespace normalization the relevant row looks like:
        "Baba Farid University of Health Sciences Five years of study in a dentistry program 0.00 3.92"

    The Comprehensive GPA is always the LAST numeric value in a table row
    that also contains a Best GPA (often 0.00). We specifically look for
    "Comprehensive GPA" as a column header to anchor our search, then take
    the value that follows it in the data rows.

    Strategy:
    1. Find "Comprehensive GPA" header text -- this anchors us to the right
       column. The value we want appears after this header in the normalized
       text (one per dentistry-credential row).
    2. Among all decimal numbers after "Comprehensive GPA", pick the last
       non-zero one (the one associated with the dentistry row). If all are
       zero, return "0.00" so the UI can display it accurately rather than
       showing nothing.
    3. Fallback: if "Comprehensive GPA" header isn't found but the section
       exists, take the last decimal number on the page after the section
       header (avoids grabbing Best GPA which is always listed first).
    """
    gpa_section_pattern = re.compile(r"OFFICIAL ECE GPA", re.IGNORECASE)
    comprehensive_header = re.compile(r"Comprehensive\s+GPA", re.IGNORECASE)
    decimal_pattern = re.compile(r"\b(\d+\.\d{1,2})\b")

    for page_idx in range(len(doc)):
        text = doc[page_idx].get_text()
        normalized = re.sub(r"\s+", " ", text)

        if not gpa_section_pattern.search(normalized):
            continue

        # Strategy 1: anchor on "Comprehensive GPA" column header text,
        # then collect all decimal values that follow it. The comprehensive
        # GPA is after this header; Best GPA appears before it.
        comp_match = comprehensive_header.search(normalized)
        if comp_match:
            after_comp = normalized[comp_match.end():]
            # Collect all decimal numbers after the Comprehensive GPA header
            values = []
            for m in decimal_pattern.finditer(after_comp):
                val = float(m.group(1))
                if 0.0 <= val <= 5.0:  # ECES scale goes to ~4.3
                    values.append(m.group(1))
            if values:
                # Prefer the last non-zero value (the dentistry row's GPA).
                # If there are multiple rows (e.g. high school + dentistry),
                # the dentistry row is typically last.
                non_zero = [v for v in values if float(v) > 0]
                return non_zero[-1] if non_zero else values[-1]

        # Strategy 2: fallback -- take the last decimal number in the section.
        # In the table layout, columns are: Institution, Credential, Best GPA,
        # Comprehensive GPA -- so the last number is Comprehensive GPA.
        section_start = gpa_section_pattern.search(normalized)
        if section_start:
            after_header = normalized[section_start.end():]
            all_vals = [
                m.group(1)
                for m in decimal_pattern.finditer(after_header)
                if 0.0 <= float(m.group(1)) <= 5.0
            ]
            if all_vals:
                non_zero = [v for v in all_vals if float(v) > 0]
                return non_zero[-1] if non_zero else all_vals[-1]

    return None


def _extract_toefl_score(doc) -> tuple[float | None, bool]:
    """
    Extract TOEFL total score from the OFFICIAL TOEFL Score section only.

    The page may contain multiple TOEFL sections:
      - OFFICIAL TOEFL Score       (pre-2026, scores out of 120 -- what we want)
      - UNOFFICIAL TOEFL           (has a Test Reg ID column that confuses number parsing)
      - OFFICIAL TOEFL IBT         (post-2026, scores out of 6)
      - UNOFFICIAL TOEFL IBT       (post-2026 unofficial)

    We scope extraction to the text between "OFFICIAL TOEFL Score" and the
    next section header so we never accidentally grab a subscore from the iBT
    section (where 6.0 is a Listening subscore, not the total) or a Test
    Reg ID from the Unofficial section (a 16-digit number that breaks the
    subscore-count heuristic).

    For the pre-2026 table, subscores (L/R/S/W) are each 0-30 (1-2 digits)
    and the total is 30-120 (2-3 digits). We require the captured total to
    NOT be immediately followed by a hyphen, which rules out date parts like
    "07" from "07-06-2024" that previously caused the wrong value to be
    returned when two score rows appeared back-to-back.

    For post-2026 (iBT section), the total is explicitly labeled and <= 6.

    Returns (total_score, is_new_scale).
    """
    official_score_section = re.compile(r"OFFICIAL TOEFL Score", re.IGNORECASE)
    # Stop before Unofficial or the new iBT section
    next_section = re.compile(r"UNOFFICIAL TOEFL|OFFICIAL TOEFL IBT", re.IGNORECASE)

    # Pre-2026: Internet/Paper/Computer-based row with 2-5 single/double-digit
    # subscores followed by a 2-3 digit total not immediately trailed by a hyphen
    pre_scale_pattern = re.compile(
        r"(?:Internet[\-\s]based|Paper[\-\s]based|Computer[\-\s]based)\s+"
        r"(?:\d{1,2}\s+){2,5}"
        r"(\d{2,3})(?!\s*-)",
        re.IGNORECASE,
    )

    # Post-2026 iBT: look in the OFFICIAL TOEFL IBT section for a Total column value <= 6
    ibt_section = re.compile(r"OFFICIAL TOEFL IBT", re.IGNORECASE)
    ibt_total_pattern = re.compile(
        r"(?:\d+\.\d+\s+){3,}"   # several x.x subscores
        r"(\d+\.\d+)",             # final x.x = total
        re.IGNORECASE,
    )

    for page_idx in range(len(doc)):
        text = doc[page_idx].get_text()
        normalized = re.sub(r"\s+", " ", text)

        # --- Pre-2026 Official TOEFL Score section ---
        sec_m = official_score_section.search(normalized)
        if sec_m:
            after = normalized[sec_m.end():]
            end_m = next_section.search(after)
            window = after[:end_m.start()] if end_m else after

            m = pre_scale_pattern.search(window)
            if m:
                return float(m.group(1)), False

        # --- Post-2026 Official TOEFL IBT section ---
        ibt_m = ibt_section.search(normalized)
        if ibt_m:
            after_ibt = normalized[ibt_m.end():]
            # Stop before Unofficial IBT
            unofficial_ibt = re.search(r"UNOFFICIAL TOEFL IBT", after_ibt, re.IGNORECASE)
            ibt_window = after_ibt[:unofficial_ibt.start()] if unofficial_ibt else after_ibt

            m = ibt_total_pattern.search(ibt_window)
            if m:
                total = float(m.group(1))
                if total <= 6:
                    return total, True

    return None, False


def _extract_dental_experience_hours(doc) -> int | None:
    """
    Extract the aggregate dental related experience total hours.

    The section header reads:
        DENTAL RELATED EXPERIENCE    TOTAL HOURS: 11551

    or sometimes across two lines:
        DENTAL RELATED EXPERIENCE
        TOTAL HOURS: 11551

    We look for "TOTAL HOURS" near the dental experience section and
    parse the integer value that follows the colon.
    """
    dental_pattern = re.compile(r"DENTAL RELATED EXPERIENCE", re.IGNORECASE)
    hours_pattern = re.compile(r"TOTAL HOURS\s*[:\s]+(\d[\d,]*)", re.IGNORECASE)

    for page_idx in range(len(doc)):
        text = doc[page_idx].get_text()
        normalized = re.sub(r"\s+", " ", text)
        if not dental_pattern.search(normalized):
            continue

        m = hours_pattern.search(normalized)
        if m:
            # Remove commas from numbers like "11,551"
            return int(m.group(1).replace(",", ""))

    return None


def _extract_applicant_country(doc) -> str | None:
    """
    Extract the applicant's country from the CITIZENSHIP STATUS AND RESIDENCY
    INFORMATION section. The field label is "Country of Citizenship:" and the
    value is the country name immediately following it, e.g.:

        Country of Citizenship:    India
        Country of Citizenship:    New Zealand
        Country of Citizenship:    Korea, Republic of

    After whitespace normalization this looks like:
        "Country of Citizenship: New Zealand State of Residence: Indiana ..."

    We stop at the next known field label in this section (all of which are
    fixed CAAPID field names) rather than using a generic capitalized-word
    heuristic, which was incorrectly treating "Zealand" in "New Zealand" as
    the start of a new field.
    """
    country_pattern = re.compile(
        r"Country of Citizenship\s*:\s*(.+?)"
        r"(?=\s+(?:State of Residence|County of Residence|Length of Residence"
        r"|Other Citizenship|Citizenship Status|Length of stay)\s*:)",
        re.IGNORECASE,
    )
    skip_values = {"—", "-", "n/a", "na", "not applicable", ""}

    for page_idx in range(len(doc)):
        text = doc[page_idx].get_text()
        normalized = re.sub(r"\s+", " ", text)

        if "Country of Citizenship" not in normalized:
            continue

        m = country_pattern.search(normalized)
        if m:
            val = m.group(1).strip().rstrip(",").strip()
            if val in ("—", "-") or val.lower() in skip_values:
                return None
            if len(val) < 2 or len(val) > 60:
                continue
            if re.search(r"\d", val):
                continue
            return val

    return None


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

        # Extract additional parsed data fields
        report.ece_gpa = _extract_ece_gpa(doc)
        report.toefl_total, report.toefl_is_new_scale = _extract_toefl_score(doc)
        report.dental_experience_hours = _extract_dental_experience_hours(doc)
        report.applicant_country = _extract_applicant_country(doc)

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
    print(f"ECE GPA: {report.ece_gpa}")
    print(f"TOEFL Total: {report.toefl_total} ({'new scale' if report.toefl_is_new_scale else 'pre-2026'})")
    print(f"Dental Hours: {report.dental_experience_hours}")
    print(f"Country: {report.applicant_country}")