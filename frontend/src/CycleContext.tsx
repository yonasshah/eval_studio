import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { notifications } from '@mantine/notifications';
import type { Cycle } from './types';

// In development, Vite serves the frontend on :5173 and FastAPI runs
// separately on :8000, so requests need an explicit absolute URL. In a
// production build (used when FastAPI serves these static files itself,
// e.g. inside the packaged desktop app), frontend and backend share the
// same origin, so a relative/empty base correctly points requests back
// at whatever host:port the page itself was loaded from.
const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';
const SELECTED_CYCLE_KEY = 'evalStudio.selectedCycleId';

interface CycleContextValue {
  cycles: Cycle[];
  selectedCycleId: string | null;
  selectedCycle: Cycle | null;
  loadingCycles: boolean;
  setSelectedCycleId: (id: string | null) => void;
  createCycle: (name: string) => Promise<Cycle | null>;
  deleteCycle: (cycleId: string) => Promise<void>;
  refreshCycles: () => Promise<void>;
}

const CycleContext = createContext<CycleContextValue | null>(null);

export function CycleProvider({ children }: { children: ReactNode }) {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [selectedCycleId, setSelectedCycleIdState] = useState<string | null>(
    () => localStorage.getItem(SELECTED_CYCLE_KEY)
  );
  const [loadingCycles, setLoadingCycles] = useState(true);

  async function refreshCycles() {
    try {
      const res = await fetch(`${API_BASE}/api/cycles`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      const results: Cycle[] = data.results ?? [];
      setCycles(results);

      // If nothing is selected yet, or the previously-selected cycle no
      // longer exists (e.g. it was deleted in a prior session), default to
      // the most recently created cycle so the app never sits in a
      // "no cycle selected" limbo state with nothing to show.
      setSelectedCycleIdState((prev) => {
        const stillExists = prev && results.some((c) => c.cycle_id === prev);
        if (stillExists) return prev;
        return results[0]?.cycle_id ?? null;
      });
    } catch (e) {
      notifications.show({
        title: 'Could not load cycles',
        message: e instanceof Error ? e.message : 'Unknown error.',
        color: 'red',
      });
    } finally {
      setLoadingCycles(false);
    }
  }

  useEffect(() => {
    refreshCycles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setSelectedCycleId(id: string | null) {
    setSelectedCycleIdState(id);
    if (id) localStorage.setItem(SELECTED_CYCLE_KEY, id);
    else localStorage.removeItem(SELECTED_CYCLE_KEY);
  }

  async function createCycle(name: string): Promise<Cycle | null> {
    try {
      const res = await fetch(`${API_BASE}/api/cycles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const created = await res.json();
      await refreshCycles();
      setSelectedCycleId(created.cycle_id);
      notifications.show({ message: `Cycle "${name}" created.`, color: 'teal', autoClose: 2500 });
      return created;
    } catch (e) {
      notifications.show({
        title: 'Could not create cycle',
        message: e instanceof Error ? e.message : 'Unknown error.',
        color: 'red',
      });
      return null;
    }
  }

  async function deleteCycle(cycleId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/cycles/${cycleId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      await refreshCycles();
      notifications.show({ message: 'Cycle deleted. Its applicants moved to Unassigned.', color: 'teal', autoClose: 3000 });
    } catch (e) {
      notifications.show({
        title: 'Could not delete cycle',
        message: e instanceof Error ? e.message : 'Unknown error.',
        color: 'red',
      });
    }
  }

  const selectedCycle = cycles.find((c) => c.cycle_id === selectedCycleId) ?? null;

  return (
    <CycleContext.Provider
      value={{
        cycles,
        selectedCycleId,
        selectedCycle,
        loadingCycles,
        setSelectedCycleId,
        createCycle,
        deleteCycle,
        refreshCycles,
      }}
    >
      {children}
    </CycleContext.Provider>
  );
}

export function useCycles() {
  const ctx = useContext(CycleContext);
  if (!ctx) throw new Error('useCycles must be used within a CycleProvider');
  return ctx;
}

export { API_BASE };