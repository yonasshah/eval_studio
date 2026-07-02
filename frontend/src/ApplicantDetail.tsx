import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Badge,
  Title,
  ScrollArea,
  NumberInput,
  ActionIcon,
  Tooltip,
  Menu,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconCheck,
  IconX,
  IconZoomIn,
  IconZoomOut,
  IconArrowAutofitContent,
  IconArrowAutofitWidth,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconPencil,
} from '@tabler/icons-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { ApplicantReport, ReviewStatus } from './types';
import { toChecklistItems, STATUS_META, getReviewStatus } from './types';

function formatApplicantLabel(report: ApplicantReport): string {
  const name = report.applicant_name?.trim();
  const id = report.applicant_id?.trim();
  if (name && id) return `${name} — ID ${id}`;
  if (name) return name;
  if (id) return `ID ${id}`;
  return report.filename;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const SCALE_STEP = 0.2;
const DEFAULT_SCALE = 1.3;
const THUMBNAIL_SCALE = 0.18;

// The viewer's height is expressed relative to the viewport (rather than a
// fixed pixel value) so the reader gets as much room as the window allows.
// Increased from 260px offset to 180px to give more vertical space since
// the bottom area was underutilised.
const VIEWER_HEIGHT = 'calc(100vh - 180px)';
const VIEWER_MIN_HEIGHT = 420;

// 'page': scale computed so the ENTIRE page fits inside the viewer with no
//   scrolling needed -- the default, since that's what lets arrow-key /
//   Previous-Next navigation replace scrolling.
// 'width': fits the page's width only (existing behavior kept as an
//   option for anyone who wants to scroll a wider render for readability).
// 'custom': manual zoom via the +/- buttons or Reset.
type FitMode = 'page' | 'width' | 'custom';

interface Props {
  report: ApplicantReport;
  apiBase: string;
  onBack: () => void;
  onStatusChange: (status: ReviewStatus) => void;
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
}

export default function ApplicantDetail({
  report,
  apiBase,
  onBack,
  onStatusChange,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerScrollRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const activeThumbnailRef = useRef<HTMLDivElement>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState<string | number>(1);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [fitMode, setFitMode] = useState<FitMode>('page');
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});

  const items = toChecklistItems(report);

  useEffect(() => {
    if (!report.file_id) return;
    setLoadingPdf(true);
    setPdfError(null);

    const url = `${apiBase}/api/pdf/${report.file_id}`;
    pdfjsLib
      .getDocument({ url })
      .promise.then((doc) => {
        setPdfDoc(doc);
        setCurrentPage(1);
        setPageInput(1);
      })
      .catch((e) => {
        setPdfError(`Could not load PDF preview: ${e.message ?? e}`);
      })
      .finally(() => setLoadingPdf(false));
  }, [report.file_id, apiBase]);

  const renderPage = useCallback(
    async (doc: pdfjsLib.PDFDocumentProxy, pageNum: number, canvas: HTMLCanvasElement, useScale: number) => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await doc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });

      let effectiveScale = useScale;
      if (fitMode !== 'custom' && viewerScrollRef.current) {
        const containerWidth = viewerScrollRef.current.clientWidth - 24;
        const widthScale = containerWidth / baseViewport.width;

        if (fitMode === 'width') {
          effectiveScale = widthScale;
        } else {
          // 'page': constrain by whichever dimension is tighter so the
          // whole page -- not just its width -- fits without scrolling.
          const containerHeight = viewerScrollRef.current.clientHeight - 24;
          const heightScale = containerHeight / baseViewport.height;
          effectiveScale = Math.min(widthScale, heightScale);
        }
      }

      const viewport = page.getViewport({ scale: effectiveScale });
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      context.clearRect(0, 0, canvas.width, canvas.height);

      const task = page.render({ canvasContext: context, viewport, canvas });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException') {
          console.error('PDF render error:', e);
        }
      } finally {
        if (renderTaskRef.current === task) {
          renderTaskRef.current = null;
        }
      }
    },
    [fitMode]
  );

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    renderPage(pdfDoc, currentPage, canvasRef.current, scale);
  }, [pdfDoc, currentPage, scale, fitMode, renderPage]);

  useEffect(() => {
    if (fitMode === 'custom') return;
    function handleResize() {
      if (pdfDoc && canvasRef.current) {
        renderPage(pdfDoc, currentPage, canvasRef.current, scale);
      }
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitMode, pdfDoc, currentPage, scale, renderPage]);

  useEffect(() => {
    if (!pdfDoc) return;
    const doc = pdfDoc; // capture as non-null for the closure below
    let cancelled = false;

    async function generateThumbnails() {
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return;
        if (thumbnails[i]) continue;
        try {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: THUMBNAIL_SCALE });
          const offscreen = document.createElement('canvas');
          offscreen.width = viewport.width;
          offscreen.height = viewport.height;
          const ctx = offscreen.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport, canvas: offscreen }).promise;
          if (cancelled) return;
          const dataUrl = offscreen.toDataURL('image/png');
          setThumbnails((prev) => ({ ...prev, [i]: dataUrl }));
        } catch {
          continue;
        }
      }
    }

    generateThumbnails();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc]);

  // Keep the active thumbnail scrolled into view whenever the page changes.
  useEffect(() => {
    activeThumbnailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentPage]);

  function jumpTo(page: number | null) {
    if (page == null || !pdfDoc) return;
    const clamped = Math.min(Math.max(1, page), pdfDoc.numPages);
    setCurrentPage(clamped);
    setPageInput(clamped);
  }

  function handlePageInputSubmit() {
    const num = typeof pageInput === 'number' ? pageInput : parseInt(String(pageInput), 10);
    if (!isNaN(num)) jumpTo(num);
    else setPageInput(currentPage);
  }

  // BUG FIX: zoom buttons previously had `disabled={fitMode !== 'custom'}`,
  // which meant clicking them while in 'page' or 'width' fit mode was
  // blocked at the DOM level -- the onClick never fired, so setFitMode
  // ('custom') was never called, and the zoom appeared stuck until the
  // user clicked Reset. Fix: always allow the click; each zoom handler
  // already calls setFitMode('custom') as its first action.
  function zoomIn() {
    setFitMode('custom');
    setScale((s) => Math.min(MAX_SCALE, Math.round((s + SCALE_STEP) * 100) / 100));
  }
  function zoomOut() {
    setFitMode('custom');
    setScale((s) => Math.max(MIN_SCALE, Math.round((s - SCALE_STEP) * 100) / 100));
  }
  function resetZoom() {
    setFitMode('custom');
    setScale(DEFAULT_SCALE);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isTyping) return;

      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        jumpTo(currentPage + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        jumpTo(currentPage - 1);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pdfDoc]);

  const thumbnailList = useMemo(() => {
    if (!pdfDoc) return [];
    return Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1);
  }, [pdfDoc]);

  const status = getReviewStatus(report);
  const statusMeta = STATUS_META[status];
  const hasComment = !!report.review_comment && report.review_comment.trim().length > 0;

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack}>
            Back to list
          </Button>
          <Tooltip label="Previous applicant">
            <ActionIcon variant="default" size="lg" onClick={onPrev} disabled={!hasPrev}>
              <IconChevronLeft size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Next applicant">
            <ActionIcon variant="default" size="lg" onClick={onNext} disabled={!hasNext}>
              <IconChevronRight size={18} />
            </ActionIcon>
          </Tooltip>
          <Title order={4}>{formatApplicantLabel(report)}</Title>
          {report.is_complete ? (
            <Badge color="teal" variant="light">
              Complete
            </Badge>
          ) : (
            <Badge color="red" variant="light">
              Missing {items.filter((i) => !i.found).length}
            </Badge>
          )}
        </Group>

        <Group gap="xs" align="center">
          {hasComment && (
            <Tooltip label={report.review_comment}>
              <Text size="xs" c="dimmed" style={{ maxWidth: 260 }} truncate>
                Note: {report.review_comment}
              </Text>
            </Tooltip>
          )}
          {(status === 'invited' || status === 'not_invited' || status === 'waitlisted') && (
            <Tooltip label="Edit note">
              <ActionIcon variant="subtle" color="gray" onClick={() => onStatusChange(status)}>
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          <Menu shadow="md" width={220}>
            <Menu.Target>
              <Button
                variant="light"
                color={statusMeta.color}
                rightSection={<IconChevronDown size={14} />}
              >
                {statusMeta.label}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {(Object.keys(STATUS_META) as ReviewStatus[]).map((key) => (
                <Menu.Item key={key} onClick={() => onStatusChange(key)}>
                  {STATUS_META[key].label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      <Group align="flex-start" gap="md" wrap="nowrap">
        <Stack gap="xs" style={{ width: 300, flexShrink: 0 }}>
          <Text size="sm" fw={500} c="dimmed">
            Required items
          </Text>
          {items.map((item) => (
            <Card key={item.label} withBorder padding="sm">
              <Stack gap="xs">
                <Group gap="xs" wrap="nowrap" align="flex-start">
                  <ThemeIcon
                    size={20}
                    radius="xl"
                    color={item.found ? 'teal' : 'red'}
                    variant="light"
                    style={{ flexShrink: 0, marginTop: 1 }}
                  >
                    {item.found ? <IconCheck size={12} /> : <IconX size={12} />}
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm">{item.label}</Text>
                    {item.detail && (
                      <Text size="xs" c="dimmed">
                        {item.detail}
                      </Text>
                    )}
                  </div>
                </Group>
                {item.found && item.page && (
                  <Button
                    size="xs"
                    variant="light"
                    color="navy"
                    onClick={() => jumpTo(item.page)}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    Page {item.page}
                  </Button>
                )}
                {!item.found && item.jumpPage && (
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={() => jumpTo(item.jumpPage!)}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {item.jumpLabel ?? `Page ${item.jumpPage}`}
                  </Button>
                )}
              </Stack>
            </Card>
          ))}
        </Stack>

        <Card withBorder padding="sm" style={{ flex: 1, minWidth: 0 }}>
          {loadingPdf && <Text size="sm" c="dimmed">Loading PDF…</Text>}
          {pdfError && <Text size="sm" c="red">{pdfError}</Text>}
          {pdfDoc && !pdfError && (
            <Stack gap="xs">
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="subtle"
                    disabled={currentPage <= 1}
                    onClick={() => jumpTo(currentPage - 1)}
                  >
                    Previous
                  </Button>
                  <Group gap={4}>
                    <NumberInput
                      value={pageInput}
                      onChange={setPageInput}
                      onBlur={handlePageInputSubmit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handlePageInputSubmit();
                      }}
                      min={1}
                      max={pdfDoc.numPages}
                      size="xs"
                      hideControls
                      style={{ width: 56 }}
                    />
                    <Text size="sm" c="dimmed">
                      of {pdfDoc.numPages}
                    </Text>
                  </Group>
                  <Button
                    size="xs"
                    variant="subtle"
                    disabled={currentPage >= pdfDoc.numPages}
                    onClick={() => jumpTo(currentPage + 1)}
                  >
                    Next
                  </Button>
                </Group>

                <Group gap={4}>
                  <Tooltip label="Zoom out">
                    <ActionIcon variant="subtle" color="gray" onClick={zoomOut}>
                      <IconZoomOut size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Text size="xs" c="dimmed" style={{ minWidth: 40, textAlign: 'center' }}>
                    {fitMode === 'custom' ? `${Math.round(scale * 100)}%` : 'Fit'}
                  </Text>
                  <Tooltip label="Zoom in">
                    <ActionIcon variant="subtle" color="gray" onClick={zoomIn}>
                      <IconZoomIn size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Fit entire page (no scrolling)">
                    <ActionIcon
                      variant={fitMode === 'page' ? 'filled' : 'subtle'}
                      color="navy"
                      onClick={() => setFitMode('page')}
                    >
                      <IconArrowAutofitContent size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Fit to width">
                    <ActionIcon
                      variant={fitMode === 'width' ? 'filled' : 'subtle'}
                      color="navy"
                      onClick={() => setFitMode('width')}
                    >
                      <IconArrowAutofitWidth size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Button size="xs" variant="default" onClick={resetZoom}>
                    Reset
                  </Button>
                </Group>
              </Group>

              <ScrollArea
                h={VIEWER_HEIGHT}
                mih={VIEWER_MIN_HEIGHT}
                ref={viewerScrollRef}
                type={fitMode === 'page' ? 'never' : 'auto'}
              >
                <Stack align="center" justify="center" mih={VIEWER_MIN_HEIGHT}>
                  <canvas ref={canvasRef} style={{ maxWidth: '100%' }} />
                </Stack>
              </ScrollArea>

              <Text size="xs" c="dimmed" ta="center">
                Use ← → or Page Up/Down to navigate — "Fit Page" (the default) shows the whole
                page with no scrolling needed.
              </Text>
            </Stack>
          )}
        </Card>

        {pdfDoc && !pdfError && (
          <Stack gap={4} style={{ width: 110, flexShrink: 0 }}>
            <Text size="xs" fw={500} c="dimmed" ta="center">
              Pages
            </Text>
            <ScrollArea h={VIEWER_HEIGHT} mih={VIEWER_MIN_HEIGHT} type="auto">
              <Stack gap={6} pr={6}>
                {thumbnailList.map((pageNum) => (
                  <div
                    key={pageNum}
                    ref={pageNum === currentPage ? activeThumbnailRef : undefined}
                    onClick={() => jumpTo(pageNum)}
                    style={{
                      cursor: 'pointer',
                      border:
                        pageNum === currentPage
                          ? '2px solid var(--mantine-color-navy-6)'
                          : '1px solid var(--mantine-color-gray-3)',
                      borderRadius: 4,
                      padding: 2,
                      backgroundColor:
                        pageNum === currentPage ? 'var(--mantine-color-navy-0)' : 'transparent',
                    }}
                  >
                    {thumbnails[pageNum] ? (
                      <img
                        src={thumbnails[pageNum]}
                        alt={`Page ${pageNum}`}
                        style={{ width: '100%', display: 'block' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '0.77',
                          backgroundColor: 'var(--mantine-color-gray-1)',
                        }}
                      />
                    )}
                    <Text size="xs" ta="center" c={pageNum === currentPage ? 'navy.7' : 'dimmed'}>
                      {pageNum}
                    </Text>
                  </div>
                ))}
              </Stack>
            </ScrollArea>
          </Stack>
        )}
      </Group>
    </Stack>
  );
}