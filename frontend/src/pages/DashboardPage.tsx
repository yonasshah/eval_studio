import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Title, Text, Group, Stack, Card, Center, Loader, SimpleGrid, Progress, ThemeIcon } from '@mantine/core';
import { IconUsers, IconCheck, IconAlertTriangle, IconCalendarCheck, IconCalendarX } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import type { ApplicantReport } from '../types';
import { getReviewStatus, STATUS_META } from '../types';
import { useCycles, API_BASE } from '../CycleContext';

export default function DashboardPage() {
  const { selectedCycleId, selectedCycle } = useCycles();
  const [reports, setReports] = useState<ApplicantReport[]>([]);
  const [loading, setLoading] = useState(true);

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
          title: 'Could not load dashboard',
          message: e instanceof Error ? e.message : 'Unknown error.',
          color: 'red',
        });
      })
      .finally(() => setLoading(false));
  }, [selectedCycleId]);

  const ok = reports.filter((r) => !r.error);
  const total = ok.length;
  const complete = ok.filter((r) => r.is_complete).length;
  const incomplete = total - complete;
  const notReviewed = ok.filter((r) => getReviewStatus(r) === 'not_reviewed').length;
  const invited = ok.filter((r) => getReviewStatus(r) === 'invited').length;
  const notInvited = ok.filter((r) => getReviewStatus(r) === 'not_invited').length;

  // Tally how often each checklist label appears in missing_items across
  // all applicants, so the admissions team can spot patterns -- e.g. if
  // half of applicants are missing the same item, that might point to an
  // upstream issue worth investigating rather than treating each gap as
  // an isolated case.
  const missingBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    ok.forEach((r) => {
      (r.missing_items ?? []).forEach((item) => {
        counts.set(item, (counts.get(item) ?? 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [ok]);

  if (loading) {
    return (
      <Center py="xl">
        <Loader color="navy" />
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={4}>Dashboard</Title>
        {selectedCycle && (
          <Text size="sm" c="dimmed">
            {selectedCycle.name}
          </Text>
        )}
      </div>

      {total === 0 ? (
        <Center py="xl">
          <Text c="dimmed">No applicants uploaded to this cycle yet.</Text>
        </Center>
      ) : (
        <>
          <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="md">
            <StatCard icon={<IconUsers size={18} />} color="navy" label="Total" value={total} />
            <StatCard icon={<IconCheck size={18} />} color="teal" label="Complete" value={complete} />
            <StatCard icon={<IconAlertTriangle size={18} />} color="red" label="Incomplete" value={incomplete} />
            <StatCard icon={<IconCalendarCheck size={18} />} color="teal" label="Invited" value={invited} />
            <StatCard icon={<IconCalendarX size={18} />} color="red" label="Not invited" value={notInvited} />
          </SimpleGrid>

          <Card withBorder padding="md">
            <Text fw={600} mb="sm">
              Review progress
            </Text>
            <Stack gap={6}>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  {notReviewed} of {total} still need a decision
                </Text>
                <Text size="sm" c="dimmed">
                  {total > 0 ? Math.round(((total - notReviewed) / total) * 100) : 0}% reviewed
                </Text>
              </Group>
              <Progress.Root size="lg">
                <Progress.Section value={(invited / total) * 100} color={STATUS_META.invited.color} />
                <Progress.Section value={(notInvited / total) * 100} color={STATUS_META.not_invited.color} />
                <Progress.Section value={(notReviewed / total) * 100} color={STATUS_META.not_reviewed.color} />
              </Progress.Root>
              <Group gap="md">
                <LegendDot color={STATUS_META.invited.color} label={`Invited (${invited})`} />
                <LegendDot color={STATUS_META.not_invited.color} label={`Not invited (${notInvited})`} />
                <LegendDot color={STATUS_META.not_reviewed.color} label={`Not reviewed (${notReviewed})`} />
              </Group>
            </Stack>
          </Card>

          <Card withBorder padding="md">
            <Text fw={600} mb="sm">
              Most commonly missing items
            </Text>
            {missingBreakdown.length === 0 ? (
              <Text size="sm" c="dimmed">
                Nothing missing across any applicant in this cycle — every application is complete.
              </Text>
            ) : (
              <Stack gap="sm">
                {missingBreakdown.map(({ label, count }) => (
                  <div key={label}>
                    <Group justify="space-between" mb={2}>
                      <Text size="sm">{label}</Text>
                      <Text size="sm" c="dimmed">
                        {count} of {total}
                      </Text>
                    </Group>
                    <Progress value={(count / total) * 100} color="red" size="sm" />
                  </div>
                ))}
              </Stack>
            )}
          </Card>
        </>
      )}
    </Stack>
  );
}

function StatCard({
  icon,
  color,
  label,
  value,
}: {
  icon: ReactNode;
  color: string;
  label: string;
  value: number;
}) {
  return (
    <Card withBorder padding="md">
      <Group gap="sm">
        <ThemeIcon color={color} variant="light" size={36} radius="md">
          {icon}
        </ThemeIcon>
        <div>
          <Text size="xl" fw={700}>
            {value}
          </Text>
          <Text size="xs" c="dimmed">
            {label}
          </Text>
        </div>
      </Group>
    </Card>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <Group gap={6}>
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: `var(--mantine-color-${color}-6)`,
        }}
      />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

