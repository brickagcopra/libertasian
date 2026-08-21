import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { router, Stack, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

interface AdminCard {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: Href;
}

const ADMIN_CARDS: AdminCard[] = [
  {
    title: 'Doctrines',
    description: 'Manage extracted legal doctrines, review AI-generated entries, and approve or reject.',
    icon: 'library-outline',
    route: '/admin/doctrines',
  },
  {
    title: 'Review Queue',
    description: 'Review and moderate digests pending editorial approval.',
    icon: 'checkmark-circle-outline',
    route: '/admin/review',
  },
  {
    title: 'Derivatives',
    description: 'Monitor AI digest generation jobs, stats, and trigger new generations.',
    icon: 'flask-outline',
    route: '/admin/derivatives',
  },
  {
    title: 'Classification',
    description: 'Review low-confidence AI classifications and manually override subject tags.',
    icon: 'pricetags-outline',
    route: '/admin/classification',
  },
];

export default function AdminDashboardScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= 600;

  return (
    <>
      <Stack.Screen options={{ title: 'Admin Dashboard' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Admin Dashboard</Text>
          <Text style={styles.headerSubtitle}>
            Manage doctrines, review queue, and editorial content.
          </Text>
        </View>

        <View style={[styles.grid, isWide && styles.gridWide]}>
          {ADMIN_CARDS.map((card) => (
            <TouchableOpacity
              key={card.title}
              style={[styles.card, isWide && styles.cardWide]}
              activeOpacity={0.7}
              onPress={() => router.push(card.route)}
            >
              <View style={styles.cardIconContainer}>
                <Ionicons name={card.icon} size={28} color="#1a56db" />
              </View>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardDescription}>{card.description}</Text>
              <View style={styles.cardArrow}>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, paddingBottom: 40 },
  header: { marginBottom: 24 },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  grid: {
    gap: 12,
  },
  gridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardWide: {
    width: '48%',
  },
  cardIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  cardArrow: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
});
