import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Image,
  NativeModules,
  PermissionsAndroid,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Video from 'react-native-video';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { HA_TOKEN, HA_URL, CAMERA } from './src/config';
import {
  Device,
  EntityState,
  ha,
  hlsUrl,
  loadDevices,
  setInApp,
} from './src/ha';
import { AddSheet, C, DeviceCard, DeviceSheet } from './src/Devices';

function App() {
  const [states, setStates] = useState<Record<string, EntityState>>({});
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list: EntityState[] = await ha('states');
      setStates(Object.fromEntries(list.map(st => [st.entity_id, st])));
      setError(null);
    } catch (e) {
      setError(`Home Assistant injoignable : ${(e as Error).message}`);
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setDevices(await loadDevices());
      await refresh();
    } catch (e) {
      setError(`Appareils : ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    reload();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [reload, refresh]);

  // Notifications : service Android natif (NotifyService.kt) abonné à l'événement HA `jardin_notify`
  useEffect(() => {
    PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS').then(
      () => NativeModules.Notify.start(HA_URL, HA_TOKEN),
    );
  }, []);

  const toggle = async (d: Device, inApp: boolean) => {
    try {
      await setInApp(d, inApp);
      setOpenId(null);
      setAdding(false);
      reload();
    } catch (e) {
      setError(`Mise à jour : ${(e as Error).message}`);
    }
  };

  // Vidéo HLS ; en cas d'échec, repli sur le snapshot HA rafraîchi chaque seconde
  const [stream, setStream] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  // Nouvelle URL = retour au direct : au lancement, au retour au premier plan, et après une erreur
  const openStream = useCallback(() => {
    setStream(null);
    hlsUrl(CAMERA).then(setStream, e => setError(`Vidéo : ${e.message}`));
  }, []);
  useEffect(() => {
    openStream();
    const sub = AppState.addEventListener(
      'change',
      st => st === 'active' && openStream(),
    );
    return () => sub.remove();
  }, [openStream]);
  useEffect(() => {
    if (stream) return;
    const t = setInterval(() => setFrame(f => f + 1), 1000);
    return () => clearInterval(t);
  }, [stream]);

  const mine = devices.filter(d => d.inApp);

  // Grille responsive : colonnes de ~170 px min, contenu centré et borné sur tablette
  const { width } = useWindowDimensions();
  const inner = Math.min(width, 900) - 32;
  const cols = Math.max(2, Math.floor((inner + GAP) / (170 + GAP)));
  const cardW = (inner - GAP * (cols - 1)) / cols;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <SafeAreaView style={s.root}>
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
        >
          <View style={s.head}>
            <Text style={s.title}>Jardin</Text>
            <Pressable
              onPress={() => setAdding(true)}
              style={({ pressed }) => [s.add, pressed && { opacity: 0.6 }]}
            >
              <Text style={s.addTxt}>＋</Text>
            </Pressable>
          </View>
          {error && <Text style={s.error}>{error}</Text>}

          {stream ? (
            <Video
              style={s.camera}
              source={{
                uri: stream,
                // Petit tampon + vitesse ajustée pour rester ~2 s derrière le direct (sinon dérive de minutes)
                bufferConfig: {
                  minBufferMs: 1000,
                  maxBufferMs: 4000,
                  bufferForPlaybackMs: 500,
                  bufferForPlaybackAfterRebufferMs: 1000,
                  live: {
                    targetOffsetMs: 2000,
                    maxOffsetMs: 6000,
                    maxPlaybackSpeed: 1.1,
                  },
                },
              }}
              muted
              resizeMode="contain"
              onError={() => setTimeout(openStream, 2000)}
            />
          ) : (
            // entity_picture = URL signée par HA (token tournant, rafraîchi avec les états)
            <Image
              style={s.camera}
              fadeDuration={0}
              source={{
                uri: `${HA_URL}${states[CAMERA]?.attributes.entity_picture}&t=${frame}`,
              }}
            />
          )}

          <Text style={s.section}>Appareils</Text>
          {mine.length === 0 && !loading && (
            <Text style={s.hint}>Touchez ＋ pour ajouter un appareil.</Text>
          )}
          <View style={s.grid}>
            {mine.map(d => (
              <DeviceCard
                key={d.id}
                device={d}
                states={states}
                width={cardW}
                onOpen={() => setOpenId(d.id)}
                onChange={refresh}
              />
            ))}
          </View>
        </ScrollView>

        <DeviceSheet
          device={mine.find(d => d.id === openId) ?? null}
          states={states}
          onClose={() => setOpenId(null)}
          onChange={refresh}
          onRemove={d => toggle(d, false)}
        />
        <AddSheet
          visible={adding}
          devices={devices.filter(d => !d.inApp)}
          onClose={() => setAdding(false)}
          onAdd={d => toggle(d, true)}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const GAP = 12;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: {
    padding: 16,
    gap: GAP,
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: C.text, fontSize: 34, fontWeight: '700' },
  add: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTxt: { color: '#007aff', fontSize: 24 },
  error: {
    color: '#c0392b',
    backgroundColor: '#fdecea',
    padding: 12,
    borderRadius: 12,
  },
  camera: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 20,
    backgroundColor: '#000',
  },
  section: { color: C.text, fontSize: 22, fontWeight: '700', marginTop: 8 },
  hint: { color: C.muted, fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
});

export default App;
