/** A full row of the vehicles table (fake data), without archive_folder. Test fixture only. */
export const FULL_ROW = {
  id: 'veh-golden-1',
  garage_id: 'default',
  kind: 'car',
  name: 'Test car',
  make: 'Exemple',
  model: 'Test',
  year: 2015,
  vin: 'VF1TESTVIN0000001',
  first_registration_date: '2015-03-02',
  purchase_date: '2019-06-15',
  fuel: 'diesel',
  transmission: 'manual',
  drivetrain: 'fwd',
  distribution: 'belt',
  cooling: null,
  final_drive: null,
  cylinders: 4,
  has_hydraulic_clutch: 0,
  has_turbo: 1,
  has_direct_injection: 0,
  has_start_stop: 1,
  has_adblue: 0,
  has_ac: 1,
  has_air_suspension: 0,
  ownership: 'sold',
  on_garage_page: 1,
  sold_date: '2024-05-01',
  sold_odometer: 123456,
  sold_price: 4500.5,
  equipment: '["Transmission chaîne","Turbo"]',
  notion_page_id: null,
  created_at: '2026-01-01 00:00:00',
};

/**
 * What the server answered for FULL_ROW with archive_folder 'Exemple/Test car', captured from the hand-written
 * toVehicle before the field table replaced it. The wire shape must stay byte-identical.
 */
export const GOLDEN =
  '{"id":"veh-golden-1","name":"Test car","make":"Exemple","model":"Test","year":2015,"vin":"VF1TESTVIN0000001","firstRegistrationDate":"2015-03-02","purchaseDate":"2019-06-15","kind":"car","fuel":"diesel","transmission":"manual","drivetrain":"fwd","distribution":"belt","cooling":null,"finalDrive":null,"cylinders":4,"hasHydraulicClutch":false,"hasTurbo":true,"hasDirectInjection":false,"hasStartStop":true,"hasAdblue":false,"hasAc":true,"hasAirSuspension":false,"ownership":"sold","onGaragePage":true,"soldDate":"2024-05-01","soldOdometer":123456,"soldPrice":4500.5,"equipment":["Transmission chaîne","Turbo"],"notionPageId":null,"archiveFolder":"Exemple/Test car"}';
