import { useState } from 'react';
import { AppShell, Title, Text, Group, UnstyledButton, NavLink, Stack, ActionIcon, Tooltip } from '@mantine/core';
import {
  IconListCheck,
  IconArchive,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from '@tabler/icons-react';
import { CycleProvider } from './CycleContext';
import CycleSwitcher from './components/CycleSwitcher';
import TriagePage from './pages/TriagePage';
import ArchivePage from './pages/ArchivePage';
import DashboardPage from './pages/DashboardPage';
import evalStudioIcon from './assets/eval-studio-icon.svg';

type PageKey = 'triage' | 'archive' | 'dashboard';

const NAVBAR_COLLAPSED_KEY = 'evalStudio.navbarCollapsed';

const NAV_ITEMS: { key: PageKey; label: string; icon: typeof IconListCheck }[] = [
  { key: 'triage', label: 'Triage', icon: IconListCheck },
  { key: 'archive', label: 'Archive', icon: IconArchive },
  { key: 'dashboard', label: 'Dashboard', icon: IconLayoutDashboard },
];

function AppShellContent() {
  const [page, setPage] = useState<PageKey>('triage');
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(NAVBAR_COLLAPSED_KEY) === 'true'
  );

  function goHome() {
    setPage('triage');
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(NAVBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  }

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: collapsed ? 72 : 220, breakpoint: 'sm' }}
      footer={{ height: 48 }}
      padding="md"
    >
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

      <AppShell.Navbar
        p={collapsed ? 'xs' : 'md'}
        style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
      >
        <Stack gap={4}>
          {NAV_ITEMS.map(({ key, label, icon: Icon }) =>
            collapsed ? (
              <Tooltip key={key} label={label} position="right" withArrow>
                <ActionIcon
                  size="lg"
                  variant={page === key ? 'light' : 'subtle'}
                  color="navy"
                  onClick={() => setPage(key)}
                  style={{ alignSelf: 'center' }}
                >
                  <Icon size={20} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <NavLink
                key={key}
                label={label}
                leftSection={<Icon size={18} />}
                active={page === key}
                onClick={() => setPage(key)}
                variant="light"
                color="navy"
              />
            )
          )}
        </Stack>

        <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} position="right" withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="lg"
            onClick={toggleCollapsed}
            style={{ alignSelf: collapsed ? 'center' : 'flex-end' }}
          >
            {collapsed ? (
              <IconLayoutSidebarLeftExpand size={20} />
            ) : (
              <IconLayoutSidebarLeftCollapse size={20} />
            )}
          </ActionIcon>
        </Tooltip>
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