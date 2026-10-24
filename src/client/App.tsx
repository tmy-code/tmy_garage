import { LanguageSwitch, Layout, NotFound } from './components.tsx';
import { useT } from './i18n.ts';
import { Dashboard } from './pages/Dashboard.tsx';
import { ReadingForm, ServiceForm } from './pages/ServiceForm.tsx';
import { CopyTasks, SellForm, TaskForm, VehicleForm } from './pages/SetupForms.tsx';
import { VehiclePage } from './pages/VehiclePage.tsx';
import { FittedPage, PartSpecsPage, ShoppingPage, SpecsPage, TaskPage, WorkshopForm } from './pages/Workshop.tsx';
import { useRoute } from './router.ts';
import { sync, useStore } from './store.ts';

export function App() {
  const t = useT();
  const { view: snapshot, loaded, reachable, syncing } = useStore();
  const route = useRoute();

  if (!loaded) return null;
  if (!snapshot) {
    return (
      <Layout title={t.garage}>
        <div className="empty">
          {syncing ? (
            <p>{t.startup.loading}</p>
          ) : (
            <>
              <p>{reachable ? t.startup.loading : t.startup.unreachable}</p>
              <p className="muted">{t.startup.openOnce}</p>
              <button type="button" className="button" onClick={() => void sync()}>
                {t.startup.tryAgain}
              </button>
            </>
          )}
        </div>
        <LanguageSwitch />
      </Layout>
    );
  }

  const [section, id, sub, subId] = route;
  const vehicle = section === 'vehicles' && id ? snapshot.vehicles.find((v) => v.id === id) : undefined;

  if (section === undefined) return <Dashboard snapshot={snapshot} />;
  if (section === 'shopping') return <ShoppingPage snapshot={snapshot} />;
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
      case 'specs':
        return <SpecsPage vehicle={vehicle} snapshot={snapshot} />;
      case 'parts':
        return <PartSpecsPage vehicle={vehicle} snapshot={snapshot} />;
      case 'fitted':
        return <FittedPage vehicle={vehicle} snapshot={snapshot} />;
      case 'tasks':
        if (subId === 'new') return <TaskForm vehicle={vehicle} />;
    }
  }
  if (section === 'tasks') {
    const task = snapshot.tasks.find((t) => t.id === id);
    const owner = task && snapshot.vehicles.find((v) => v.id === task.vehicleId);
    if (!task || !owner) return <NotFound what="task" />;
    if (sub === undefined) return <TaskPage key={task.id} task={task} vehicle={owner} snapshot={snapshot} />;
    if (sub === 'edit') return <TaskForm key={task.id} vehicle={owner} existing={task} />;
    if (sub === 'workshop') return <WorkshopForm key={task.id} task={task} vehicle={owner} snapshot={snapshot} />;
  }
  if (section === 'services' && sub === 'edit') {
    const service = snapshot.services.find((s) => s.id === id);
    const owner = service && snapshot.vehicles.find((v) => v.id === service.vehicleId);
    if (service && owner) return <ServiceForm key={service.id} vehicle={owner} snapshot={snapshot} existing={service} />;
    return <NotFound what="service" />;
  }
  return <NotFound what="page" />;
}
