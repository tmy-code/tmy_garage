import { useLayoutEffect } from 'react';
import { LanguageSwitch, Layout, NotFound } from './components.tsx';
import { useT } from './i18n.ts';
import { Dashboard, ManageGaragePage } from './pages/Dashboard.tsx';
import { CataloguePage, PartForm } from './pages/PartCatalogue.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { catalogueOf } from '../shared/catalogue.ts';
import { ReadingForm, ServiceForm } from './pages/ServiceForm.tsx';
import { CopyTasks, SellForm, TaskForm, VehicleForm } from './pages/SetupForms.tsx';
import { VehiclePage } from './pages/VehiclePage.tsx';
import { PartsPage, VehiclePartForm } from './pages/Parts.tsx';
import { SpecsPage, TaskPage, WorkshopPage } from './pages/Workshop.tsx';
import { scrollForNewRoute, useRoute } from './router.ts';
import { sync, useStore } from './store.ts';

export function App() {
  const t = useT();
  const { view: snapshot, loaded, reachable, syncing } = useStore();
  const route = useRoute();
  const path = route.join('/');

  // A new screen opens at the top; going back returns to where the previous one was scrolled.
  useLayoutEffect(() => {
    window.scrollTo(0, scrollForNewRoute());
  }, [path]);

  if (!loaded) {
    return (
      <Layout title={t.garage}>
        <p className="empty loading">{t.startup.loading}</p>
      </Layout>
    );
  }
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
  if (section === 'workshop') return <WorkshopPage snapshot={snapshot} />;
  if (section === 'parts') {
    if (id === undefined) return <PartsPage snapshot={snapshot} />;
    if (id === 'vehicle' && sub) return <PartsPage key={sub} snapshot={snapshot} vehicleId={sub} />;
    if (id === 'new') return <VehiclePartForm key={sub ?? 'new'} snapshot={snapshot} vehicleId={sub} />;
    const part = id === 'part' ? snapshot.vehicleParts.find((p) => p.id === sub) : undefined;
    return part ? <VehiclePartForm key={part.id} snapshot={snapshot} existing={part} /> : <NotFound what="page" />;
  }
  // Reminders used to have their own page; links to it (a test notification, say) open the settings.
  if (section === 'settings' && id === 'parts') {
    if (sub === undefined) return <CataloguePage snapshot={snapshot} />;
    if (sub === 'new' && (subId === 'car' || subId === 'motorcycle')) return <PartForm key={subId} kind={subId} />;
    const part = catalogueOf(snapshot).known(sub);
    return part ? <PartForm key={part.code} part={part} kind={part.kind} /> : <NotFound what="page" />;
  }
  if (section === 'settings' || section === 'reminders') return <SettingsPage />;
  if (section === 'vehicles' && id === 'new') return <VehicleForm />;
  if (section === 'vehicles' && id === 'manage') {
    if (sub === undefined) return <ManageGaragePage snapshot={snapshot} />;
    const edited = snapshot.vehicles.find((v) => v.id === sub);
    return edited ? <VehicleForm key={edited.id} existing={edited} returnTo="/vehicles/manage" /> : <NotFound what="vehicle" />;
  }
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
        return <ServiceForm key={subId} vehicle={vehicle} snapshot={snapshot} preselect={subId} />;
      case 'reading':
        return <ReadingForm vehicle={vehicle} snapshot={snapshot} />;
      case 'copy-tasks':
        return <CopyTasks vehicle={vehicle} snapshot={snapshot} />;
      case 'specs':
        return <SpecsPage vehicle={vehicle} snapshot={snapshot} />;
      case 'parts':
        return <PartsPage key={vehicle.id} snapshot={snapshot} vehicleId={vehicle.id} />;
      case 'tasks':
        if (subId === 'new') return <TaskForm vehicle={vehicle} snapshot={snapshot} />;
    }
  }
  if (section === 'tasks') {
    const task = snapshot.tasks.find((t) => t.id === id);
    const owner = task && snapshot.vehicles.find((v) => v.id === task.vehicleId);
    if (!task || !owner) return <NotFound what="task" />;
    if (sub === undefined) return <TaskPage key={task.id} task={task} vehicle={owner} snapshot={snapshot} />;
    if (sub === 'edit') return <TaskForm key={task.id} vehicle={owner} snapshot={snapshot} existing={task} />;
  }
  if (section === 'readings' && sub === 'edit') {
    const reading = snapshot.readings.find((r) => r.id === id);
    const owner = reading && snapshot.vehicles.find((v) => v.id === reading.vehicleId);
    if (reading && owner) return <ReadingForm key={reading.id} vehicle={owner} snapshot={snapshot} existing={reading} />;
    return <NotFound what="page" />;
  }
  if (section === 'services' && sub === 'edit') {
    const service = snapshot.services.find((s) => s.id === id);
    const owner = service && snapshot.vehicles.find((v) => v.id === service.vehicleId);
    if (service && owner) return <ServiceForm key={service.id} vehicle={owner} snapshot={snapshot} existing={service} />;
    return <NotFound what="service" />;
  }
  return <NotFound what="page" />;
}
