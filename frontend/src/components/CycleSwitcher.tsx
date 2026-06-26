import { useState } from 'react';
import { Menu, Button, TextInput, Stack, Text, Group, Badge } from '@mantine/core';
import { IconChevronDown, IconPlus, IconCalendarEvent } from '@tabler/icons-react';
import { useCycles } from '../CycleContext';

export default function CycleSwitcher() {
  const { cycles, selectedCycleId, selectedCycle, setSelectedCycleId, createCycle, loadingCycles } =
    useCycles();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const created = await createCycle(name);
    if (created) {
      setNewName('');
      setCreating(false);
    }
  }

  if (loadingCycles) {
    return (
      <Button variant="default" leftSection={<IconCalendarEvent size={16} />} loading>
        Loading cycles
      </Button>
    );
  }

  return (
    <Menu shadow="md" width={280} closeOnItemClick={false}>
      <Menu.Target>
        <Button
          variant="default"
          leftSection={<IconCalendarEvent size={16} />}
          rightSection={<IconChevronDown size={14} />}
        >
          {selectedCycle ? selectedCycle.name : 'No cycle selected'}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Cycles</Menu.Label>
        {cycles.length === 0 && (
          <Text size="sm" c="dimmed" px="sm" py="xs">
            No cycles yet. Create one below.
          </Text>
        )}
        {cycles.map((cycle) => (
          <Menu.Item
            key={cycle.cycle_id}
            onClick={() => setSelectedCycleId(cycle.cycle_id)}
            style={{
              backgroundColor:
                cycle.cycle_id === selectedCycleId ? 'var(--mantine-color-navy-0)' : undefined,
            }}
          >
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" fw={cycle.cycle_id === selectedCycleId ? 600 : 400}>
                {cycle.name}
              </Text>
              <Badge size="xs" variant="light" color="gray">
                {cycle.applicant_count}
              </Badge>
            </Group>
          </Menu.Item>
        ))}

        <Menu.Divider />

        {creating ? (
          <Stack gap="xs" p="xs">
            <TextInput
              placeholder="e.g. 2026-2027"
              size="xs"
              value={newName}
              onChange={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setCreating(false);
              }}
              autoFocus
            />
            <Group gap="xs">
              <Button size="xs" color="navy" onClick={handleCreate} disabled={!newName.trim()}>
                Create
              </Button>
              <Button size="xs" variant="subtle" color="gray" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </Group>
          </Stack>
        ) : (
          <Menu.Item leftSection={<IconPlus size={14} />} onClick={() => setCreating(true)}>
            New cycle
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
