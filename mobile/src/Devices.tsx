import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { HA_URL } from './config';
import { Area, callService, Device, EntityState } from './ha';

type States = Record<string, EntityState>;

const domain = (id: string) => id.split('.')[0];
const TOGGLE = ['switch', 'light', 'fan', 'input_boolean'];
const label = (st?: EntityState) => st?.attributes.friendly_name ?? '';
const value = (st?: EntityState) =>
  !st
    ? '…'
    : ['unknown', 'unavailable'].includes(st.state)
    ? '—'
    : `${st.state} ${st.attributes.unit_of_measurement ?? ''}`.trim();

// Nom d'entité sans le préfixe du nom de l'appareil (« Sonde Humidité » → « Humidité »)
const short = (st: EntityState | undefined, dev: Device) =>
  label(st).replace(dev.name, '').trim() || label(st);

const isOn = (st?: EntityState) => st?.state === 'on';

// Icône d'après le contenu de l'appareil (device_class des mesures, sinon domaine)
const ICONS: Record<string, string> = {
  moisture: '💧',
  temperature: '🌡️',
  humidity: '💧',
  illuminance: '☀️',
  motion: '🏃',
  camera: '📷',
  switch: '🚿',
  light: '💡',
  cover: '🪟',
};
const icon = (d: Device, states: States) => {
  for (const e of d.entities) {
    const k =
      (states[e]?.attributes as { device_class?: string })?.device_class ??
      domain(e);
    if (ICONS[k]) return ICONS[k];
  }
  return '◻️';
};

export function DeviceCard({
  device,
  states,
  width,
  onOpen,
  onChange,
  readOnly,
}: {
  device: Device;
  states: States;
  width: number;
  onOpen: () => void;
  onChange: () => void;
  readOnly: boolean;
}) {
  const toggle = device.entities.find(e => TOGGLE.includes(domain(e)));
  const on = isOn(states[toggle ?? '']);
  // Résumé : 2 premières mesures, sinon état de l'interrupteur
  const summary =
    device.entities
      .filter(e => ['sensor', 'binary_sensor'].includes(domain(e)))
      .slice(0, 2)
      .map(e => value(states[e]))
      .join(' · ') || (toggle ? (on ? 'Activé' : 'Désactivé') : '');
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        s.card,
        { width },
        on && s.cardOn,
        pressed && s.pressed,
      ]}
    >
      <Pressable
        disabled={!toggle || readOnly}
        hitSlop={8}
        onPress={() =>
          toggle &&
          callService(toggle, on ? 'turn_off' : 'turn_on').then(onChange)
        }
        style={[s.icon, on && s.iconOn]}
      >
        <Text style={s.iconTxt}>{icon(device, states)}</Text>
      </Pressable>
      <View>
        <Text style={[s.name, on && s.nameOn]} numberOfLines={1}>
          {device.name}
        </Text>
        <Text style={[s.summary, on && s.summaryOn]} numberOfLines={1}>
          {summary}
        </Text>
      </View>
    </Pressable>
  );
}

// Un contrôle par type d'entité HA
function Control({
  id,
  st,
  dev,
  onChange,
  readOnly,
}: {
  id: string;
  st?: EntityState;
  dev: Device;
  onChange: () => void;
  readOnly: boolean;
}) {
  const call = (service: string, data?: object) =>
    callService(id, service, data).then(onChange);
  const d = domain(id);
  const a = st?.attributes ?? {};
  let control;

  // Viewer : valeur seule, aucune commande (caméra exceptée)
  if (readOnly && d !== 'camera')
    control = <Text style={s.rowValue}>{value(st)}</Text>;
  else if (TOGGLE.includes(d))
    control = (
      <Switch
        value={st?.state === 'on'}
        onValueChange={v => call(v ? 'turn_on' : 'turn_off')}
      />
    );
  else if (d === 'number' || d === 'input_number') {
    const n = Number(st?.state);
    const step = a.step ?? 1;
    const set = (v: number) =>
      call('set_value', {
        value: Math.min(a.max ?? Infinity, Math.max(a.min ?? -Infinity, v)),
      });
    control = (
      <View style={s.stepper}>
        <Pressable style={s.stepBtn} onPress={() => set(n - step)}>
          <Text style={s.stepTxt}>−</Text>
        </Pressable>
        <Text style={s.rowValue}>{value(st)}</Text>
        <Pressable style={s.stepBtn} onPress={() => set(n + step)}>
          <Text style={s.stepTxt}>+</Text>
        </Pressable>
      </View>
    );
  } else if (d === 'select' || d === 'input_select')
    control = (
      <View style={s.chips}>
        {(a.options ?? []).map(o => (
          <Pressable
            key={o}
            onPress={() => call('select_option', { option: o })}
            style={[s.chip, st?.state === o && s.chipOn]}
          >
            <Text style={[s.chipTxt, st?.state === o && s.chipTxtOn]}>{o}</Text>
          </Pressable>
        ))}
      </View>
    );
  else if (d === 'button' || d === 'input_button')
    control = (
      <Pressable style={s.action} onPress={() => call('press')}>
        <Text style={s.actionTxt}>Exécuter</Text>
      </Pressable>
    );
  else if (d === 'cover')
    control = (
      <View style={s.chips}>
        {(['open_cover', 'stop_cover', 'close_cover'] as const).map((sv, i) => (
          <Pressable key={sv} style={s.chip} onPress={() => call(sv)}>
            <Text style={s.chipTxt}>{['Ouvrir', 'Stop', 'Fermer'][i]}</Text>
          </Pressable>
        ))}
      </View>
    );
  else if (d === 'camera')
    return (
      <Image
        style={s.camera}
        source={{ uri: `${HA_URL}${a.entity_picture}&t=${Date.now()}` }}
      />
    );
  else control = <Text style={s.rowValue}>{value(st)}</Text>;

  const wide = d === 'select' || d === 'input_select' || d === 'cover';
  return (
    <View style={[s.row, wide && s.rowWide]}>
      <Text style={s.rowLabel}>{short(st, dev)}</Text>
      {control}
    </View>
  );
}

export function DeviceSheet({
  device,
  states,
  onClose,
  onChange,
  onRemove,
  areas,
  onArea,
  readOnly,
}: {
  device: Device | null;
  states: States;
  onClose: () => void;
  onChange: () => void;
  onRemove: (d: Device) => void;
  areas: Area[];
  onArea: (d: Device, areaId: string) => void;
  readOnly: boolean;
}) {
  return (
    <Modal
      visible={!!device}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {device && (
        <ScrollView style={s.sheet} contentContainerStyle={s.sheetContent}>
          <View style={s.sheetHead}>
            <View style={s.flex}>
              <Text style={s.area}>{device.area}</Text>
              <Text style={s.sheetTitle}>{device.name}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={s.link}>OK</Text>
            </Pressable>
          </View>
          <View style={s.group}>
            {device.entities.map(id => (
              <Control
                key={id}
                id={id}
                st={states[id]}
                dev={device}
                onChange={onChange}
                readOnly={readOnly}
              />
            ))}
          </View>
          {!readOnly && (
          <>
          <Text style={s.area}>Espace</Text>
          <View style={s.chips}>
            {areas.map(a => (
              <Pressable
                key={a.area_id}
                style={[s.chip, device.areaId === a.area_id && s.chipOn]}
                onPress={() => onArea(device, a.area_id)}
              >
                <Text
                  style={[s.chipTxt, device.areaId === a.area_id && s.chipTxtOn]}
                >
                  {a.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => onRemove(device)} style={s.remove}>
            <Text style={s.removeTxt}>Retirer de l'app</Text>
          </Pressable>
          </>
          )}
        </ScrollView>
      )}
    </Modal>
  );
}

// Appareils HA pas encore dans l'app (ESPHome, MQTT, … découverts par HA)
export function AddSheet({
  visible,
  devices,
  onClose,
  onAdd,
}: {
  visible: boolean;
  devices: Device[];
  onClose: () => void;
  onAdd: (d: Device) => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ScrollView style={s.sheet} contentContainerStyle={s.sheetContent}>
        <View style={s.sheetHead}>
          <Text style={[s.sheetTitle, s.flex]}>Ajouter un appareil</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={s.link}>Fermer</Text>
          </Pressable>
        </View>
        {devices.length === 0 && (
          <Text style={s.hint}>
            Aucun nouvel appareil. Un ESP32 flashé avec ESPHome, ou un capteur
            LoRa ajouté dans ChirpStack, apparaît ici dès que Home Assistant le
            découvre.
          </Text>
        )}
        <View style={s.group}>
          {devices.map(d => (
            <Pressable key={d.id} style={s.row} onPress={() => onAdd(d)}>
              <View style={s.flex}>
                <Text style={s.rowLabel}>{d.name}</Text>
                <Text style={s.hint}>
                  {[d.area, `${d.entities.length} entité(s)`]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Text style={s.plus}>＋</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Modal>
  );
}

export const C = {
  bg: '#f2f2f7',
  card: '#ffffff',
  text: '#1c1c1e',
  muted: '#8e8e93',
  accent: '#34c759',
  sep: '#e5e5ea',
};

const s = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    aspectRatio: 1.15,
    backgroundColor: C.card,
    borderRadius: 22,
    padding: 14,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardOn: { backgroundColor: '#ffffff', borderWidth: 2, borderColor: C.accent },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOn: { backgroundColor: '#d8f5df' },
  iconTxt: { fontSize: 22 },
  name: { color: C.text, fontSize: 16, fontWeight: '600' },
  nameOn: { color: C.text },
  summary: { color: C.muted, fontSize: 14, marginTop: 2 },
  summaryOn: { color: '#248a3d', fontWeight: '600' },
  area: { color: C.muted, fontSize: 13, fontWeight: '500' },
  sheet: { flex: 1, backgroundColor: C.bg },
  sheetContent: { padding: 20, gap: 16 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start' },
  sheetTitle: { color: C.text, fontSize: 28, fontWeight: '700' },
  link: { color: '#007aff', fontSize: 17, fontWeight: '600' },
  group: { backgroundColor: C.card, borderRadius: 14, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.sep,
  },
  rowWide: { flexDirection: 'column', alignItems: 'flex-start' },
  rowLabel: { color: C.text, fontSize: 16 },
  rowValue: { color: C.muted, fontSize: 16 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTxt: { color: C.text, fontSize: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: C.bg,
  },
  chipOn: { backgroundColor: C.accent },
  chipTxt: { color: C.text, fontSize: 15 },
  chipTxtOn: { color: '#fff', fontWeight: '600' },
  action: {
    backgroundColor: C.bg,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  actionTxt: { color: '#007aff', fontSize: 15, fontWeight: '600' },
  camera: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  remove: { alignItems: 'center', padding: 14 },
  removeTxt: { color: '#ff3b30', fontSize: 16 },
  hint: { color: C.muted, fontSize: 14 },
  plus: { color: '#007aff', fontSize: 24 },
});
