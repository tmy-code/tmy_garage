import { useLayoutEffect } from 'react';
import { LanguageSwitch, Layout, NotFound } from './components.tsx';
import { useT } from './i18n.ts';
import { Dashboard } from './pages/Dashboard.tsx';
import {
  ClaimForm,
  DriverForm,
  InsurancePage,
  PolicyForm,
  PolicyPage,
  QuoteForm,
  QuotePackPage,
  TermForm,
  VehicleInsurancePage,
} from './pages/Insurance.tsx';
import { DocumentsPage, InspectionForm, InspectionsPage, ModificationForm, ModificationsPage } from './pages/Papers.tsx';
import { RemindersPage } from './pages/Reminders.tsx';
import { ReadingForm, ServiceForm } from './pages/ServiceForm.tsx';
import { CopyTasks, SellForm, TaskForm, VehicleForm } from './pages/SetupForms.tsx';
import { VehiclePage } from './pages/VehiclePage.tsx';
import { FittedPage, PartSpecsPage, ShoppingPage, SpecsPage, TaskPage, WorkshopForm } from './pages/Workshop.tsx';
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
  if (section === 'shopping') return <ShoppingPage snapshot={snapshot} />;
  if (section === 'insurance') return <InsurancePage snapshot={snapshot} />;
  if (section === 'reminders') return <RemindersPage />;
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
      case 'documents':
        return <DocumentsPage vehicle={vehicle} snapshot={snapshot} />;
      case 'inspections':
        if (subId === 'new') return <InspectionForm vehicle={vehicle} snapshot={snapshot} />;
        return <InspectionsPage vehicle={vehicle} snapshot={snapshot} />;
      case 'modifications':
        if (subId === 'new') return <ModificationForm vehicle={vehicle} snapshot={snapshot} />;
        return <ModificationsPage vehicle={vehicle} snapshot={snapshot} />;
      case 'insurance':
        return <VehicleInsurancePage vehicle={vehicle} snapshot={snapshot} />;
      case 'quote-pack':
        return <QuotePackPage vehicle={vehicle} snapshot={snapshot} />;
      case 'quotes':
        if (subId === 'new') return <QuoteForm vehicle={vehicle} snapshot={snapshot} />;
        break;
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
  if (section === 'inspections') {
    const inspection = snapshot.inspections.find((i) => i.id === id);
    const owner = inspection && snapshot.vehicles.find((v) => v.id === inspection.vehicleId);
    if (inspection && owner) return <InspectionForm key={inspection.id} vehicle={owner} snapshot={snapshot} existing={inspection} />;
  }
  if (section === 'modifications') {
    const modification = snapshot.modifications.find((m) => m.id === id);
    const owner = modification && snapshot.vehicles.find((v) => v.id === modification.vehicleId);
    if (modification && owner)
      return <ModificationForm key={modification.id} vehicle={owner} snapshot={snapshot} existing={modification} />;
  }
  if (section === 'policies' && id === 'new') return <PolicyForm snapshot={snapshot} />;
  if (section === 'policies') {
    const policy = snapshot.policies.find((p) => p.id === id);
    if (policy && sub === undefined) return <PolicyPage policy={policy} snapshot={snapshot} />;
    if (policy && sub === 'edit') return <PolicyForm key={policy.id} snapshot={snapshot} existing={policy} />;
    if (policy && sub === 'terms' && subId === 'new') return <TermForm policy={policy} snapshot={snapshot} />;
    if (policy && sub === 'claims' && subId === 'new') return <ClaimForm policy={policy} snapshot={snapshot} />;
  }
  if (section === 'terms') {
    const policy = snapshot.policies.find((p) => p.terms.some((term) => term.id === id));
    const term = policy?.terms.find((x) => x.id === id);
    if (policy && term) return <TermForm key={term.id} policy={policy} snapshot={snapshot} existing={term} />;
  }
  if (section === 'claims') {
    const claim = snapshot.claims.find((c) => c.id === id);
    const policy = claim && snapshot.policies.find((p) => p.id === claim.policyId);
    if (claim && policy) return <ClaimForm key={claim.id} policy={policy} snapshot={snapshot} existing={claim} />;
  }
  if (section === 'drivers' && id === 'new') return <DriverForm />;
  if (section === 'drivers') {
    const driver = snapshot.drivers.find((d) => d.id === id);
    if (driver) return <DriverForm key={driver.id} existing={driver} />;
  }
  if (section === 'quotes') {
    const quote = snapshot.quotes.find((q) => q.id === id);
    const owner = quote && snapshot.vehicles.find((v) => v.id === quote.vehicleId);
    if (quote && owner) return <QuoteForm key={quote.id} vehicle={owner} snapshot={snapshot} existing={quote} />;
  }
  return <NotFound what="page" />;
}
