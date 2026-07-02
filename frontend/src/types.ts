export interface BBox {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SectionMatch {
  key: string;
  label: string;
  found: boolean;
  page: number | null;
  bbox: BBox | null;
}

export interface EvaluatorInfo {
  name: string;
  title: string;
  occupation: string;
  info_page: number;
  is_dean_or_principal: boolean;
  letter_page: number | null;
}

export type ReviewStatus = 'not_reviewed' | 'invited' | 'not_invited' | 'waitlisted';

export interface ApplicantReport {
  filename: string;
  applicant_name: string | null;
  applicant_id: string | null;
  total_pages: number;
  sections: SectionMatch[];
  evaluators: EvaluatorInfo[];
  employment_found: boolean;
  employment_page: number | null;
  employment_note: string;
  is_complete: boolean;
  missing_items: string[];
  file_id?: string;
  error?: string;
  review_status?: ReviewStatus;
  // Justification for not_invited (required), auto "MIR" note (+ optional
  // extra text) for invited, or an optional free-text note for
  // waitlisted/not_reviewed.
  review_comment?: string | null;
  cycle_id?: string;
}

export interface Cycle {
  cycle_id: string;
  name: string;
  created_at: string;
  applicant_count: number;
}

export interface BatchParseResponse {
  results: ApplicantReport[];
}

// A single combined "jump target" the UI can render as one row in the
// checklist, regardless of whether it came from a section match or the
// dean/principal evaluator check.
export interface ChecklistItem {
  label: string;
  found: boolean;
  page: number | null;
  detail?: string;
  // Separate from `page` -- this is a fallback jump target shown even when
  // the check itself is missing (e.g. "no Dean/Principal found, but here's
  // where the evaluators section starts so you can look yourself").
  jumpPage?: number | null;
  jumpLabel?: string;
}

export function toChecklistItems(report: ApplicantReport): ChecklistItem[] {
  const items: ChecklistItem[] = report.sections.map((s) => ({
    label: s.label,
    found: s.found,
    page: s.page,
  }));

  const deanPrincipal = report.evaluators.find((e) => e.is_dean_or_principal);
  const firstEvaluator = report.evaluators[0];

  items.push({
    label: 'Dean/Principal evaluator letter',
    found: !!deanPrincipal,
    page: deanPrincipal?.letter_page ?? null,
    detail: deanPrincipal
      ? `${deanPrincipal.name} (${deanPrincipal.occupation || deanPrincipal.title})`
      : report.evaluators.length > 0
        ? `No Dean/Principal among ${report.evaluators.length} evaluator(s) found — worth a manual look`
        : 'No evaluators found in this application',
    // Even when no Dean/Principal match exists, offer a jump to wherever
    // the evaluators section starts (if there are any evaluators at all)
    // so the reviewer can check for themselves rather than being stuck
    // with no jump option at all.
    jumpPage: deanPrincipal?.letter_page ?? firstEvaluator?.info_page ?? null,
    jumpLabel: deanPrincipal ? undefined : firstEvaluator ? 'View evaluators' : undefined,
  });

  items.push({
    label: 'Employment',
    found: report.employment_found,
    page: report.employment_page,
    detail: 'default rule — confirm with stakeholder',
  });

  return items;
}

export const STATUS_META: Record<ReviewStatus, { label: string; color: string }> = {
  not_reviewed: { label: 'Not Reviewed', color: 'gray' },
  invited: { label: 'Invited to Interview', color: 'teal' },
  not_invited: { label: 'Not Invited to Interview', color: 'red' },
  waitlisted: { label: 'Waitlisted for Interview', color: 'yellow' },
};

export function getReviewStatus(report: ApplicantReport): ReviewStatus {
  return report.review_status ?? 'not_reviewed';
}