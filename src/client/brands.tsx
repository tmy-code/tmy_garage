import {
  siBmw,
  siCitroen,
  siDacia,
  siDsautomobiles,
  siDucati,
  siFiat,
  siFord,
  siHonda,
  siHusqvarna,
  siHyundai,
  siJeep,
  siKia,
  siKtm,
  siMaserati,
  siMazda,
  siMg,
  siMini,
  siMitsubishi,
  siNissan,
  siOpel,
  siPeugeot,
  siPiaggiogroup,
  siPolestar,
  siRenault,
  siSeat,
  siSkoda,
  siSmart,
  siSubaru,
  siSuzuki,
  siTesla,
  siToyota,
  siVespa,
  siVolkswagen,
  siVolvo,
  siYamahamotorcorporation,
  type SimpleIcon,
} from 'simple-icons';
import type { Vehicle } from '../shared/types.ts';
import { Icon } from './icons.tsx';

// Car logos from Simple Icons (CC0). Makes it doesn't carry (Mercedes…) keep the plain icon, and so do
// detailed crests (Ferrari, Porsche, Lamborghini): unreadable at icon size and heavy to load.
const LOGOS: Record<string, SimpleIcon> = {
  bmw: siBmw,
  citroen: siCitroen,
  dacia: siDacia,
  ds: siDsautomobiles,
  dsautomobiles: siDsautomobiles,
  ducati: siDucati,
  fiat: siFiat,
  ford: siFord,
  honda: siHonda,
  husqvarna: siHusqvarna,
  hyundai: siHyundai,
  jeep: siJeep,
  kia: siKia,
  ktm: siKtm,
  maserati: siMaserati,
  mazda: siMazda,
  mg: siMg,
  mini: siMini,
  mitsubishi: siMitsubishi,
  nissan: siNissan,
  opel: siOpel,
  peugeot: siPeugeot,
  piaggio: siPiaggiogroup,
  polestar: siPolestar,
  renault: siRenault,
  seat: siSeat,
  skoda: siSkoda,
  smart: siSmart,
  subaru: siSubaru,
  suzuki: siSuzuki,
  tesla: siTesla,
  toyota: siToyota,
  vespa: siVespa,
  volkswagen: siVolkswagen,
  vw: siVolkswagen,
  volvo: siVolvo,
  yamaha: siYamahamotorcorporation,
};

/** The make's logo, matched loosely: "Citroën", "CITROEN" and "Citroen DS" all find Citroën. */
export function makeLogo(make: string | null): SimpleIcon | null {
  if (!make) return null;
  const words = make
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return LOGOS[words.join('')] ?? LOGOS[words[0] ?? ''] ?? null;
}

// Motorbike makes without a car logo, still worth suggesting when typing the make.
const BIKE_MAKES = ['Aprilia', 'Harley-Davidson', 'Kawasaki', 'Moto Guzzi', 'Royal Enfield', 'Triumph'];

/** Makes offered as suggestions when typing the make. */
export const KNOWN_MAKES = [
  ...new Set([...Object.values(LOGOS).map((logo) => logo.title.replace(/ (Motor )?(Corporation|Group)$/, '')), ...BIKE_MAKES]),
].sort();

/** Motorbikes show their make written in capitals, as on a tank, rather than a logo. */
export function makeAsName(vehicle: Pick<Vehicle, 'kind' | 'make'>): string | null {
  const make = vehicle.make?.trim();
  return vehicle.kind === 'motorcycle' && make ? make.toUpperCase() : null;
}

/** A car's make logo, a motorbike's make in capitals, or the car / motorbike icon when there is no make to show. */
export function VehicleIcon({ vehicle }: { vehicle: Pick<Vehicle, 'kind' | 'make'> }) {
  const name = makeAsName(vehicle);
  if (name) return <span className="brand-name">{name}</span>;
  const logo = vehicle.kind === 'car' ? makeLogo(vehicle.make) : null;
  if (!logo) return <Icon name={vehicle.kind} />;
  return (
    <svg className="icon brand-logo" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={logo.path} />
    </svg>
  );
}
