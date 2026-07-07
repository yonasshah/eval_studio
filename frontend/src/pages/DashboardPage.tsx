import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Title,
  Text,
  Group,
  Stack,
  Card,
  Center,
  Loader,
  SimpleGrid,
  Progress,
  ThemeIcon,
} from '@mantine/core';
import {
  IconUsers,
  IconCheck,
  IconAlertTriangle,
  IconCalendarCheck,
  IconCalendarX,
  IconClock,
  IconWorld,
  IconSchool,
} from '@tabler/icons-react';
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
  const waitlisted = ok.filter((r) => getReviewStatus(r) === 'waitlisted').length;

  // Missing items breakdown
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

  // ECE GPA stats — only from applicants where the parser found a value
  const ecaGpaStats = useMemo(() => {
    const values = ok
      .map((r) => parseFloat(r.ece_gpa ?? ''))
      .filter((v) => !isNaN(v) && v > 0);
    if (values.length === 0) return null;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { avg, min, max, count: values.length };
  }, [ok]);

  // TOEFL stats — pre-2026 scale only (new scale is 0-6, incompatible to average together)
  const toeflStats = useMemo(() => {
    const preScale = ok.filter((r) => r.toefl_total != null && !r.toefl_is_new_scale);
    const newScale = ok.filter((r) => r.toefl_total != null && r.toefl_is_new_scale);
    const preValues = preScale.map((r) => r.toefl_total as number);
    const newValues = newScale.map((r) => r.toefl_total as number);

    const preAvg = preValues.length > 0
      ? preValues.reduce((a, b) => a + b, 0) / preValues.length
      : null;
    const newAvg = newValues.length > 0
      ? newValues.reduce((a, b) => a + b, 0) / newValues.length
      : null;

    return {
      preAvg,
      preCount: preValues.length,
      preMin: preValues.length ? Math.min(...preValues) : null,
      preMax: preValues.length ? Math.max(...preValues) : null,
      newAvg,
      newCount: newValues.length,
      totalWithScore: preValues.length + newValues.length,
    };
  }, [ok]);

  // Countries breakdown
  const countriesBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    ok.forEach((r) => {
      if (r.applicant_country) {
        counts.set(r.applicant_country, (counts.get(r.applicant_country) ?? 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);
  }, [ok]);

  const withCountry = ok.filter((r) => r.applicant_country).length;

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
          {/* Stat cards — 6 across: Total, Complete, Incomplete, Invited, Waitlisted, Not Invited */}
          <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} spacing="md">
            <StatCard icon={<IconUsers size={18} />} color="navy" label="Total" value={total} />
            <StatCard icon={<IconCheck size={18} />} color="teal" label="Complete" value={complete} />
            <StatCard icon={<IconAlertTriangle size={18} />} color="red" label="Incomplete" value={incomplete} />
            <StatCard icon={<IconCalendarCheck size={18} />} color="teal" label="Invited" value={invited} />
            <StatCard icon={<IconClock size={18} />} color="yellow" label="Waitlisted" value={waitlisted} />
            <StatCard icon={<IconCalendarX size={18} />} color="red" label="Not invited" value={notInvited} />
          </SimpleGrid>

          {/* Review progress */}
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
                <Progress.Section value={(waitlisted / total) * 100} color={STATUS_META.waitlisted.color} />
                <Progress.Section value={(notInvited / total) * 100} color={STATUS_META.not_invited.color} />
                <Progress.Section value={(notReviewed / total) * 100} color={STATUS_META.not_reviewed.color} />
              </Progress.Root>
              <Group gap="md">
                <LegendDot color={STATUS_META.invited.color} label={`Invited (${invited})`} />
                <LegendDot color={STATUS_META.waitlisted.color} label={`Waitlisted (${waitlisted})`} />
                <LegendDot color={STATUS_META.not_invited.color} label={`Not invited (${notInvited})`} />
                <LegendDot color={STATUS_META.not_reviewed.color} label={`Not reviewed (${notReviewed})`} />
              </Group>
            </Stack>
          </Card>

          {/* Scores summary + Countries side by side */}
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">

            {/* Scores */}
            <Card withBorder padding="md">
              <Group gap="xs" mb="sm">
                <ThemeIcon color="navy" variant="light" size={24} radius="md">
                  <IconSchool size={14} />
                </ThemeIcon>
                <Text fw={600}>Scores</Text>
              </Group>
              <Stack gap="md">
                {/* ECE GPA */}
                <div>
                  <Text size="sm" fw={500} mb={4}>ECE GPA (Comprehensive)</Text>
                  {ecaGpaStats ? (
                    <Stack gap={2}>
                      <Group gap="xl">
                        <ScoreStat label="Average" value={ecaGpaStats.avg.toFixed(2)} />
                        <ScoreStat label="Min" value={ecaGpaStats.min.toFixed(2)} />
                        <ScoreStat label="Max" value={ecaGpaStats.max.toFixed(2)} />
                      </Group>
                      <Text size="xs" c="dimmed">
                        {ecaGpaStats.count} of {total} applicants have a parseable GPA
                      </Text>
                    </Stack>
                  ) : (
                    <Text size="sm" c="dimmed">
                      No ECE GPA data yet — scores appear after uploading applications.
                    </Text>
                  )}
                </div>

                {/* TOEFL */}
                <div>
                  <Text size="sm" fw={500} mb={4}>TOEFL</Text>
                  {toeflStats.totalWithScore > 0 ? (
                    <Stack gap={4}>
                      {toeflStats.preCount > 0 && (
                        <Stack gap={2}>
                          <Group gap="xl">
                            <ScoreStat label="Avg (/ 120)" value={toeflStats.preAvg!.toFixed(0)} />
                            <ScoreStat label="Min" value={String(toeflStats.preMin)} />
                            <ScoreStat label="Max" value={String(toeflStats.preMax)} />
                          </Group>
                          <Text size="xs" c="dimmed">
                            {toeflStats.preCount} applicant{toeflStats.preCount === 1 ? '' : 's'} on pre-2026 scale
                          </Text>
                        </Stack>
                      )}
                      {toeflStats.newCount > 0 && (
                        <Stack gap={2}>
                          <Group gap="xl">
                            <ScoreStat label="Avg (/ 6)" value={toeflStats.newAvg!.toFixed(1)} />
                          </Group>
                          <Text size="xs" c="dimmed">
                            {toeflStats.newCount} applicant{toeflStats.newCount === 1 ? '' : 's'} on new scale
                          </Text>
                        </Stack>
                      )}
                      <Text size="xs" c="dimmed">
                        {toeflStats.totalWithScore} of {total} applicants have a parseable TOEFL score
                      </Text>
                    </Stack>
                  ) : (
                    <Text size="sm" c="dimmed">
                      No TOEFL score data yet.
                    </Text>
                  )}
                </div>
              </Stack>
            </Card>

            {/* Countries */}
            <Card withBorder padding="md">
              <Group gap="xs" mb="sm">
                <ThemeIcon color="navy" variant="light" size={24} radius="md">
                  <IconWorld size={14} />
                </ThemeIcon>
                <Text fw={600}>Country of Citizenship</Text>
              </Group>
              {countriesBreakdown.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No country data yet — populated after uploading applications.
                </Text>
              ) : (
                <Stack gap="sm">
                  {countriesBreakdown.map(({ country, count }) => (
                    <div key={country}>
                      <Group justify="space-between" mb={2}>
                        <Text size="sm">{country}</Text>
                        <Text size="sm" c="dimmed">
                          {count} ({Math.round((count / withCountry) * 100)}%)
                        </Text>
                      </Group>
                      <Progress value={(count / withCountry) * 100} color="navy" size="sm" />
                    </div>
                  ))}
                  {withCountry < total && (
                    <Text size="xs" c="dimmed">
                      {total - withCountry} applicant{total - withCountry === 1 ? '' : 's'} without country data (re-upload to populate)
                    </Text>
                  )}
                </Stack>
              )}
            </Card>
          </SimpleGrid>

          {/* Missing items */}
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

function ScoreStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="sm" fw={600}>{value}</Text>
    </div>
  );
}