import {
  Appearance,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { HA_URL } from './config';
import { Area, callService, Device, EntityState } from './ha';

type States = Record<string, EntityState>;

// Couleurs système iOS (clair / sombre). ponytail: thème lu au lancement, Appearance listener si bascule à chaud nécessaire
const dark = Appearance.getColorScheme() === 'dark';
export const C = dark
  ? {
      bg: '#000000',
      card: '#1c1c1e',
      tile: '#2c2c2e',
      fill: '#3a3a3c',
      text: '#ffffff',
      muted: '#8e8e93',
      sep: '#38383a',
      green: '#30d158',
      orange: '#ff9f0a',
      red: '#ff453a',
      blue: '#0a84ff',
      dark,
    }
  : {
      bg: '#f2f2f7',
      card: '#ffffff',
      tile: '#e5e5ea',
      fill: '#f2f2f7',
      text: '#000000',
      muted: '#8e8e93',
      sep: '#c6c6c8',
      green: '#34c759',
      orange: '#ff9500',
      red: '#ff3b30',
      blue: '#007aff',
      dark,
    };

const domain = (id: string) => id.split('.')[0];
const TOGGLE = ['switch', 'light', 'fan', 'input_boolean'];
const DEAD = ['unknown', 'unavailable'];
const label = (st?: EntityState) => st?.attributes.friendly_name ?? '';
const value = (st?: EntityState) =>
  !st
    ? '…'
    : DEAD.includes(st.state)
    ? '—'
    : `${st.state} ${st.attributes.unit_of_measurement ?? ''}`.trim();
const cls = (st?: EntityState) => st?.attributes.device_class;

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
    const k = cls(states[e]) ?? domain(e);
    if (ICONS[k]) return ICONS[k];
  }
  return '◻️';
};

export const ago = (ms: number) => {
  const m = Math.round(ms / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  if (m < 1440) return `il y a ${Math.round(m / 60)} h`;
  return `il y a ${Math.round(m / 1440)} j`;
};

// Santé : hors ligne si toutes les entités sont indisponibles ; LoRaWAN en retard sans trame depuis 2 h
// ponytail: seuil LoRa fixe (SE01-LS ≈ 20 min), le lire de l'intervalle d'envoi si plusieurs profils
const LORA_LATE_MS = 2 * 3600 * 1000;
export type Level = 'ok' | 'late' | 'off';
export function health(d: Device, states: States, now = Date.now()) {
  const sts = d.entities.map(e => states[e]).filter(Boolean);
  const seen = Math.max(
    0,
    ...sts.map(
      st => Date.parse(st.last_reported ?? st.last_updated ?? '') || 0,
    ),
  );
  const level: Level =
    sts.length && sts.every(st => st.state === 'unavailable')
      ? 'off'
      : d.protocol === 'LoRaWAN' && now - seen > LORA_LATE_MS
      ? 'late'
      : 'ok';
  const text =
    level === 'off'
      ? 'Hors ligne'
      : level === 'late'
      ? 'En retard'
      : 'Connecté';
  return { level, text, seen };
}
export const levelColor = (l: Level) =>
  l === 'ok' ? C.green : l === 'late' ? C.orange : C.red;

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
  const h = health(device, states);
  // Résumé : santé si problème, sinon 2 premières mesures, sinon état de l'interrupteur
  const summary =
    h.level !== 'ok'
      ? h.text
      : device.entities
          .filter(
            e =>
              ['sensor', 'binary_sensor'].includes(domain(e)) &&
              cls(states[e]) !== 'signal_strength',
          )
          .slice(0, 2)
          .map(e => value(states[e]))
          .join(' · ') || (toggle ? (on ? 'Activé' : 'Désactivé') : '');
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${device.name}, ${summary}`}
      style={({ pressed }) => [
        s.card,
        { width },
        on && s.cardOn,
        h.level === 'off' && s.cardOff,
        pressed && s.pressed,
      ]}
    >
      <Pressable
        disabled={!toggle || readOnly}
        hitSlop={8}
        accessibilityLabel={on ? 'Éteindre' : 'Allumer'}
        onPress={() =>
          toggle &&
          callService(toggle, on ? 'turn_off' : 'turn_on').then(onChange)
        }
        style={[s.icon, on && { backgroundColor: C.green }]}
      >
        <Text style={s.iconTxt}>{icon(device, states)}</Text>
        {h.level !== 'ok' && (
          <View style={[s.dot, { backgroundColor: levelColor(h.level) }]} />
        )}
      </Pressable>
      <View style={s.flex}>
        <Text style={s.name} numberOfLines={1}>
          {device.name}
        </Text>
        <Text
          style={[
            s.summary,
            h.level !== 'ok' && { color: levelColor(h.level) },
          ]}
          numberOfLines={1}
        >
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
        trackColor={{ true: C.green }}
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
        <Pressable
          style={s.stepBtn}
          accessibilityLabel="Diminuer"
          onPress={() => set(n - step)}
        >
          <Text style={s.stepTxt}>−</Text>
        </Pressable>
        <Text style={s.rowValue}>{value(st)}</Text>
        <Pressable
          style={s.stepBtn}
          accessibilityLabel="Augmenter"
          onPress={() => set(n + step)}
        >
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

// Ligne de liste groupée iOS (libellé à gauche, valeur à droite)
function Row({
  k,
  v,
  color,
  last,
}: {
  k: string;
  v: string;
  color?: string;
  last?: boolean;
}) {
  return (
    <View style={[s.row, last && s.rowLast]}>
      <Text style={s.rowLabel}>{k}</Text>
      <View style={s.rowRight}>
        {color && <View style={[s.dotInline, { backgroundColor: color }]} />}
        <Text style={s.rowValue}>{v}</Text>
      </View>
    </View>
  );
}

const Header = ({ children }: { children: string }) => (
  <Text style={s.header}>{children.toUpperCase()}</Text>
);

// Fiche santé : protocole, statut, dernière activité, signal radio, batterie
function Health({ device, states }: { device: Device; states: States }) {
  const h = health(device, states);
  const find = (c: string) =>
    device.entities
      .map(e => states[e])
      .filter(st => cls(st) === c && !DEAD.includes(st!.state));
  const signal = find('signal_strength')
    .map(st => value(st))
    .join(' · ');
  const battery = [...find('battery'), ...find('voltage')][0];
  const rows: [string, string, string?][] = [
    ['Protocole', device.protocol],
    ['Statut', h.text, levelColor(h.level)],
    ['Dernière activité', h.seen ? ago(Date.now() - h.seen) : '—'],
  ];
  if (signal) rows.push(['Signal', signal]);
  if (battery) rows.push(['Batterie', value(battery)]);
  return (
    <View>
      <Header>Connexion</Header>
      <View style={s.group}>
        {rows.map(([k, v, c], i) => (
          <Row key={k} k={k} v={v} color={c} last={i === rows.length - 1} />
        ))}
      </View>
    </View>
  );
}

function SheetHead({
  title,
  sub,
  action,
  onClose,
}: {
  title: string;
  sub?: string;
  action: string;
  onClose: () => void;
}) {
  return (
    <View style={s.sheetHead}>
      <View style={s.flex}>
        {!!sub && <Text style={s.sub}>{sub}</Text>}
        <Text style={s.sheetTitle}>{title}</Text>
      </View>
      <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
        <Text style={s.link}>{action}</Text>
      </Pressable>
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
  onRename,
  readOnly,
  video,
}: {
  video?: React.ReactNode;
  device: Device | null;
  states: States;
  onClose: () => void;
  onChange: () => void;
  onRemove: (d: Device) => void;
  areas: Area[];
  onArea: (d: Device, areaId: string) => void;
  onRename: (d: Device, name: string) => void;
  readOnly: boolean;
}) {
  // Le signal radio est affiché dans la fiche santé, la caméra en direct en tête (prop video)
  const controls = device?.entities.filter(
    e =>
      cls(states[e]) !== 'signal_strength' &&
      !(video && domain(e) === 'camera'),
  );
  return (
    <Modal
      visible={!!device}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {device && (
        <ScrollView style={s.sheet} contentContainerStyle={s.sheetContent}>
          <SheetHead
            title={device.name}
            sub={device.area}
            action="OK"
            onClose={onClose}
          />
          {video}
          {controls!.length > 0 && (
            <View>
              <Header>Mesures et commandes</Header>
              <View style={s.group}>
                {controls!.map(id => (
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
            </View>
          )}
          <Health device={device} states={states} />
          {!readOnly && (
            <>
              <View>
                <Header>Nom</Header>
                <TextInput
                  key={device.id}
                  defaultValue={device.name}
                  onEndEditing={e => {
                    const n = e.nativeEvent.text.trim();
                    if (n && n !== device.name) onRename(device, n);
                  }}
                  style={[s.group, s.input]}
                />
              </View>
              <View>
                <Header>Espace</Header>
                <View style={s.chips}>
                  {areas.map(a => (
                    <Pressable
                      key={a.area_id}
                      style={[
                        s.chip,
                        s.chipCard,
                        device.areaId === a.area_id && s.chipOn,
                      ]}
                      onPress={() => onArea(device, a.area_id)}
                    >
                      <Text
                        style={[
                          s.chipTxt,
                          device.areaId === a.area_id && s.chipTxtOn,
                        ]}
                      >
                        {a.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <Pressable
                onPress={() => onRemove(device)}
                style={[s.group, s.remove]}
              >
                <Text style={s.removeTxt}>Retirer de l'app</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      )}
    </Modal>
  );
}

// Réglages d'un espace (appui long sur l'onglet) : renommer, supprimer
export function SpaceSheet({
  area,
  count,
  onClose,
  onRename,
  onDelete,
}: {
  area: Area | null;
  count: number;
  onClose: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  return (
    <Modal
      visible={!!area}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {area && (
        <ScrollView style={s.sheet} contentContainerStyle={s.sheetContent}>
          <SheetHead title="Espace" action="OK" onClose={onClose} />
          <View>
            <Header>Nom</Header>
            <TextInput
              defaultValue={area.name}
              onEndEditing={e => {
                const n = e.nativeEvent.text.trim();
                if (n && n !== area.name) onRename(n);
              }}
              style={[s.group, s.input]}
            />
            <Text style={s.footer}>{count} appareil(s) dans cet espace.</Text>
          </View>
          <View>
            <Pressable onPress={onDelete} style={[s.group, s.remove]}>
              <Text style={s.removeTxt}>Supprimer l'espace</Text>
            </Pressable>
            <Text style={s.footer}>
              Les appareils ne sont pas supprimés : ils passent dans l'onglet «
              Sans espace ».
            </Text>
          </View>
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
        <SheetHead
          title="Ajouter un appareil"
          action="Fermer"
          onClose={onClose}
        />
        {devices.length === 0 ? (
          <Text style={s.footer}>
            Aucun nouvel appareil. Un ESP32 flashé avec ESPHome, ou un capteur
            LoRa ajouté dans ChirpStack, apparaît ici dès que Home Assistant le
            découvre.
          </Text>
        ) : (
          <View style={s.group}>
            {devices.map((d, i) => (
              <Pressable
                key={d.id}
                style={({ pressed }) => [
                  s.row,
                  i === devices.length - 1 && s.rowLast,
                  pressed && { backgroundColor: C.fill },
                ]}
                onPress={() => onAdd(d)}
              >
                <View style={s.flex}>
                  <Text style={s.rowLabel}>{d.name}</Text>
                  <Text style={s.hint}>
                    {[d.protocol, d.area, `${d.entities.length} entité(s)`]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Text style={s.plus}>＋</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </Modal>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  // Tuile Apple Home : icône ronde à gauche, nom + état à droite
  card: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.tile,
    borderRadius: 16,
    paddingHorizontal: 12,
  },
  cardOn: { backgroundColor: C.card },
  cardOff: { opacity: 0.55 },
  pressed: { transform: [{ scale: 0.96 }] },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTxt: { fontSize: 20 },
  dot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: C.tile,
  },
  dotInline: { width: 8, height: 8, borderRadius: 4 },
  name: { color: C.text, fontSize: 15, fontWeight: '600' },
  summary: { color: C.muted, fontSize: 13, marginTop: 1 },
  sub: { color: C.muted, fontSize: 13, fontWeight: '500' },
  header: {
    color: C.muted,
    fontSize: 13,
    marginLeft: 16,
    marginBottom: 6,
  },
  footer: { color: C.muted, fontSize: 13, marginHorizontal: 16, marginTop: 6 },
  sheet: { flex: 1, backgroundColor: C.bg },
  sheetContent: { padding: 16, gap: 28 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start' },
  sheetTitle: { color: C.text, fontSize: 28, fontWeight: '700' },
  link: { color: C.blue, fontSize: 17, fontWeight: '600' },
  group: { backgroundColor: C.card, borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.sep,
  },
  rowLast: { borderBottomWidth: 0 },
  rowWide: { flexDirection: 'column', alignItems: 'flex-start' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowLabel: { color: C.text, fontSize: 17 },
  rowValue: { color: C.muted, fontSize: 17 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTxt: { color: C.text, fontSize: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: C.fill,
  },
  chipCard: { backgroundColor: C.card },
  chipOn: { backgroundColor: C.blue },
  chipTxt: { color: C.text, fontSize: 15 },
  chipTxtOn: { color: '#fff', fontWeight: '600' },
  action: {
    backgroundColor: C.fill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  actionTxt: { color: C.blue, fontSize: 15, fontWeight: '600' },
  camera: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  remove: { alignItems: 'center', padding: 14 },
  removeTxt: { color: C.red, fontSize: 17 },
  hint: { color: C.muted, fontSize: 13 },
  plus: { color: C.blue, fontSize: 24 },
  input: { color: C.text, fontSize: 17, padding: 14 },
});
