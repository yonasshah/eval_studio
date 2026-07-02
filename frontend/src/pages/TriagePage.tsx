import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Title,
  Text,
  Group,
  Stack,
  Button,
  FileButton,
  Card,
  Badge,
  Loader,
  Center,
  Divider,
  TextInput,
  Select,
  Menu,
  ThemeIcon,
  Checkbox,
  Collapse,
  UnstyledButton,
  Tooltip,
} from '@mantine/core';
import {
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconUpload,
  IconTrash,
  IconSearch,
  IconDownload,
  IconChevronDown,
  IconExternalLink,
  IconChecklist,
  IconArrowRight,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import type { ApplicantReport, ReviewStatus } from '../types';
import { toChecklistItems, STATUS_META, getReviewStatus } from '../types';
import ApplicantDetail from '../ApplicantDetail';
import { useCycles, API_BASE } from '../CycleContext';
import StatusCommentModal, { type CommentModalRequest } from '../StatusCommentModal';
import { statusRequiresCommentStep } from '../statusChange';

const LAST_VIEWED_KEY = 'evalStudio.lastViewedFileId';

// Each section (Not Reviewed/Complete, Not Reviewed/Incomplete, Invited,
// Not Invited, Waitlisted) has its own selection set -- selecting rows in
// one section never affects another, per the requirement that bulk-select
// is scoped to a single section at a time.
type SectionKey = 'nrComplete' | 'nrIncomplete' | 'invited' | 'notInvited' | 'waitlisted';

export default function TriagePage() {
  const { selectedCycleId, selectedCycle, refreshCycles } = useCycles();
  const [reports, setReports] = useState<ApplicantReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [openDetail, setOpenDetail] = useState<ApplicantReport | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [missingFilter, setMissingFilter] = useState<string>('all');

  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Record<SectionKey, Set<string>>>({
    nrComplete: new Set(),
    nrIncomplete: new Set(),
    invited: new Set(),
    notInvited: new Set(),
    waitlisted: new Set(),
  });

  // Collapse state for each section, independent of one another. All
  // default to open so the page looks the same as before until the user
  // actively collapses something.
  const [collapsed, setCollapsed] = useState({
    notReviewed: false,
    nrComplete: false,
    nrIncomplete: false,
    invited: false,
    notInvited: false,
    waitlisted: false,
  });

  // When set, StatusCommentModal is open and applying the modal's comment
  // to whatever apply() was configured to do (a single applicant's status
  // change, or a bulk one).
  const [commentModal, setCommentModal] = useState<CommentModalRequest | null>(null);

  function toggleCollapsed(key: keyof typeof collapsed) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Resume-session prompt: only checked once per app load, not every time
  // the selected cycle changes, so switching cycles repeatedly doesn't
  // keep re-showing "welcome back". Scoped to the selected cycle so an
  // applicant from a different (or now-deleted) cycle doesn't trigger it,
  // and only shown when the applicant is still Not Reviewed -- a fully
  // reviewed applicant doesn't need a "resume" prompt.
  useEffect(() => {
    const lastId = localStorage.getItem(LAST_VIEWED_KEY);
    if (!lastId || !selectedCycleId) return;
    fetch(`${API_BASE}/api/applicants?cycle_id=${selectedCycleId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const results: ApplicantReport[] = data.results ?? [];
        const match = results.find(
          (r) => r.file_id === lastId && getReviewStatus(r) === 'not_reviewed'
        );
        if (match) {
          notifications.show({
            id: 'resume-session',
            title: 'Welcome back',
            message: (
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Text size="sm">Resume where you left off?</Text>
                <Button
                  size="xs"
                  variant="white"
                  color="navy"
                  onClick={() => {
                    setOpenDetail(match);
                    notifications.hide('resume-session');
                  }}
                >
                  Resume
                </Button>
              </Group>
            ),
            color: 'navy',
            autoClose: 8000,
          });
        }
      })
      .catch(() => {
        /* resume-session is a nice-to-have; a failure here shouldn't
           surface as an error banner since the main load effect below
           will report connectivity problems anyway. */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load applicants for the currently-selected cycle. Re-runs whenever
  // the cycle switcher changes, so switching cycles reloads the list to
  // that cycle's applicants instead of leaving stale data on screen.
  useEffect(() => {
    if (!selectedCycleId) {
      setReports([]);
      setLoadingExisting(false);
      return;
    }
    setLoadingExisting(true);
    fetch(`${API_BASE}/api/applicants?cycle_id=${selectedCycleId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setReports(data.results ?? []);
      })
      .catch((e) => {
        setError(
          `Could not reach the backend to load previous uploads: ${
            e instanceof Error ? e.message : e
          }. Is it running on localhost:8000?`
        );
      })
      .finally(() => setLoadingExisting(false));
  }, [selectedCycleId]);

  useEffect(() => {
    if (openDetail?.file_id) {
      localStorage.setItem(LAST_VIEWED_KEY, openDetail.file_id);
    }
  }, [openDetail]);

  // Whenever `reports` changes (e.g. a status/comment update lands),
  // refresh the currently-open detail view from the matching report so
  // there's one source of truth instead of every call site having to
  // remember to also call setOpenDetail.
  useEffect(() => {
    if (!openDetail?.file_id) return;
    const updated = reports.find((r) => r.file_id === openDetail.file_id);
    if (updated && updated !== openDetail) {
      setOpenDetail(updated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports]);

  const [uploadCount, setUploadCount] = useState(0);

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    if (!selectedCycleId) {
      notifications.show({
        title: 'No cycle selected',
        message: 'Create or select a cycle before uploading applications.',
        color: 'orange',
      });
      return;
    }
    setLoading(true);
    setUploadCount(files.length);
    setError(null);

    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    formData.append('cycle_id', selectedCycleId);

    try {
      const res = await fetch(`${API_BASE}/api/parse-batch`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setReports((prev) => [...data.results, ...prev]);

      const succeeded = data.results.filter((r: ApplicantReport) => !r.error).length;
      const failedUploads = data.results.length - succeeded;
      notifications.show({
        title: 'Upload complete',
        message:
          failedUploads > 0
            ? `${succeeded} processed, ${failedUploads} failed.`
            : `${succeeded} application${succeeded === 1 ? '' : 's'} processed.`,
        color: failedUploads > 0 ? 'orange' : 'teal',
        autoClose: 3500,
      });

      // The cycle switcher shows a per-cycle applicant count -- refresh it
      // now so that badge reflects this upload immediately, instead of
      // staying stale until a cycle is created/deleted or the page reloads.
      refreshCycles();
    } catch (e) {
      setError(
        e instanceof Error
          ? `Could not reach the backend: ${e.message}. Is it running on localhost:8000?`
          : 'Unknown error uploading files.'
      );
    } finally {
      setLoading(false);
      setUploadCount(0);
    }
  }

  // Soft-delete: hide the applicant from the list immediately, but don't
  // actually call the DELETE endpoint until a short grace period has
  // passed. A toast with an "Undo" button lets the user cancel within
  // that window. pendingDeleteTimers tracks the timer so it can be
  // cancelled; undoneIds explicitly marks which deletes were undone, so
  // finalizeDelete can reliably tell "should I actually delete this" even
  // though the notification's onClose and the Undo button's click could
  // both end up calling code around the same time.
  const pendingDeleteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const undoneIds = useRef<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  function handleDelete(fileId: string | undefined) {
    if (!fileId) return;
    const target = reports.find((r) => r.file_id === fileId);
    const label = target ? formatApplicantLabel(target) : 'Applicant';

    undoneIds.current.delete(fileId); // clear any stale undo flag from a previous delete of this same id
    setHiddenIds((prev) => new Set(prev).add(fileId));
    setOpenDetail((prev) => (prev?.file_id === fileId ? null : prev));

    const notifId = `delete-${fileId}`;
    notifications.show({
      id: notifId,
      title: 'Removed',
      message: (
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text size="sm">{label} will be deleted.</Text>
          <Button size="xs" variant="white" color="red" onClick={() => undoDelete(fileId)}>
            Undo
          </Button>
        </Group>
      ),
      color: 'red',
      autoClose: 6000,
      withCloseButton: true,
      onClose: () => {
        finalizeDelete(fileId);
      },
    });

    // Fallback timer in case onClose doesn't fire reliably -- ensures the
    // delete still completes even if the notification is dismissed in some
    // way that skips onClose.
    pendingDeleteTimers.current[fileId] = setTimeout(() => finalizeDelete(fileId), 6500);
  }

  function undoDelete(fileId: string) {
    undoneIds.current.add(fileId);
    clearTimeout(pendingDeleteTimers.current[fileId]);
    delete pendingDeleteTimers.current[fileId];
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });
    notifications.hide(`delete-${fileId}`);
    notifications.show({ message: 'Restored.', color: 'teal', autoClose: 2000 });
  }

  async function finalizeDelete(fileId: string) {
    clearTimeout(pendingDeleteTimers.current[fileId]);
    delete pendingDeleteTimers.current[fileId];

    if (undoneIds.current.has(fileId)) {
      // Already undone -- nothing to actually delete.
      undoneIds.current.delete(fileId);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/applicants/${fileId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setReports((prev) => prev.filter((r) => r.file_id !== fileId));
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      refreshCycles();
    } catch (e) {
      setError(`Could not delete this applicant: ${e instanceof Error ? e.message : e}`);
      // Restore visibility since the delete didn't actually succeed.
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  }

  async function handleStatusChange(fileId: string | undefined, status: ReviewStatus, comment?: string) {
    if (!fileId) return;
    try {
      const res = await fetch(`${API_BASE}/api/applicants/${fileId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, comment: comment ?? null }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail || `Server returned ${res.status}`);
      }
      const updated = await res.json();
      setReports((prev) =>
        prev.map((r) =>
          r.file_id === fileId ? { ...r, review_status: status, review_comment: updated.review_comment ?? r.review_comment } : r
        )
      );
      notifications.show({
        message: `Status updated to ${STATUS_META[status].label}.`,
        color: STATUS_META[status].color,
        autoClose: 2500,
      });
    } catch (e) {
      setError(`Could not update status: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Opens the comment modal for statuses that require or auto-generate one
  // (Invited / Not Invited); everything else applies immediately, matching
  // prior behavior.
  function requestStatusChange(report: ApplicantReport, status: ReviewStatus) {
    if (!report.file_id) return;
    if (statusRequiresCommentStep(status)) {
      setCommentModal({
        status,
        applicantLabel: formatApplicantLabel(report),
        existingComment: report.review_comment,
        apply: (comment) => handleStatusChange(report.file_id, status, comment),
      });
    } else {
      handleStatusChange(report.file_id, status);
    }
  }

  // Bulk version: updates every selected file in a section to the same
  // status (and, if supplied, the same comment). Uses allSettled so one
  // failed request doesn't block the rest of the batch from completing.
  async function handleBulkStatusChange(section: SectionKey, status: ReviewStatus, comment?: string) {
    const ids = Array.from(selected[section]);
    if (ids.length === 0) return;

    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`${API_BASE}/api/applicants/${id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, comment: comment ?? null }),
        }).then(async (res) => {
          if (!res.ok) {
            const detail = await res.json().catch(() => null);
            throw new Error(detail?.detail || `Server returned ${res.status}`);
          }
          return id;
        })
      )
    );

    const succeededIds = new Set(
      results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map((r) => r.value)
    );
    const failedCount = results.length - succeededIds.size;

    setReports((prev) =>
      prev.map((r) =>
        r.file_id && succeededIds.has(r.file_id)
          ? { ...r, review_status: status, review_comment: comment !== undefined ? (status === 'invited' ? (comment.trim() ? `MIR; ${comment.trim()}` : 'MIR') : comment) : r.review_comment }
          : r
      )
    );
    clearSectionSelection(section);

    if (succeededIds.size > 0) {
      notifications.show({
        message: `${succeededIds.size} applicant${succeededIds.size === 1 ? '' : 's'} marked ${STATUS_META[status].label}.`,
        color: STATUS_META[status].color,
        autoClose: 2500,
      });
    }
    if (failedCount > 0) {
      setError(`${failedCount} of ${ids.length} status updates failed. Please try those again.`);
    }
  }

  // Opens the comment modal (once, for the whole batch) for statuses that
  // require or auto-generate one; the same comment is then applied to
  // every selected applicant in the section.
  function requestBulkStatusChange(section: SectionKey, status: ReviewStatus) {
    const count = selected[section].size;
    if (count === 0) return;
    if (statusRequiresCommentStep(status)) {
      setCommentModal({
        status,
        applicantLabel: `${count} selected applicant${count === 1 ? '' : 's'}`,
        existingComment: null,
        apply: (comment) => handleBulkStatusChange(section, status, comment),
      });
    } else {
      handleBulkStatusChange(section, status);
    }
  }

  function toggleSelected(section: SectionKey, fileId: string | undefined) {
    if (!fileId) return;
    setSelected((prev) => {
      const next = new Set(prev[section]);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return { ...prev, [section]: next };
    });
  }

  function clearSectionSelection(section: SectionKey) {
    setSelected((prev) => ({ ...prev, [section]: new Set() }));
  }

  function selectAllInSection(section: SectionKey, ids: (string | undefined)[]) {
    setSelected((prev) => ({
      ...prev,
      [section]: new Set(ids.filter((id): id is string => !!id)),
    }));
  }

  function toggleSelectionMode() {
    setSelectionMode((prev) => {
      if (prev) {
        setSelected({
          nrComplete: new Set(),
          nrIncomplete: new Set(),
          invited: new Set(),
          notInvited: new Set(),
          waitlisted: new Set(),
        });
      }
      return !prev;
    });
  }

  function matchesSearch(report: ApplicantReport, query: string): boolean {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      (report.applicant_name?.toLowerCase().includes(q) ?? false) ||
      (report.applicant_id?.toLowerCase().includes(q) ?? false) ||
      report.filename.toLowerCase().includes(q)
    );
  }

  function matchesMissingFilter(report: ApplicantReport, filter: string): boolean {
    if (filter === 'all') return true;
    return report.missing_items.includes(filter);
  }

  const allMissingLabels = useMemo(() => {
    const labels = new Set<string>();
    reports.forEach((r) => r.missing_items?.forEach((m) => labels.add(m)));
    return Array.from(labels).sort();
  }, [reports]);

  const searched = reports.filter(
    (r) =>
      !(r.file_id && hiddenIds.has(r.file_id)) &&
      matchesSearch(r, searchQuery) &&
      matchesMissingFilter(r, missingFilter)
  );

  const failed = searched.filter((r) => r.error);
  const ok = searched.filter((r) => !r.error);

  const notReviewed = ok.filter((r) => getReviewStatus(r) === 'not_reviewed');
  const invited = ok.filter((r) => getReviewStatus(r) === 'invited');
  const notInvited = ok.filter((r) => getReviewStatus(r) === 'not_invited');
  const waitlisted = ok.filter((r) => getReviewStatus(r) === 'waitlisted');

  const notReviewedComplete = notReviewed.filter((r) => r.is_complete);
  const notReviewedIncomplete = notReviewed.filter((r) => !r.is_complete);

  // "Next unreviewed" and its availability deliberately look at the FULL,
  // unfiltered report list for this cycle -- not the search/missing-item
  // filtered `searched`/`ok`/`notReviewed` above. Otherwise, if a missing-
  // item filter is active, this would only ever consider applicants
  // matching that filter, and could falsely report "no unreviewed left"
  // even when plenty exist elsewhere in the cycle, just hidden by the
  // current filter.
  const allNotHidden = reports.filter((r) => !(r.file_id && hiddenIds.has(r.file_id)) && !r.error);
  const allNotReviewed = allNotHidden.filter((r) => getReviewStatus(r) === 'not_reviewed');
  const allNotReviewedComplete = allNotReviewed.filter((r) => r.is_complete);
  const allNotReviewedIncomplete = allNotReviewed.filter((r) => !r.is_complete);

  // Single flat ordering matching the on-screen section order (Not
  // Reviewed/Complete -> Not Reviewed/Incomplete -> Invited -> Not
  // Invited -> Waitlisted). This is the one source of truth that "next
  // applicant", "previous applicant", and "next unreviewed" are all
  // derived from -- since it's recomputed from current `reports` state on
  // every render, changing an applicant's status immediately updates what
  // counts as "next" without any special-casing.
  const visibleOrder = [...notReviewedComplete, ...notReviewedIncomplete, ...invited, ...notInvited, ...waitlisted];

  const stillLoading = loading || loadingExisting;

  // "Next unreviewed" prioritizes complete applications first (the
  // quickest decisions to make), then falls back to incomplete ones if
  // every complete one has already been reviewed. Looks at current state
  // every time it's called, so it correctly becomes available again right
  // after the applicant you're currently viewing gets reviewed.
  function jumpToNextUnreviewed() {
    const next = allNotReviewedComplete[0] ?? allNotReviewedIncomplete[0];
    if (!next) {
      notifications.show({ message: 'No unreviewed applicants left.', color: 'teal', autoClose: 2500 });
      return;
    }
    setOpenDetail(next);
  }

  const hasAnyUnreviewed = allNotReviewedComplete.length > 0 || allNotReviewedIncomplete.length > 0;

  function jumpToAdjacent(direction: 'next' | 'prev') {
    if (!openDetail?.file_id) return;
    const idx = visibleOrder.findIndex((r) => r.file_id === openDetail.file_id);
    if (idx === -1) return; // current applicant got filtered out (e.g. by search) -- nowhere defined to go
    const targetIdx = direction === 'next' ? idx + 1 : idx - 1;
    const target = visibleOrder[targetIdx];
    if (!target) {
      notifications.show({
        message: direction === 'next' ? 'This is the last applicant in the list.' : 'This is the first applicant in the list.',
        color: 'gray',
        autoClose: 2000,
      });
      return;
    }
    setOpenDetail(target);
  }

  // Global keyboard shortcuts. Disabled while typing in any input/textarea
  // so they don't interfere with search, page-jump fields, etc.
  // - 'n': jump to next unreviewed applicant (works from the list view)
  // - 'Escape': close the detail view, back to the list
  // - '1' / '2' / '3' / '4': while viewing an applicant's detail, set their
  //   status to Not Reviewed / Invited / Not Invited / Waitlisted
  //   respectively. Invited/Not Invited route through requestStatusChange
  //   so the required/auto-generated comment modal still appears.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isTyping) return;

      if (e.key === 'n' && !openDetail) {
        e.preventDefault();
        jumpToNextUnreviewed();
      } else if (e.key === 'Escape' && openDetail) {
        e.preventDefault();
        setOpenDetail(null);
      } else if (openDetail && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        const statusOrder: ReviewStatus[] = ['not_reviewed', 'invited', 'not_invited', 'waitlisted'];
        const status = statusOrder[parseInt(e.key, 10) - 1];
        requestStatusChange(openDetail, status);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDetail, notReviewedComplete, notReviewedIncomplete]);

  function splitName(applicantName: string | null | undefined): { last: string; first: string } {
    if (!applicantName) return { last: '', first: '' };
    const parts = applicantName.split(',');
    if (parts.length >= 2) {
      return { last: parts[0].trim(), first: parts.slice(1).join(',').trim() };
    }
    // No comma found -- fall back to putting the whole thing in "last"
    // rather than silently dropping data the parser gave us.
    return { last: applicantName.trim(), first: '' };
  }

  function exportCsv() {
    const headers = [
      'Last Name',
      'First Name',
      'Applicant ID',
      'Completeness',
      'Review Status',
      'Comments',
      'Missing Items',
      'Total Pages',
    ];
    const rows = reports.map((r) => {
      const { last, first } = splitName(r.applicant_name);
      return [
        last,
        first,
        r.applicant_id ?? '',
        r.is_complete ? 'Complete' : 'Missing items',
        STATUS_META[getReviewStatus(r)].label,
        r.review_comment ?? '',
        (r.missing_items ?? []).join('; '),
        String(r.total_pages ?? ''),
      ];
    });

    const escapeCell = (cell: string) => {
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    };

    const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `evaluation-studio-applicants-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function toggleExpand(fileId: string | undefined) {
    if (!fileId || selectionMode) return;
    setExpandedId((prev) => (prev === fileId ? null : fileId));
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <div>
          <Title order={4}>Triage</Title>
          {selectedCycle && (
            <Text size="sm" c="dimmed">
              {selectedCycle.name}
            </Text>
          )}
        </div>
        <Group gap="xs">
          <Tooltip label="Keyboard shortcut: n">
            <Button
              variant="light"
              color="navy"
              leftSection={<IconArrowRight size={16} />}
              onClick={jumpToNextUnreviewed}
              disabled={!hasAnyUnreviewed}
            >
              Next unreviewed
            </Button>
          </Tooltip>
          <Button
            variant={selectionMode ? 'filled' : 'default'}
            color={selectionMode ? 'navy' : undefined}
            leftSection={<IconChecklist size={16} />}
            onClick={toggleSelectionMode}
            disabled={reports.length === 0}
          >
            {selectionMode ? 'Done selecting' : 'Select'}
          </Button>
          <Button
            variant="default"
            leftSection={<IconDownload size={16} />}
            onClick={exportCsv}
            disabled={reports.length === 0}
          >
            Export CSV
          </Button>
          <FileButton onChange={handleFiles} accept="application/pdf" multiple>
            {(props) => (
              <Button {...props} leftSection={<IconUpload size={16} />} color="navy">
                Upload applications
              </Button>
            )}
          </FileButton>
        </Group>
      </Group>

      <div>
        {error && (
          <Card withBorder mb="md" bg="red.0">
            <Text c="red.8" size="sm">
              {error}
            </Text>
          </Card>
        )}

        {stillLoading && (
          <Center py="xl">
            <Stack align="center" gap="xs">
              <Loader color="navy" />
              <Text size="sm" c="dimmed">
                {loadingExisting
                  ? 'Loading previously uploaded applications…'
                  : `Reading ${uploadCount} application${uploadCount === 1 ? '' : 's'}...`}
              </Text>
            </Stack>
          </Center>
        )}

        {!stillLoading && reports.length === 0 && (
          <Center py="xl">
            <Stack align="center" gap={4}>
              <Text c="dimmed">Upload a batch of CAAPID applications to get started.</Text>
              <Text size="sm" c="dimmed">
                Each one will be checked against the 6 required items automatically.
              </Text>
            </Stack>
          </Center>
        )}

        {!stillLoading && reports.length > 0 && !openDetail && (
          <Stack gap="lg">
            <Group gap="sm" wrap="wrap">
              <TextInput
                placeholder="Search by name or ID..."
                leftSection={<IconSearch size={16} />}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
                style={{ flex: 1, minWidth: 240 }}
              />
              {allMissingLabels.length > 0 && (
                <Select
                  placeholder="Filter by missing item"
                  value={missingFilter}
                  onChange={(value) => setMissingFilter(value ?? 'all')}
                  data={[
                    { label: 'All applicants', value: 'all' },
                    ...allMissingLabels.map((label) => ({ label: `Missing: ${label}`, value: label })),
                  ]}
                  style={{ minWidth: 220 }}
                  clearable={false}
                />
              )}
            </Group>

            {selectionMode && (
              <Text size="xs" c="dimmed">
                Selection mode is on — check applicants within a section, then use the bar that
                appears to change their status all at once. Selections in one section don't carry
                over to another.
              </Text>
            )}

            {searched.length === 0 && reports.length > 0 && (
              <Text size="sm" c="dimmed" ta="center" py="md">
                No applicants match your search or filter.
              </Text>
            )}

            <div>
              <CollapsibleHeader isOpen={!collapsed.notReviewed} onToggle={() => toggleCollapsed('notReviewed')}>
                <Text fw={600} mb="xs">
                  Not Reviewed ({notReviewed.length})
                </Text>
              </CollapsibleHeader>

              <Collapse expanded={!collapsed.notReviewed}>
              <Stack gap="xs" mb="sm">
                <Group gap="xs" justify="space-between">
                  <CollapsibleHeader isOpen={!collapsed.nrComplete} onToggle={() => toggleCollapsed('nrComplete')}>
                    <Group gap="xs">
                      <ThemeIcon color="teal" variant="light" radius="xl" size={20}>
                        <IconCheck size={12} />
                      </ThemeIcon>
                      <Text size="sm" fw={500} c="dimmed">
                        Complete ({notReviewedComplete.length})
                      </Text>
                    </Group>
                  </CollapsibleHeader>
                  {selectionMode && notReviewedComplete.length > 0 && (
                    <SelectAllToggle
                      allIds={notReviewedComplete.map((r) => r.file_id)}
                      selectedIds={selected.nrComplete}
                      onSelectAll={() => selectAllInSection('nrComplete', notReviewedComplete.map((r) => r.file_id))}
                      onClear={() => clearSectionSelection('nrComplete')}
                    />
                  )}
                </Group>

                <Collapse expanded={!collapsed.nrComplete}>
                <Stack gap="xs">
                <BulkActionBar
                  count={selected.nrComplete.size}
                  onChangeStatus={(status) => requestBulkStatusChange('nrComplete', status)}
                  onClear={() => clearSectionSelection('nrComplete')}
                />

                {notReviewedComplete.map((r) => (
                  <ApplicantRow
                    key={r.file_id}
                    report={r}
                    expanded={expandedId === r.file_id}
                    onToggle={() => toggleExpand(r.file_id)}
                    onOpenDetail={() => setOpenDetail(r)}
                    onDelete={() => handleDelete(r.file_id)}
                    onStatusChange={(status) => requestStatusChange(r, status)}
                    selectionMode={selectionMode}
                    checked={!!r.file_id && selected.nrComplete.has(r.file_id)}
                    onCheck={() => toggleSelected('nrComplete', r.file_id)}
                  />
                ))}
                {notReviewedComplete.length === 0 && (
                  <Text size="sm" c="dimmed" pl="xl">
                    None.
                  </Text>
                )}
                </Stack>
                </Collapse>
              </Stack>

              <Stack gap="xs">
                <Group gap="xs" justify="space-between">
                  <CollapsibleHeader isOpen={!collapsed.nrIncomplete} onToggle={() => toggleCollapsed('nrIncomplete')}>
                    <Group gap="xs">
                      <ThemeIcon color="red" variant="light" radius="xl" size={20}>
                        <IconAlertTriangle size={12} />
                      </ThemeIcon>
                      <Text size="sm" fw={500} c="dimmed">
                        Incomplete ({notReviewedIncomplete.length})
                      </Text>
                    </Group>
                  </CollapsibleHeader>
                  {selectionMode && notReviewedIncomplete.length > 0 && (
                    <SelectAllToggle
                      allIds={notReviewedIncomplete.map((r) => r.file_id)}
                      selectedIds={selected.nrIncomplete}
                      onSelectAll={() =>
                        selectAllInSection('nrIncomplete', notReviewedIncomplete.map((r) => r.file_id))
                      }
                      onClear={() => clearSectionSelection('nrIncomplete')}
                    />
                  )}
                </Group>

                <Collapse expanded={!collapsed.nrIncomplete}>
                <Stack gap="xs">
                <BulkActionBar
                  count={selected.nrIncomplete.size}
                  onChangeStatus={(status) => requestBulkStatusChange('nrIncomplete', status)}
                  onClear={() => clearSectionSelection('nrIncomplete')}
                />

                {notReviewedIncomplete.map((r) => (
                  <ApplicantRow
                    key={r.file_id}
                    report={r}
                    expanded={expandedId === r.file_id}
                    onToggle={() => toggleExpand(r.file_id)}
                    onOpenDetail={() => setOpenDetail(r)}
                    onDelete={() => handleDelete(r.file_id)}
                    onStatusChange={(status) => requestStatusChange(r, status)}
                    selectionMode={selectionMode}
                    checked={!!r.file_id && selected.nrIncomplete.has(r.file_id)}
                    onCheck={() => toggleSelected('nrIncomplete', r.file_id)}
                  />
                ))}
                {notReviewedIncomplete.length === 0 && (
                  <Text size="sm" c="dimmed" pl="xl">
                    None.
                  </Text>
                )}
                </Stack>
                </Collapse>
              </Stack>
              </Collapse>
            </div>

            <Divider />

            <div>
              <Group justify="space-between" mb="xs">
                <CollapsibleHeader isOpen={!collapsed.invited} onToggle={() => toggleCollapsed('invited')}>
                  <Text fw={600}>Invited to Interview ({invited.length})</Text>
                </CollapsibleHeader>
                {selectionMode && invited.length > 0 && (
                  <SelectAllToggle
                    allIds={invited.map((r) => r.file_id)}
                    selectedIds={selected.invited}
                    onSelectAll={() => selectAllInSection('invited', invited.map((r) => r.file_id))}
                    onClear={() => clearSectionSelection('invited')}
                  />
                )}
              </Group>

              <Collapse expanded={!collapsed.invited}>
              <BulkActionBar
                count={selected.invited.size}
                onChangeStatus={(status) => requestBulkStatusChange('invited', status)}
                onClear={() => clearSectionSelection('invited')}
              />

              <Stack gap="xs">
                {invited.map((r) => (
                  <ApplicantRow
                    key={r.file_id}
                    report={r}
                    expanded={expandedId === r.file_id}
                    onToggle={() => toggleExpand(r.file_id)}
                    onOpenDetail={() => setOpenDetail(r)}
                    onDelete={() => handleDelete(r.file_id)}
                    onStatusChange={(status) => requestStatusChange(r, status)}
                    selectionMode={selectionMode}
                    checked={!!r.file_id && selected.invited.has(r.file_id)}
                    onCheck={() => toggleSelected('invited', r.file_id)}
                  />
                ))}
                {invited.length === 0 && (
                  <Text size="sm" c="dimmed" pl="xl">
                    None yet.
                  </Text>
                )}
              </Stack>
              </Collapse>
            </div>

            <Divider />

            <div>
              <Group justify="space-between" mb="xs">
                <CollapsibleHeader isOpen={!collapsed.notInvited} onToggle={() => toggleCollapsed('notInvited')}>
                  <Text fw={600}>Not Invited to Interview ({notInvited.length})</Text>
                </CollapsibleHeader>
                {selectionMode && notInvited.length > 0 && (
                  <SelectAllToggle
                    allIds={notInvited.map((r) => r.file_id)}
                    selectedIds={selected.notInvited}
                    onSelectAll={() => selectAllInSection('notInvited', notInvited.map((r) => r.file_id))}
                    onClear={() => clearSectionSelection('notInvited')}
                  />
                )}
              </Group>

              <Collapse expanded={!collapsed.notInvited}>
              <BulkActionBar
                count={selected.notInvited.size}
                onChangeStatus={(status) => requestBulkStatusChange('notInvited', status)}
                onClear={() => clearSectionSelection('notInvited')}
              />

              <Stack gap="xs">
                {notInvited.map((r) => (
                  <ApplicantRow
                    key={r.file_id}
                    report={r}
                    expanded={expandedId === r.file_id}
                    onToggle={() => toggleExpand(r.file_id)}
                    onOpenDetail={() => setOpenDetail(r)}
                    onDelete={() => handleDelete(r.file_id)}
                    onStatusChange={(status) => requestStatusChange(r, status)}
                    selectionMode={selectionMode}
                    checked={!!r.file_id && selected.notInvited.has(r.file_id)}
                    onCheck={() => toggleSelected('notInvited', r.file_id)}
                  />
                ))}
                {notInvited.length === 0 && (
                  <Text size="sm" c="dimmed" pl="xl">
                    None yet.
                  </Text>
                )}
              </Stack>
              </Collapse>
            </div>

            <Divider />

            <div>
              <Group justify="space-between" mb="xs">
                <CollapsibleHeader isOpen={!collapsed.waitlisted} onToggle={() => toggleCollapsed('waitlisted')}>
                  <Text fw={600}>Waitlisted for Interview ({waitlisted.length})</Text>
                </CollapsibleHeader>
                {selectionMode && waitlisted.length > 0 && (
                  <SelectAllToggle
                    allIds={waitlisted.map((r) => r.file_id)}
                    selectedIds={selected.waitlisted}
                    onSelectAll={() => selectAllInSection('waitlisted', waitlisted.map((r) => r.file_id))}
                    onClear={() => clearSectionSelection('waitlisted')}
                  />
                )}
              </Group>

              <Collapse expanded={!collapsed.waitlisted}>
              <BulkActionBar
                count={selected.waitlisted.size}
                onChangeStatus={(status) => requestBulkStatusChange('waitlisted', status)}
                onClear={() => clearSectionSelection('waitlisted')}
              />

              <Stack gap="xs">
                {waitlisted.map((r) => (
                  <ApplicantRow
                    key={r.file_id}
                    report={r}
                    expanded={expandedId === r.file_id}
                    onToggle={() => toggleExpand(r.file_id)}
                    onOpenDetail={() => setOpenDetail(r)}
                    onDelete={() => handleDelete(r.file_id)}
                    onStatusChange={(status) => requestStatusChange(r, status)}
                    selectionMode={selectionMode}
                    checked={!!r.file_id && selected.waitlisted.has(r.file_id)}
                    onCheck={() => toggleSelected('waitlisted', r.file_id)}
                  />
                ))}
                {waitlisted.length === 0 && (
                  <Text size="sm" c="dimmed" pl="xl">
                    None yet.
                  </Text>
                )}
              </Stack>
              </Collapse>
            </div>

            {failed.length > 0 && (
              <>
                <Divider />
                <div>
                  <Text fw={500} c="red.7" mb="xs">
                    Could not process ({failed.length})
                  </Text>
                  <Stack gap="xs">
                    {failed.map((r, i) => (
                      <Card key={i} withBorder padding="sm">
                        <Text size="sm">{r.filename}</Text>
                        <Text size="xs" c="red.7">
                          {r.error}
                        </Text>
                      </Card>
                    ))}
                  </Stack>
                </div>
              </>
            )}
          </Stack>
        )}

        {openDetail && (
          <Stack gap="xs">
            <ApplicantDetail
              report={openDetail}
              apiBase={API_BASE}
              onBack={() => setOpenDetail(null)}
              onStatusChange={(status) => requestStatusChange(openDetail, status)}
              onNext={() => jumpToAdjacent('next')}
              onPrev={() => jumpToAdjacent('prev')}
              hasNext={(() => {
                const idx = visibleOrder.findIndex((r) => r.file_id === openDetail.file_id);
                return idx !== -1 && idx < visibleOrder.length - 1;
              })()}
              hasPrev={(() => {
                const idx = visibleOrder.findIndex((r) => r.file_id === openDetail.file_id);
                return idx > 0;
              })()}
            />
            <Text size="xs" c="dimmed" ta="center">
              Shortcuts: <strong>1</strong> Not Reviewed · <strong>2</strong> Invited ·{' '}
              <strong>3</strong> Not Invited · <strong>4</strong> Waitlisted ·{' '}
              <strong>Esc</strong> back to list
            </Text>
          </Stack>
        )}
      </div>

      <StatusCommentModal request={commentModal} onClose={() => setCommentModal(null)} />
    </Stack>
  );
}

function formatApplicantLabel(report: ApplicantReport): string {
  const name = report.applicant_name?.trim();
  const id = report.applicant_id?.trim();
  if (name && id) return `${name} — ID ${id}`;
  if (name) return name;
  if (id) return `ID ${id}`;
  return report.filename;
}

function CollapsibleHeader({
  isOpen,
  onToggle,
  children,
}: {
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <UnstyledButton onClick={onToggle} style={{ display: 'block', width: '100%' }}>
      <Group gap="xs" wrap="nowrap">
        <IconChevronDown
          size={16}
          style={{
            flexShrink: 0,
            transition: 'transform 150ms ease',
            transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        />
        {children}
      </Group>
    </UnstyledButton>
  );
}

function SelectAllToggle({
  allIds,
  selectedIds,
  onSelectAll,
  onClear,
}: {
  allIds: (string | undefined)[];
  selectedIds: Set<string>;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const validIds = allIds.filter((id): id is string => !!id);
  const allSelected = validIds.length > 0 && validIds.every((id) => selectedIds.has(id));

  return (
    <Button size="xs" variant="subtle" onClick={allSelected ? onClear : onSelectAll}>
      {allSelected ? 'Deselect all' : 'Select all'}
    </Button>
  );
}

function BulkActionBar({
  count,
  onChangeStatus,
  onClear,
}: {
  count: number;
  onChangeStatus: (status: ReviewStatus) => void;
  onClear: () => void;
}) {
  if (count === 0) return null;

  return (
    <Card withBorder padding="xs" bg="navy.0">
      <Group justify="space-between">
        <Text size="sm" fw={500}>
          {count} selected
        </Text>
        <Group gap="xs">
          {(Object.keys(STATUS_META) as ReviewStatus[]).map((key) => (
            <Button
              key={key}
              size="xs"
              variant="light"
              color={STATUS_META[key].color}
              onClick={() => onChangeStatus(key)}
            >
              Mark {STATUS_META[key].label}
            </Button>
          ))}
          <Button size="xs" variant="subtle" color="gray" onClick={onClear}>
            Clear
          </Button>
        </Group>
      </Group>
    </Card>
  );
}

function ApplicantRow({
  report,
  expanded,
  onToggle,
  onOpenDetail,
  onDelete,
  onStatusChange,
  selectionMode,
  checked,
  onCheck,
}: {
  report: ApplicantReport;
  expanded: boolean;
  onToggle: () => void;
  onOpenDetail: () => void;
  onDelete: () => void;
  onStatusChange: (status: ReviewStatus) => void;
  selectionMode: boolean;
  checked: boolean;
  onCheck: () => void;
}) {
  const items = toChecklistItems(report);
  const missingCount = items.filter((i) => !i.found).length;
  const status = getReviewStatus(report);
  const statusMeta = STATUS_META[status];

  return (
    <Card withBorder padding="sm">
      <Group
        justify="space-between"
        style={{ cursor: selectionMode ? 'default' : 'pointer' }}
        onClick={selectionMode ? onCheck : onToggle}
      >
        <Group gap="sm" wrap="nowrap">
          {selectionMode && (
            <Checkbox checked={checked} onChange={onCheck} onClick={(e) => e.stopPropagation()} />
          )}
          <Stack gap={2}>
            <Text fw={500}>{formatApplicantLabel(report)}</Text>
            <Text size="xs" c="dimmed">
              {report.total_pages} pages
              {!report.evaluators?.some((e) => e.is_dean_or_principal) && report.applicant_country
                ? ` · ${report.applicant_country}`
                : ''}
            </Text>
          </Stack>
        </Group>
        <Group gap="xs">
          {report.is_complete ? (
            <Badge color="teal" variant="light">
              Complete
            </Badge>
          ) : (
            <Badge color="red" variant="light">
              Missing {missingCount}
            </Badge>
          )}
          <Badge color={statusMeta.color} variant="outline">
            {statusMeta.label}
          </Badge>
          {!selectionMode && (
            <Button
              size="xs"
              variant="subtle"
              color="red"
              px={6}
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Remove ${formatApplicantLabel(report)}? This deletes the stored PDF too.`)) {
                  onDelete();
                }
              }}
            >
              <IconTrash size={14} />
            </Button>
          )}
        </Group>
      </Group>

      {expanded && !selectionMode && (
        <Stack gap="sm" mt="sm" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
          {report.review_comment && report.review_comment.trim() && (
            <Text size="xs" c="dimmed">
              Note: {report.review_comment}
            </Text>
          )}
          <Group justify="space-between">
            <Text size="sm" fw={500} c="dimmed">
              Required items
            </Text>
            <Menu shadow="md" width={220}>
              <Menu.Target>
                <Button
                  size="xs"
                  variant="light"
                  color={statusMeta.color}
                  rightSection={<IconChevronDown size={14} />}
                  onClick={(e) => e.stopPropagation()}
                >
                  {statusMeta.label}
                </Button>
              </Menu.Target>
              <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                {(Object.keys(STATUS_META) as ReviewStatus[]).map((key) => (
                  <Menu.Item key={key} onClick={() => onStatusChange(key)}>
                    {STATUS_META[key].label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          </Group>

          <Stack gap={6}>
            {items.map((item) => (
              <Group key={item.label} justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap">
                  <ThemeIcon size={18} radius="xl" color={item.found ? 'teal' : 'red'} variant="light">
                    {item.found ? <IconCheck size={11} /> : <IconX size={11} />}
                  </ThemeIcon>
                  <Text size="sm">{item.label}</Text>
                </Group>
                {item.detail && (
                  <Text size="xs" c="dimmed" style={{ flex: 1, textAlign: 'right' }}>
                    {item.detail}
                  </Text>
                )}
              </Group>
            ))}
          </Stack>

          <Button
            size="xs"
            variant="light"
            color="navy"
            leftSection={<IconExternalLink size={14} />}
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetail();
            }}
            style={{ alignSelf: 'flex-start' }}
          >
            Open full application
          </Button>
        </Stack>
      )}
    </Card>
  );
}