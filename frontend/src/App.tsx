import { useState } from 'react';
import { AppShell, Title, Text, Group, UnstyledButton, NavLink, Stack } from '@mantine/core';
import { IconListCheck, IconArchive, IconLayoutDashboard } from '@tabler/icons-react';
import { CycleProvider } from './CycleContext';
import CycleSwitcher from './components/CycleSwitcher';
import TriagePage from './pages/TriagePage';
import ArchivePage from './pages/ArchivePage';
import DashboardPage from './pages/DashboardPage';
import evalStudioIcon from './assets/eval-studio-icon.svg';

type PageKey = 'triage' | 'archive' | 'dashboard';

function AppShellContent() {
  const [page, setPage] = useState<PageKey>('triage');

  function goHome() {
    setPage('triage');
  }

  return (
    <AppShell header={{ height: 64 }} navbar={{ width: 220, breakpoint: 'sm' }} footer={{ height: 48 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <UnstyledButton onClick={goHome} style={{ display: 'flex', alignItems: 'center' }}>
            <Group gap="xs">
              <img src={evalStudioIcon} alt="Evaluation Studio" width={32} height={32} style={{ borderRadius: 6 }} />
              <Title order={3} c="navy.9">
                Evaluation Studio
              </Title>
              <Text size="sm" c="dimmed">
                CAAPID application triage
              </Text>
            </Group>
          </UnstyledButton>
          <CycleSwitcher />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <Stack gap={4}>
          <NavLink
            label="Triage"
            leftSection={<IconListCheck size={18} />}
            active={page === 'triage'}
            onClick={() => setPage('triage')}
            variant="light"
            color="navy"
          />
          <NavLink
            label="Archive"
            leftSection={<IconArchive size={18} />}
            active={page === 'archive'}
            onClick={() => setPage('archive')}
            variant="light"
            color="navy"
          />
          <NavLink
            label="Dashboard"
            leftSection={<IconLayoutDashboard size={18} />}
            active={page === 'dashboard'}
            onClick={() => setPage('dashboard')}
            variant="light"
            color="navy"
          />
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        {page === 'triage' && <TriagePage />}
        {page === 'archive' && <ArchivePage />}
        {page === 'dashboard' && <DashboardPage />}
      </AppShell.Main>

      <AppShell.Footer>
        <Group h="100%" px="md" justify="center">
          <Text size="xs" c="dimmed" ta="center">
            Temple University Kornberg School of Dentistry · Admissions Team
          </Text>
        </Group>
      </AppShell.Footer>
    </AppShell>
  );
}

function App() {
  return (
    <CycleProvider>
      <AppShellContent />
    </CycleProvider>
  );
}

export default App;
