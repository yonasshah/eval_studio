import { useEffect, useState } from 'react';
import {
  Title,
  Text,
  Group,
  Stack,
  Card,
  Badge,
  Loader,
  Center,
  Divider,
  TextInput,
  ThemeIcon,
  Menu,
  Button,
} from '@mantine/core';
import { IconSearch, IconCheck, IconX, IconChevronDown, IconExternalLink } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import type { ApplicantReport, ReviewStatus } from '../types';
import { toChecklistItems, STATUS_META, getReviewStatus } from '../types';
import { useCycles, API_BASE } from '../CycleContext';
import ApplicantDetail from '../ApplicantDetail';

function formatApplicantLabel(report: ApplicantReport): string {
  const name = report.applicant_name?.trim();
  const id = report.applicant_id?.trim();
  if (name && id) return `${name} — ID ${id}`;
  if (name) return name;
  if (id) return `ID ${id}`;
  return report.filename;
}

export default function ArchivePage() {
  const { selectedCycleId, selectedCycle } = useCycles();
  const [reports, setReports] = useState<ApplicantReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openDetail, setOpenDetail] = useState<ApplicantReport | null>(null);

  useEffect(() => {
    if (!selectedCycleId) {
      setReports([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${API_BASE}/api/applicants?cycle_id=${selectedCycleId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then((data) => setReports(data.results ?? []))
      .catch((e) => {
        notifications.show({
          title: 'Could not load archive',
          message: e instanceof Error ? e.message : 'Unknown error.',
          color: 'red',
        });
      })
      .finally(() => setLoading(false));
  }, [selectedCycleId]);

  async function handleStatusChange(fileId: string | undefined, status: ReviewStatus) {
    if (!fileId) return;
    try {
      const res = await fetch(`${API_BASE}/api/applicants/${fileId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setReports((prev) => prev.map((r) => (r.file_id === fileId ? { ...r, review_status: status } : r)));
      notifications.show({
        message: `Status updated to ${STATUS_META[status].label}.`,
        color: STATUS_META[status].color,
        autoClose: 2500,
      });
      // If the status moved this applicant back to Not Reviewed, it'll
      // naturally disappear from this page's filtered lists below on the
      // next render -- no special handling needed here.
    } catch (e) {
      notifications.show({
        title: 'Could not update status',
        message: e instanceof Error ? e.message : 'Unknown error.',
        color: 'red',
      });
    }
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

  const searched = reports.filter((r) => !r.error && matchesSearch(r, searchQuery));
  const invited = searched.filter((r) => getReviewStatus(r) === 'invited');
  const notInvited = searched.filter((r) => getReviewStatus(r) === 'not_invited');

  if (openDetail) {
    return (
      <Stack gap="xs">
        <ApplicantDetail
          report={openDetail}
          apiBase={API_BASE}
          onBack={() => setOpenDetail(null)}
          onStatusChange={(status) => {
            handleStatusChange(openDetail.file_id, status);
            setOpenDetail((prev) => (prev ? { ...prev, review_status: status } : prev));
          }}
          onNext={() => {}}
          onPrev={() => {}}
          hasNext={false}
          hasPrev={false}
        />
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <div>
        <Title order={4}>Archive</Title>
        {selectedCycle && (
          <Text size="sm" c="dimmed">
            {selectedCycle.name} — decisions already made
          </Text>
        )}
      </div>

      <TextInput
        placeholder="Search by name or ID..."
        leftSection={<IconSearch size={16} />}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.currentTarget.value)}
        style={{ maxWidth: 400 }}
      />

      {loading && (
        <Center py="xl">
          <Loader color="navy" />
        </Center>
      )}

      {!loading && reports.length === 0 && (
        <Center py="xl">
          <Text c="dimmed">No archived applicants in this cycle yet.</Text>
        </Center>
      )}

      {!loading && reports.length > 0 && (
        <Stack gap="lg">
          <div>
            <Text fw={600} mb="xs">
              Invited to Interview ({invited.length})
            </Text>
            <Stack gap="xs">
              {invited.map((r) => (
                <ArchiveRow
                  key={r.file_id}
                  report={r}
                  expanded={expandedId === r.file_id}
                  onToggle={() => setExpandedId((prev) => (prev === r.file_id ? null : r.file_id ?? null))}
                  onOpenDetail={() => setOpenDetail(r)}
                  onStatusChange={(status) => handleStatusChange(r.file_id, status)}
                />
              ))}
              {invited.length === 0 && (
                <Text size="sm" c="dimmed" pl="xl">
                  None.
                </Text>
              )}
            </Stack>
          </div>

          <Divider />

          <div>
            <Text fw={600} mb="xs">
              Not Invited to Interview ({notInvited.length})
            </Text>
            <Stack gap="xs">
              {notInvited.map((r) => (
                <ArchiveRow
                  key={r.file_id}
                  report={r}
                  expanded={expandedId === r.file_id}
                  onToggle={() => setExpandedId((prev) => (prev === r.file_id ? null : r.file_id ?? null))}
                  onOpenDetail={() => setOpenDetail(r)}
                  onStatusChange={(status) => handleStatusChange(r.file_id, status)}
                />
              ))}
              {notInvited.length === 0 && (
                <Text size="sm" c="dimmed" pl="xl">
                  None.
                </Text>
              )}
            </Stack>
          </div>
        </Stack>
      )}
    </Stack>
  );
}

function ArchiveRow({
  report,
  expanded,
  onToggle,
  onOpenDetail,
  onStatusChange,
}: {
  report: ApplicantReport;
  expanded: boolean;
  onToggle: () => void;
  onOpenDetail: () => void;
  onStatusChange: (status: ReviewStatus) => void;
}) {
  const items = toChecklistItems(report);
  const status = getReviewStatus(report);
  const statusMeta = STATUS_META[status];

  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" style={{ cursor: 'pointer' }} onClick={onToggle}>
        <Stack gap={2}>
          <Text fw={500}>{formatApplicantLabel(report)}</Text>
          <Text size="xs" c="dimmed">
            {report.total_pages} pages
          </Text>
        </Stack>
        <Group gap="xs">
          {report.is_complete ? (
            <Badge color="teal" variant="light">
              Complete
            </Badge>
          ) : (
            <Badge color="red" variant="light">
              Missing {items.filter((i) => !i.found).length}
            </Badge>
          )}
          <Badge color={statusMeta.color} variant="outline">
            {statusMeta.label}
          </Badge>
        </Group>
      </Group>

      {expanded && (
        <Stack gap="sm" mt="sm" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
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

