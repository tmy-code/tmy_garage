import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'fr';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

const plural = (n: number, one: string, many: string) => (Math.abs(n) === 1 ? one : many);

const en = {
  lang: 'en' as Lang,
  locale: 'en-GB',
  garage: 'Garage',
  back: 'Back',
  sync: {
    connecting: 'Connecting…',
    offline: 'Offline',
    offlineWaiting: (n: number) => `Offline · ${n} waiting`,
    syncing: 'Syncing…',
    syncingCount: (n: number) => `Syncing ${n}…`,
    synced: 'Synced',
    tapToSync: 'Tap to sync now',
  },
  rejected: {
    title: (n: number) => (n === 1 ? 'A change made offline could not be saved:' : `${n} changes made offline could not be saved:`),
    service: (date: string) => `Service of ${date}`,
    reading: (date: string) => `Odometer reading of ${date}`,
    dismiss: 'Dismiss',
  },
  status: { overdue: 'Overdue', dueSoon: 'Due soon', ok: 'OK', unknown: 'No record' },
  needsConnection: 'This needs a connection to the garage server. Services and odometer readings work offline.',
  notFound: {
    title: 'Not found',
    vehicle: "This vehicle doesn't exist, or hasn't been synced to this phone yet.",
    task: "This task doesn't exist, or hasn't been synced to this phone yet.",
    service: "This Service doesn't exist, or hasn't been synced to this phone yet.",
    page: "This page doesn't exist.",
  },
  startup: {
    loading: 'Loading your garage…',
    unreachable: 'Can’t reach the garage server, and there is no offline copy on this phone yet.',
    openOnce: 'Open the app once with a connection so it can work offline afterwards.',
    tryAgain: 'Try again',
  },
  language: 'Language',
  dashboard: {
    addVehicle: '+ Vehicle',
    noVehicles: 'No vehicles yet.',
    addFirst: 'Add your first vehicle',
    soldVehicles: (n: number) => `Sold vehicles (${n})`,
    soldOn: (date: string) => `sold ${date}`,
    noTasks: 'No Maintenance Tasks yet.',
    noReading: 'Add an odometer reading to start projecting Due Dates.',
    staleReading: (days: number) => `Last odometer reading ${days} days ago: add a fresh one to keep Due Dates accurate.`,
  },
  due: {
    noOdometer: 'Needs an odometer value for when it was last done',
    never: 'Never recorded: log a Service or set when it was last done',
    wasDue: 'Was due',
    due: 'Due',
    today: 'today',
    daysAgo: (n: number) => `${n} ${plural(n, 'day', 'days')} ago`,
    inDays: (n: number) => `in ${n} ${plural(n, 'day', 'days')}`,
    at: (km: string) => `at ${km}`,
    left: (km: string) => `${km} left`,
    over: (km: string) => `${km} over`,
    every: (parts: string[]) => `Every ${parts.join(' or ')}`,
    years: (n: number) => `${n} ${plural(n, 'year', 'years')}`,
    months: (n: number) => `${n} ${plural(n, 'month', 'months')}`,
  },
  vehicle: {
    sold: (details: string) => `Sold${details}. History is kept; nothing is due.`,
    soldDate: (date: string) => ` ${date}`,
    soldAt: (km: string) => ` at ${km}`,
    soldFor: (price: string) => ` for ${price}`,
    noReading: 'No odometer reading yet',
    rate: (kmPerMonth: number) => ` today, at ~${kmPerMonth} km/month`,
    lastReading: (km: string, date: string) => ` · last reading ${km} on ${date}`,
    logService: 'Log Service',
    odometerReading: 'Odometer reading',
    tasks: 'Maintenance Tasks',
    addTask: '+ Task',
    noTasks: "No Maintenance Tasks yet. Add them from the owner's manual, or copy them from another vehicle of the same model.",
    copyTasks: 'Copy tasks from another vehicle',
    copyTasksShort: 'Copy tasks from…',
    lastDone: (date: string) => `Last done ${date}`,
    beforeTracking: ' (before tracking)',
    history: 'History',
    nothingLogged: 'Nothing logged yet.',
    deletedTask: 'Deleted task',
    waitingToSync: 'Waiting to sync',
    readingEntry: 'Odometer reading',
    edit: 'Edit vehicle',
    markSold: 'Mark as sold',
    saleDetails: 'Sale details',
  },
  service: {
    titleNew: (vehicle: string) => `Service · ${vehicle}`,
    titleEdit: 'Edit Service',
    date: 'Date',
    odometer: 'Odometer (km)',
    lowerThanLatest: (km: string) => `Lower than the latest reading (${km}). Check the number.`,
    estimatedToday: (km: string) => `Estimated today: ${km}`,
    lastReading: (km: string) => `Last reading: ${km}`,
    tasksDone: 'Tasks done',
    noTasks: 'This vehicle has no Maintenance Tasks yet. Add them first.',
    notes: 'Notes',
    notesHint: 'Optional: oil brand, observations, anything to remember.',
    save: 'Save Service',
    saveChanges: 'Save changes',
    offlineHint: "You're offline: it will be sent when you're back in range.",
    delete: 'Delete Service',
    deleteAfterSync: 'Delete (available once synced)',
    confirmDelete: 'Delete this Service? Due Dates will be recalculated without it.',
    errorOdometer: 'Enter the odometer reading in whole km.',
    errorTasks: 'Tick at least one Maintenance Task done in this Service.',
    readingTitle: (vehicle: string) => `Odometer · ${vehicle}`,
    saveReading: 'Save reading',
    example: 'e.g. 24000',
  },
  setup: {
    wholeNumber: (label: string) => `${label} must be a whole number.`,
    newVehicle: 'New vehicle',
    editVehicle: 'Edit vehicle',
    kind: 'Kind',
    car: '🚗 Car',
    motorcycle: '🏍️ Motorcycle',
    name: 'Name',
    nameHint: 'What you call it, e.g. “The Tracer” or “Clio”.',
    make: 'Make',
    model: 'Model',
    year: 'Year',
    registration: 'Registration',
    save: 'Save',
    addVehicle: 'Add vehicle',
    sellTitle: (vehicle: string) => `Sell ${vehicle}`,
    sellIntro: 'A sold vehicle keeps its full history but no longer shows anything due.',
    saleDate: 'Sale date',
    saleOdometer: 'Odometer at sale (km)',
    price: 'Price (€)',
    priceError: 'Price must be a positive number.',
    saveSale: 'Save sale details',
    markSold: 'Mark as sold',
    unsell: 'Undo: I still own it',
    odometerLabel: 'Odometer',
    distanceLabel: 'Distance',
    monthsLabel: 'Months',
    newTask: (vehicle: string) => `New task · ${vehicle}`,
    editTask: 'Edit task',
    task: 'Task',
    taskHint: 'e.g. “Engine oil and filter change”.',
    interval: 'Interval: whichever comes first',
    everyKm: 'Every (km)',
    everyMonths: 'or every (months)',
    baseline: 'Last done before you started tracking (optional)',
    baselineDate: 'Date',
    baselineKm: 'At (km)',
    baselineHint: 'Once you log a Service including this task, the Service takes over from this.',
    needInterval: 'Give a distance, a duration, or both.',
    needBaselineDate: 'Add the date it was last done too.',
    addTask: 'Add task',
    deleteTask: 'Delete task',
    confirmDeleteTask: (name: string) => `Delete “${name}”?`,
    copyTitle: 'Copy tasks',
    nothingToCopy: 'No other vehicle has Maintenance Tasks to copy yet.',
    copyFrom: 'Copy from',
    copyHint: (n: number, vehicle: string) => `${n} ${plural(n, 'task', 'tasks')} will be added to ${vehicle}. Their history is not copied.`,
    copy: 'Copy tasks',
  },
};

export type Messages = typeof en;

const fr: Messages = {
  lang: 'fr',
  locale: 'fr-FR',
  garage: 'Garage',
  back: 'Retour',
  sync: {
    connecting: 'Connexion…',
    offline: 'Hors ligne',
    offlineWaiting: (n) => `Hors ligne · ${n} en attente`,
    syncing: 'Synchronisation…',
    syncingCount: (n) => `Envoi de ${n}…`,
    synced: 'Synchronisé',
    tapToSync: 'Toucher pour synchroniser',
  },
  rejected: {
    title: (n) =>
      n === 1
        ? 'Une modification faite hors ligne n’a pas pu être enregistrée :'
        : `${n} modifications faites hors ligne n’ont pas pu être enregistrées :`,
    service: (date) => `Entretien du ${date}`,
    reading: (date) => `Relevé kilométrique du ${date}`,
    dismiss: 'Fermer',
  },
  status: { overdue: 'En retard', dueSoon: 'Bientôt', ok: 'OK', unknown: 'Aucun historique' },
  needsConnection:
    'Cette action nécessite une connexion au serveur du garage. Les entretiens et relevés kilométriques fonctionnent hors ligne.',
  notFound: {
    title: 'Introuvable',
    vehicle: 'Ce véhicule n’existe pas, ou n’a pas encore été synchronisé sur ce téléphone.',
    task: 'Cette tâche n’existe pas, ou n’a pas encore été synchronisée sur ce téléphone.',
    service: 'Cet entretien n’existe pas, ou n’a pas encore été synchronisé sur ce téléphone.',
    page: 'Cette page n’existe pas.',
  },
  startup: {
    loading: 'Chargement de votre garage…',
    unreachable: 'Impossible de joindre le serveur du garage, et ce téléphone n’a pas encore de copie hors ligne.',
    openOnce: 'Ouvrez l’app une fois avec une connexion pour qu’elle fonctionne ensuite hors ligne.',
    tryAgain: 'Réessayer',
  },
  language: 'Langue',
  dashboard: {
    addVehicle: '+ Véhicule',
    noVehicles: 'Aucun véhicule pour l’instant.',
    addFirst: 'Ajouter votre premier véhicule',
    soldVehicles: (n) => `Véhicules vendus (${n})`,
    soldOn: (date) => `vendu le ${date}`,
    noTasks: 'Aucune tâche d’entretien pour l’instant.',
    noReading: 'Ajoutez un relevé kilométrique pour estimer les échéances.',
    staleReading: (days) => `Dernier relevé kilométrique il y a ${days} jours : ajoutez-en un pour garder des échéances fiables.`,
  },
  due: {
    noOdometer: 'Indiquez le kilométrage de la dernière fois',
    never: 'Jamais enregistré : ajoutez un entretien ou indiquez la dernière fois',
    wasDue: 'Échéance',
    due: 'Échéance',
    today: 'aujourd’hui',
    daysAgo: (n) => `il y a ${n} ${plural(n, 'jour', 'jours')}`,
    inDays: (n) => `dans ${n} ${plural(n, 'jour', 'jours')}`,
    at: (km) => `à ${km}`,
    left: (km) => `encore ${km}`,
    over: (km) => `${km} de dépassement`,
    every: (parts) => `Tous les ${parts.join(' ou ')}`,
    years: (n) => `${n} ${plural(n, 'an', 'ans')}`,
    months: (n) => `${n} mois`,
  },
  vehicle: {
    sold: (details) => `Vendu${details}. L’historique est conservé ; plus rien n’est à faire.`,
    soldDate: (date) => ` le ${date}`,
    soldAt: (km) => ` à ${km}`,
    soldFor: (price) => ` pour ${price}`,
    noReading: 'Aucun relevé kilométrique',
    rate: (kmPerMonth) => ` aujourd’hui, à ~${kmPerMonth} km/mois`,
    lastReading: (km, date) => ` · dernier relevé ${km} le ${date}`,
    logService: 'Ajouter un entretien',
    odometerReading: 'Relevé kilométrique',
    tasks: 'Tâches d’entretien',
    addTask: '+ Tâche',
    noTasks: 'Aucune tâche d’entretien. Ajoutez-les depuis le manuel du propriétaire, ou copiez-les d’un autre véhicule du même modèle.',
    copyTasks: 'Copier les tâches d’un autre véhicule',
    copyTasksShort: 'Copier les tâches de…',
    lastDone: (date) => `Dernière fois le ${date}`,
    beforeTracking: ' (avant le suivi)',
    history: 'Historique',
    nothingLogged: 'Rien d’enregistré pour l’instant.',
    deletedTask: 'Tâche supprimée',
    waitingToSync: 'En attente d’envoi',
    readingEntry: 'Relevé kilométrique',
    edit: 'Modifier le véhicule',
    markSold: 'Marquer comme vendu',
    saleDetails: 'Détails de la vente',
  },
  service: {
    titleNew: (vehicle) => `Entretien · ${vehicle}`,
    titleEdit: 'Modifier l’entretien',
    date: 'Date',
    odometer: 'Kilométrage (km)',
    lowerThanLatest: (km) => `Inférieur au dernier relevé (${km}). Vérifiez le chiffre.`,
    estimatedToday: (km) => `Estimé aujourd’hui : ${km}`,
    lastReading: (km) => `Dernier relevé : ${km}`,
    tasksDone: 'Tâches effectuées',
    noTasks: 'Ce véhicule n’a pas encore de tâches d’entretien. Ajoutez-les d’abord.',
    notes: 'Notes',
    notesHint: 'Facultatif : marque d’huile, observations, tout ce qui est utile.',
    save: 'Enregistrer l’entretien',
    saveChanges: 'Enregistrer les modifications',
    offlineHint: 'Vous êtes hors ligne : il sera envoyé dès que vous aurez du réseau.',
    delete: 'Supprimer l’entretien',
    deleteAfterSync: 'Supprimer (possible une fois synchronisé)',
    confirmDelete: 'Supprimer cet entretien ? Les échéances seront recalculées sans lui.',
    errorOdometer: 'Indiquez le kilométrage en km entiers.',
    errorTasks: 'Cochez au moins une tâche d’entretien effectuée.',
    readingTitle: (vehicle) => `Kilométrage · ${vehicle}`,
    saveReading: 'Enregistrer le relevé',
    example: 'ex. 24000',
  },
  setup: {
    wholeNumber: (label) => `${label} doit être un nombre entier.`,
    newVehicle: 'Nouveau véhicule',
    editVehicle: 'Modifier le véhicule',
    kind: 'Type',
    car: '🚗 Voiture',
    motorcycle: '🏍️ Moto',
    name: 'Nom',
    nameHint: 'Comment vous l’appelez, ex. « La Tracer » ou « Clio ».',
    make: 'Marque',
    model: 'Modèle',
    year: 'Année',
    registration: 'Immatriculation',
    save: 'Enregistrer',
    addVehicle: 'Ajouter le véhicule',
    sellTitle: (vehicle) => `Vendre ${vehicle}`,
    sellIntro: 'Un véhicule vendu garde tout son historique mais n’a plus rien à faire.',
    saleDate: 'Date de vente',
    saleOdometer: 'Kilométrage à la vente (km)',
    price: 'Prix (€)',
    priceError: 'Le prix doit être un nombre positif.',
    saveSale: 'Enregistrer la vente',
    markSold: 'Marquer comme vendu',
    unsell: 'Annuler : je l’ai toujours',
    odometerLabel: 'Le kilométrage',
    distanceLabel: 'La distance',
    monthsLabel: 'Le nombre de mois',
    newTask: (vehicle) => `Nouvelle tâche · ${vehicle}`,
    editTask: 'Modifier la tâche',
    task: 'Tâche',
    taskHint: 'ex. « Vidange huile moteur et filtre ».',
    interval: 'Intervalle : le premier atteint',
    everyKm: 'Tous les (km)',
    everyMonths: 'ou tous les (mois)',
    baseline: 'Dernière fois avant le début du suivi (facultatif)',
    baselineDate: 'Date',
    baselineKm: 'À (km)',
    baselineHint: 'Dès qu’un entretien inclut cette tâche, c’est lui qui compte.',
    needInterval: 'Indiquez une distance, une durée, ou les deux.',
    needBaselineDate: 'Indiquez aussi la date de la dernière fois.',
    addTask: 'Ajouter la tâche',
    deleteTask: 'Supprimer la tâche',
    confirmDeleteTask: (name) => `Supprimer « ${name} » ?`,
    copyTitle: 'Copier des tâches',
    nothingToCopy: 'Aucun autre véhicule n’a de tâches d’entretien à copier.',
    copyFrom: 'Copier depuis',
    copyHint: (n, vehicle) =>
      `${n} ${plural(n, 'tâche sera ajoutée', 'tâches seront ajoutées')} à ${vehicle}. Leur historique n’est pas copié.`,
    copy: 'Copier les tâches',
  },
};

const MESSAGES: Record<Lang, Messages> = { en, fr };
const STORAGE_KEY = 'lang';

// The choice is a per-device convenience, so localStorage is enough; it may be unavailable (private mode).
function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch {
    // fall through to the device language
  }
  const preferred = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  return preferred.some((l) => l?.toLowerCase().startsWith('fr')) ? 'fr' : 'en';
}

let current: Lang = typeof window !== 'undefined' ? detect() : 'en';
const listeners = new Set<() => void>();

if (typeof document !== 'undefined') document.documentElement.lang = current;

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // the choice then lasts until the app is closed
  }
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

export function getLang(): Lang {
  return current;
}

/** The current language's messages, for code outside components (formatting helpers). */
export function messages(): Messages {
  return MESSAGES[current];
}

export function messagesFor(lang: Lang): Messages {
  return MESSAGES[lang];
}

/** Messages for the current language; re-renders the component when the language changes. */
export function useT(): Messages {
  const lang = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  return MESSAGES[lang];
}
