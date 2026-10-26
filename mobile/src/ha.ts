import { HA_URL } from './config';

// Jeton de l'utilisateur connecté (longue durée, créé après le login HA/Google)
let HA_TOKEN = '';
export const setToken = (t: string) => (HA_TOKEN = t);

// Connexion OAuth Home Assistant ; client_id = page servie par HA qui déclare la redirection iotrigger://auth
export const CLIENT_ID = `${HA_URL}/local/iotrigger.html`;
export const REDIRECT = 'iotrigger://auth';
export const loginUrl = () =>
  `${HA_URL}/auth/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT)}`;

// Code d'autorisation → jeton court → jeton longue durée (même rôle que l'utilisateur)
export async function exchange(code: string) {
  const res = await fetch(`${HA_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&client_id=${encodeURIComponent(CLIENT_ID)}`,
  });
  if (!res.ok) throw new Error(`Connexion refusée (HTTP ${res.status})`);
  setToken((await res.json()).access_token);
  return ws<string>('auth/long_lived_access_token', {
    client_name: `IoTrigger ${new Date().toISOString()}`,
    lifespan: 3650,
  });
}

export const currentUser = () =>
  ws<{ name: string; is_admin: boolean }>('auth/current_user');

export type EntityState = {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    unit_of_measurement?: string;
    entity_picture?: string;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
  };
};

// Home Assistant REST API : GET /api/states, POST /api/services/<domain>/<service>
export async function ha(path: string, body?: object) {
  const res = await fetch(`${HA_URL}/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${HA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const callService = (entityId: string, service: string, data = {}) =>
  ha(`services/${entityId.split('.')[0]}/${service}`, {
    entity_id: entityId,
    ...data,
  });

// Une commande WebSocket HA (registres, flux caméra) : connexion ouverte puis fermée
export function ws<T = any>(type: string, data: object = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(`${HA_URL.replace(/^http/, 'ws')}/api/websocket`);
    sock.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'auth_required')
        sock.send(JSON.stringify({ type: 'auth', access_token: HA_TOKEN }));
      else if (msg.type === 'auth_ok')
        sock.send(JSON.stringify({ id: 1, type, ...data }));
      else if (msg.type === 'result') {
        sock.close();
        msg.success ? resolve(msg.result) : reject(new Error(msg.error?.message));
      } else if (msg.type === 'auth_invalid') reject(new Error('token refusé'));
    };
    sock.onerror = () => reject(new Error('WebSocket HA injoignable'));
  });
}

// Flux HLS : HA ne l'expose qu'en WebSocket (camera/stream) → URL signée
export const hlsUrl = (entityId: string) =>
  ws<{ url: string }>('camera/stream', { entity_id: entityId }).then(
    r => `${HA_URL}${r.url}`,
  );

export type Device = {
  id: string;
  name: string;
  area: string;
  areaId: string | null;
  inApp: boolean;
  entities: string[];
};

const APP_LABEL = 'app';

// Appareils HA + leurs entités visibles. Un appareil est dans l'app s'il porte le libellé `app`.
export type Area = { area_id: string; name: string };

// Espaces de l'app = pièces (areas) HA
export async function loadDevices(): Promise<{ devices: Device[]; areas: Area[] }> {
  const [devices, entities, areas] = await Promise.all([
    ws<any[]>('config/device_registry/list'),
    ws<any[]>('config/entity_registry/list'),
    ws<any[]>('config/area_registry/list'),
  ]);
  const areaName = Object.fromEntries(areas.map(a => [a.area_id, a.name]));
  const list = devices
    .filter(d => !d.disabled_by && d.entry_type !== 'service')
    .map(d => ({
      id: d.id,
      name: d.name_by_user ?? d.name,
      area: areaName[d.area_id] ?? '',
      areaId: d.area_id,
      inApp: d.labels.includes(APP_LABEL),
      entities: entities
        .filter(e => e.device_id === d.id && !e.hidden_by && !e.disabled_by)
        .map(e => e.entity_id),
    }))
    .filter(d => d.entities.length);
  return { devices: list, areas };
}

export const createArea = (name: string) =>
  ws<Area>('config/area_registry/create', { name });

export const renameDevice = (device: Device, name: string) =>
  ws('config/device_registry/update', { device_id: device.id, name_by_user: name || null });

export const renameArea = (areaId: string, name: string) =>
  ws('config/area_registry/update', { area_id: areaId, name });

// Les appareils de l'espace restent dans HA, sans pièce
export const deleteArea = (areaId: string) =>
  ws('config/area_registry/delete', { area_id: areaId });

export const setArea = (device: Device, areaId: string) =>
  ws('config/device_registry/update', { device_id: device.id, area_id: areaId });

export async function setInApp(device: Device, inApp: boolean) {
  const labels = await ws<any[]>('config/label_registry/list');
  if (!labels.some(l => l.label_id === APP_LABEL))
    await ws('config/label_registry/create', { name: APP_LABEL });
  const d = (await ws<any[]>('config/device_registry/list')).find(
    x => x.id === device.id,
  );
  const others = d.labels.filter((l: string) => l !== APP_LABEL);
  await ws('config/device_registry/update', {
    device_id: device.id,
    labels: inApp ? [...others, APP_LABEL] : others,
  });
}
