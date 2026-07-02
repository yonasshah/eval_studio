import type { ReviewStatus } from './types';

// Statuses whose backend PATCH requires or auto-generates a review_comment,
// and therefore need the reviewer to go through StatusCommentModal instead
// of being applied instantly:
//   - not_invited: comment is REQUIRED (a justification for the decision).
//   - invited: an "MIR" note is always recorded automatically, with any
//     additional text the reviewer types appended after it.
export function statusRequiresCommentStep(status: ReviewStatus): boolean {
  return status === 'not_invited' || status === 'invited';
}

export const INVITED_DEFAULT_NOTE = 'MIR';

// When re-opening the modal to edit an already-"Invited" applicant's
// comment, strip the leading "MIR" note so the textarea only shows the
// reviewer's own additional text (the MIR prefix gets re-added by the
// backend on save, not typed by the user).
export function extractInvitedExtra(comment: string | null | undefined): string {
  if (!comment) return '';
  const trimmed = comment.trim();
  if (trimmed === INVITED_DEFAULT_NOTE) return '';
  if (trimmed.startsWith(`${INVITED_DEFAULT_NOTE}; `)) {
    return trimmed.slice(INVITED_DEFAULT_NOTE.length + 2);
  }
  if (trimmed.startsWith(`${INVITED_DEFAULT_NOTE};`)) {
    return trimmed.slice(INVITED_DEFAULT_NOTE.length + 1).trim();
  }
  // Legacy/manually-entered comment without the MIR prefix -- show as-is
  // so it isn't silently dropped when the reviewer re-opens this modal.
  return trimmed;
}