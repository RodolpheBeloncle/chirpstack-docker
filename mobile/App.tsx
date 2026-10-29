import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Image,
  NativeModules,
  PermissionsAndroid,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Video from 'react-native-video';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { HA_URL } from './src/config';
import {
  Area,
  createArea,
  currentUser,
  deleteArea,
  Device,
  EntityState,
  exchange,
  ha,
  hlsUrl,
  loadDevices,
  loginUrl,
  renameArea,
  renameDevice,
  setArea,
  setInApp,
  setToken,
} from './src/ha';
import {
  AddSheet,
  C,
  DeviceCard,
  DeviceSheet,
  ago,
  health,
  SpaceSheet,
} from './src/Devices';

// Connexion : page HA (bouton Google) → iotrigger://auth?code=… → jeton longue durée mémorisé côté natif
function App() {
  const [token, setTok] = useState<string | null | undefined>();
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const use = useCallback(async (t: string | null) => {
    if (t) {
      setToken(t);
      try {
        setAdmin((await currentUser()).is_admin);
      } catch {
        NativeModules.Notify.logout(); // jeton révoqué
        t = null;
      }
    }
    setTok(t);
  }, []);

  useEffect(() => {
    NativeModules.Notify.token().then(use);
    const onUrl = async ({ url }: { url: string }) => {
      const code = url.match(/[?&]code=([^&]+)/)?.[1];
      if (!url.startsWith('iotrigger://auth') || !code) return;
      try {
        const t = await exchange(decodeURIComponent(code));
        NativeModules.Notify.start(HA_URL, t);
        use(t);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    Linking.getInitialURL().then(url => {
      if (url) onUrl({ url });
    });
    const sub = Linking.addEventListener('url', onUrl);
    return () => sub.remove();
  }, [use]);

  if (token === undefined) return null;
  if (token === null)
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[s.root, s.login]}>
          <Image source={require('./assets/logo.png')} style={s.logo} />
          <Text style={s.title}>IoTrigger</Text>
          {error && <Text style={s.error}>{error}</Text>}
          <Pressable
            style={s.loginBtn}
            onPress={() => Linking.openURL(loginUrl())}
          >
            <Text style={s.loginTxt}>Se connecter</Text>
          </Pressable>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  return (
    <Home
      token={token}
      admin={admin}
      onLogout={() => {
        NativeModules.Notify.logout();
        setTok(null);
      }}
    />
  );
}

function Home({
  token,
  admin,
  onLogout,
}: {
  token: string;
  admin: boolean;
  onLogout: () => void;
}) {
  const [states, setStates] = useState<Record<string, EntityState>>({});
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [space, setSpace] = useState<string | null>(null);
  const [newSpace, setNewSpace] = useState<string | null>(null);
  const [editSpace, setEditSpace] = useState<Area | null>(null);

  // Synchro HA toutes les 10 s : registres (appareils, espaces, libellés) + états
  const refresh = useCallback(async () => {
    try {
      const [reg, list] = await Promise.all([
        loadDevices(),
        ha('states') as Promise<EntityState[]>,
      ]);
      setDevices(reg.devices);
      setAreas(reg.areas);
      setStates(Object.fromEntries(list.map(st => [st.entity_id, st])));
      setError(null);
    } catch (e) {
      setError(`Home Assistant injoignable : ${(e as Error).message}`);
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    await refresh();
    setLoading(false);
  }, [refresh]);

  useEffect(() => {
    reload();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [reload, refresh]);

  // Notifications : service Android natif (NotifyService.kt) abonné à `sensor.notification` (alimenté par l'événement `iotrigger_notify`)
  useEffect(() => {
    PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS').then(
      () => NativeModules.Notify.start(HA_URL, token),
    );
  }, [token]);

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

  const inApp = devices.filter(d => d.inApp);
  // Espaces affichés = ceux qui contiennent un appareil de l'app ; espace courant par défaut = le premier
  // Appareils sans pièce HA (espace supprimé, ou rangé nulle part) : onglet « Sans espace » plutôt qu'invisibles
  const spaces = [
    ...areas.filter(
      a => a.area_id === space || inApp.some(d => d.areaId === a.area_id),
    ),
    ...(inApp.some(d => !d.areaId)
      ? [{ area_id: NONE, name: 'Sans espace' }]
      : []),
    ...(admin ? [{ area_id: INFRA, name: 'Infra' }] : []),
  ];
  const current = spaces.some(a => a.area_id === space)
    ? space
    : spaces[0]?.area_id ?? null;
  const mine = inApp.filter(
    d => current === null || (d.areaId ?? NONE) === current,
  );
  // Caméra de l'appareil ouvert seulement (flux SD `_sd` préféré : plus stable en 4G)
  const opened = mine.find(d => d.id === openId) ?? null;
  const cams = (opened?.entities ?? []).filter(e => e.startsWith('camera.'));
  // Bilan global (tous espaces) : appareils hors ligne ou silencieux
  const issues = inApp.filter(d => health(d, states).level !== 'ok');
  const camera = cams.find(e => e.endsWith('_sd')) ?? cams[0] ?? null;

  // Vidéo HLS ; en cas d'échec, repli sur le snapshot HA rafraîchi chaque seconde
  const [stream, setStream] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  // Nouvelle URL = retour au direct : au lancement, au retour au premier plan, et après une erreur
  const openStream = useCallback(() => {
    setStream(null);
    if (camera)
      hlsUrl(camera).then(setStream, e => setError(`Vidéo : ${e.message}`));
  }, [camera]);
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

  const run = async (p: Promise<unknown>) => {
    try {
      await p;
      reload();
    } catch (e) {
      setError(`Mise à jour : ${(e as Error).message}`);
    }
  };
  const addSpace = async () => {
    const name = newSpace?.trim();
    setNewSpace(null);
    if (!name) return;
    try {
      setSpace((await createArea(name)).area_id);
      reload();
    } catch (e) {
      setError(`Espace : ${(e as Error).message}`);
    }
  };

  const video = camera && (
    <View style={s.videoBox}>
      {
        <View style={s.live}>
          <View style={s.liveDot} />
          <Text style={s.liveTxt}>EN DIRECT</Text>
        </View>
      }
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
            uri: `${HA_URL}${
              states[camera!]?.attributes.entity_picture
            }&t=${frame}`,
          }}
        />
      )}
    </View>
  );

  // Grille responsive : colonnes de ~170 px min, contenu centré et borné sur tablette
  const { width } = useWindowDimensions();
  const inner = Math.min(width, 900) - 32;
  const cols = Math.max(2, Math.floor((inner + GAP) / (170 + GAP)));
  const cardW = (inner - GAP * (cols - 1)) / cols;

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={C.dark ? 'light-content' : 'dark-content'}
        backgroundColor={C.bg}
      />
      <SafeAreaView style={s.root}>
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
        >
          <View style={s.head}>
            <Text style={s.title}>
              {spaces.find(a => a.area_id === current)?.name ?? 'Accueil'}
            </Text>
            <View style={s.actions}>
              {admin && (
                <Pressable
                  onPress={() => setAdding(true)}
                  accessibilityLabel="Ajouter un appareil"
                  style={({ pressed }) => [s.add, pressed && { opacity: 0.6 }]}
                >
                  <Text style={s.addTxt}>＋</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityLabel="Menu"
                onPress={() =>
                  Alert.alert(
                    'IoTrigger',
                    admin ? 'Administrateur' : 'Lecture seule',
                    [
                      { text: 'Annuler', style: 'cancel' },
                      {
                        text: 'Se déconnecter',
                        style: 'destructive',
                        onPress: onLogout,
                      },
                    ],
                  )
                }
                style={({ pressed }) => [s.add, pressed && { opacity: 0.6 }]}
              >
                <Text style={s.addTxt}>⋯</Text>
              </Pressable>
            </View>
          </View>
          {error && <Text style={s.error}>{error}</Text>}
          {/* État de la chaîne en un coup d'œil ; toucher = ouvrir le premier appareil en défaut */}
          {devices.length > 0 && (
            <Pressable
              disabled={!issues.length}
              onPress={() => {
                setSpace(issues[0].areaId ?? NONE);
                setOpenId(issues[0].id);
              }}
              style={s.status}
            >
              <View
                style={[
                  s.statusDot,
                  {
                    backgroundColor: error
                      ? C.red
                      : issues.length
                      ? C.orange
                      : C.green,
                  },
                ]}
              />
              <Text style={s.statusTxt}>
                {error
                  ? 'Serveur injoignable'
                  : issues.length
                  ? `${issues.length} appareil(s) à vérifier : ${issues
                      .map(d => d.name)
                      .join(', ')}`
                  : 'Tout est connecté'}
              </Text>
            </Pressable>
          )}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.tabs}
          >
            {spaces.map(a => (
              <Pressable
                key={a.area_id}
                onPress={() => setSpace(a.area_id)}
                onLongPress={() =>
                  admin && ![NONE, INFRA].includes(a.area_id) && setEditSpace(a)
                }
                style={[s.tab, a.area_id === current && s.tabOn]}
              >
                <Text style={[s.tabTxt, a.area_id === current && s.tabTxtOn]}>
                  {a.name}
                </Text>
              </Pressable>
            ))}
            {!admin ? null : newSpace === null ? (
              <Pressable onPress={() => setNewSpace('')} style={s.tab}>
                <Text style={s.tabTxt}>＋ Espace</Text>
              </Pressable>
            ) : (
              <TextInput
                autoFocus
                placeholder="Nom (ex. Maison)"
                value={newSpace}
                onChangeText={setNewSpace}
                onSubmitEditing={addSpace}
                onBlur={addSpace}
                style={[s.tab, s.tabInput]}
              />
            )}
          </ScrollView>

          {current === INFRA ? (
            <>
              <Text style={s.section}>Infrastructure</Text>
              {/* (binary_)sensor.infra_* (HA : sondes serveur + stats de la passerelle LoRa) */}
              {Object.values(states)
                .filter(e => /^(binary_)?sensor\.infra_/.test(e.entity_id))
                .map(e => (
                  <View key={e.entity_id} style={s.status}>
                    <View
                      style={[
                        s.statusDot,
                        { backgroundColor: e.state === 'on' ? C.green : C.red },
                      ]}
                    />
                    <Text style={s.statusTxt}>
                      {(e.attributes.friendly_name ?? e.entity_id).replace(
                        /^Infra /,
                        '',
                      )}
                      {' · '}
                      {e.state === 'on' ? 'OK' : 'hors service'}
                      {/* depuis = dernier changement d'état ; vérifié = dernière sonde (60 s) */}
                      {e.last_changed &&
                        ` depuis ${ago(
                          Date.now() - Date.parse(e.last_changed),
                        ).replace('il y a ', '')}`}
                      {(e.attributes.checked ?? e.last_reported) &&
                        ` · vérifié ${ago(
                          Date.now() -
                            Date.parse(
                              (e.attributes.checked ?? e.last_reported)!,
                            ),
                        )}`}
                    </Text>
                  </View>
                ))}
            </>
          ) : (
            <>
              <Text style={s.section}>Appareils</Text>
              {mine.length === 0 && !loading && (
                <Text style={s.hint}>
                  {admin
                    ? 'Touchez ＋ pour ajouter un appareil.'
                    : 'Aucun appareil partagé.'}
                </Text>
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
                    readOnly={!admin}
                  />
                ))}
              </View>
            </>
          )}
        </ScrollView>

        <DeviceSheet
          device={opened}
          video={video}
          states={states}
          onClose={() => setOpenId(null)}
          onChange={refresh}
          onRemove={d => toggle(d, false)}
          readOnly={!admin}
          areas={areas}
          onRename={(d, n) => run(renameDevice(d, n))}
          onArea={(d, id) => {
            setSpace(id);
            run(setArea(d, id));
          }}
        />
        <SpaceSheet
          area={editSpace}
          count={inApp.filter(d => d.areaId === editSpace?.area_id).length}
          onClose={() => setEditSpace(null)}
          onRename={n => editSpace && run(renameArea(editSpace.area_id, n))}
          onDelete={() =>
            editSpace &&
            Alert.alert(`Supprimer « ${editSpace.name} » ?`, '', [
              { text: 'Annuler', style: 'cancel' },
              {
                text: 'Supprimer',
                style: 'destructive',
                onPress: () => {
                  run(deleteArea(editSpace.area_id));
                  setEditSpace(null);
                },
              },
            ])
          }
        />
        <AddSheet
          visible={adding}
          devices={devices.filter(d => !d.inApp)}
          onClose={() => setAdding(false)}
          onAdd={d =>
            run(
              setInApp(d, true).then(
                () => current && !d.areaId && setArea(d, current),
              ),
            ).then(() => setAdding(false))
          }
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const GAP = 12;
const NONE = ''; // pseudo-espace des appareils sans pièce
const INFRA = '__infra__'; // onglet admin : état des briques serveur

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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTxt: { color: C.blue, fontSize: 24 },
  actions: { flexDirection: 'row', gap: 8 },
  login: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    padding: 32,
  },
  logo: { width: 120, height: 120, borderRadius: 28 },
  loginBtn: {
    backgroundColor: C.text,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  loginTxt: { color: C.card, fontSize: 17, fontWeight: '600' },
  error: {
    color: C.red,
    backgroundColor: C.card,
    padding: 12,
    borderRadius: 12,
  },
  camera: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 16,
    backgroundColor: '#000',
  },
  section: { color: C.text, fontSize: 20, fontWeight: '700', marginTop: 8 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusTxt: { color: C.text, fontSize: 15, flex: 1 },
  videoBox: { gap: 8 },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: -4,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.red },
  liveTxt: { color: C.muted, fontSize: 12, fontWeight: '600' },
  hint: { color: C.muted, fontSize: 15 },
  tabs: { gap: 8 },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: C.card,
  },
  tabOn: { backgroundColor: C.text },
  tabTxt: { color: C.text, fontSize: 15, fontWeight: '600' },
  tabTxtOn: { color: C.card },
  tabInput: { minWidth: 160, fontSize: 15, color: C.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
});

export default App;
