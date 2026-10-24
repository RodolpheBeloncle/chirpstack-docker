// Copier en src/config.ts (gitignoré) puis rebuild.
// Token : Home Assistant → Profil → Sécurité → Jetons d'accès longue durée.
export const HA_URL = 'http://192.168.1.X:8123';
export const HA_TOKEN = 'COLLER_LE_TOKEN_ICI';

export const SENSORS = [
  { id: 'sensor.sol_humidite', label: 'Humidité du sol' },
  { id: 'sensor.sol_temperature', label: 'Température du sol' },
  { id: 'sensor.sol_conductivite', label: 'Conductivité' },
  { id: 'sensor.sonde_batterie', label: 'Batterie sonde' },
  { id: 'sensor.sonde_signal_snr', label: 'Signal (SNR)' },
];
export const VALVE = 'switch.vanne_jardin';
export const CAMERA = 'camera.jardin_sd'; // flux SD : plus stable en 4G (HD = camera.jardin)
