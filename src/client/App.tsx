import { Layout, NotFound } from './components.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { ReadingForm, ServiceForm } from './pages/ServiceForm.tsx';
import { CopyTasks, SellForm, TaskForm, VehicleForm } from './pages/SetupForms.tsx';
import { VehiclePage } from './pages/VehiclePage.tsx';
import { useRoute } from './router.ts';
import { sync, useStore } from './store.ts';

export function App() {
  const { view: snapshot, loaded, reachable, syncing } = useStore();
  const route = useRoute();

  if (!loaded) return null;
  if (!snapshot) {
    return (
      <Layout title="Garage">
        <div className="empty">
          {syncing ? (
            <p>Loading your garage…</p>
          ) : (
            <>
              <p>{reachable ? 'Loading your garage…' : 'Can’t reach the garage server, and there is no offline copy on this phone yet.'}</p>
              <p className="muted">Open the app once with a connection so it can work offline afterwards.</p>
              <button type="button" className="button" onClick={() => void sync()}>
                Try again
              </button>
            </>
          )}
        </div>
      </Layout>
    );
  }

  const [section, id, sub, subId] = route;
  const vehicle = section === 'vehicles' && id ? snapshot.vehicles.find((v) => v.id === id) : undefined;

  if (section === undefined) return <Dashboard snapshot={snapshot} />;
  if (section === 'vehicles' && id === 'new') return <VehicleForm />;
  if (section === 'vehicles') {
    if (!vehicle) return <NotFound what="vehicle" />;
    switch (sub) {
      case undefined:
        return <VehiclePage vehicle={vehicle} snapshot={snapshot} />;
      case 'edit':
        return <VehicleForm existing={vehicle} />;
      case 'sell':
        return <SellForm vehicle={vehicle} />;
      case 'service':
        return <ServiceForm vehicle={vehicle} snapshot={snapshot} />;
      case 'reading':
        return <ReadingForm vehicle={vehicle} snapshot={snapshot} />;
      case 'copy-tasks':
        return <CopyTasks vehicle={vehicle} snapshot={snapshot} />;
      case 'tasks':
        if (subId === 'new') return <TaskForm vehicle={vehicle} />;
    }
  }
  if (section === 'tasks' && sub === 'edit') {
    const task = snapshot.tasks.find((t) => t.id === id);
    const owner = task && snapshot.vehicles.find((v) => v.id === task.vehicleId);
    if (task && owner) return <TaskForm key={task.id} vehicle={owner} existing={task} />;
    return <NotFound what="task" />;
  }
  if (section === 'services' && sub === 'edit') {
    const service = snapshot.services.find((s) => s.id === id);
    const owner = service && snapshot.vehicles.find((v) => v.id === service.vehicleId);
    if (service && owner) return <ServiceForm key={service.id} vehicle={owner} snapshot={snapshot} existing={service} />;
    return <NotFound what="Service" />;
  }
  return <NotFound what="page" />;
}
