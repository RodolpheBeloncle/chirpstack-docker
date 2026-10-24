import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { HA_TOKEN, HA_URL, SENSORS, VALVE } from './src/config';

type State = { state: string; attributes: { unit_of_measurement?: string } };

// Home Assistant REST API : GET /api/states/<id>, POST /api/services/<domain>/<service>
async function ha(path: string, body?: object) {
  const res = await fetch(`${HA_URL}/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function App() {
  const [states, setStates] = useState<Record<string, State>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const ids = [...SENSORS.map(s => s.id), VALVE];
      const list: State[] = await Promise.all(ids.map(id => ha(`states/${id}`)));
      setStates(Object.fromEntries(ids.map((id, i) => [id, list[i]])));
      setError(null);
    } catch (e) {
      setError(`Home Assistant injoignable (${HA_URL}) : ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const toggleValve = async (on: boolean) => {
    try {
      await ha(`services/switch/turn_${on ? 'on' : 'off'}`, { entity_id: VALVE });
      refresh();
    } catch (e) {
      setError(`Commande vanne échouée : ${(e as Error).message}`);
    }
  };

  const valveOn = states[VALVE]?.state === 'on';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={s.root}>
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}>
          <Text style={s.title}>Jardin</Text>
          {error && <Text style={s.error}>{error}</Text>}

          <View style={[s.card, s.valve]}>
            <View>
              <Text style={s.valveLabel}>Vanne d'arrosage</Text>
              <Text style={s.muted}>{valveOn ? 'Ouverte' : 'Fermée'}</Text>
            </View>
            <Switch value={valveOn} onValueChange={toggleValve} />
          </View>

          {SENSORS.map(({ id, label }) => {
            const st = states[id];
            return (
              <View key={id} style={s.card}>
                <Text style={s.muted}>{label}</Text>
                {st ? (
                  <Text style={s.value}>
                    {st.state} {st.attributes.unit_of_measurement ?? ''}
                  </Text>
                ) : (
                  <ActivityIndicator />
                )}
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1a14' },
  content: { padding: 16, gap: 12 },
  title: { color: '#e8f5ec', fontSize: 32, fontWeight: '700', marginBottom: 8 },
  error: { color: '#ffb4a8', backgroundColor: '#3a1d19', padding: 12, borderRadius: 10 },
  card: { backgroundColor: '#1a2b21', borderRadius: 14, padding: 16 },
  valve: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  valveLabel: { color: '#e8f5ec', fontSize: 18, fontWeight: '600' },
  muted: { color: '#8fb39c', fontSize: 14 },
  value: { color: '#e8f5ec', fontSize: 28, fontWeight: '600', marginTop: 4 },
});

export default App;
