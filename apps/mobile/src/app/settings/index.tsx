import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../providers/auth-provider';
import { useProfile } from '../../features/auth/hooks/use-auth';
import { APP_NAME } from '../../lib/constants';

import type { OrganizationRole } from '../../features/auth/types';

/** Organization roles that should see the Admin section. */
const ADMIN_ROLES: OrganizationRole[] = ['admin', 'editor', 'reviewer'];

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { data: profile, isLoading: profileLoading, isFetching, refetch } = useProfile();
  const displayUser = profile ?? user;

  function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => signOut(),
      },
    ]);
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !profileLoading}
          onRefresh={() => refetch()}
          colors={['#1a56db']}
        />
      }
    >
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profile</Text>
        <View style={styles.card}>
          {profileLoading ? (
            <ActivityIndicator color="#1a56db" style={styles.loader} />
          ) : displayUser ? (
            <>
              <View style={styles.avatarContainer}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {displayUser.fullName
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2)}
                  </Text>
                </View>
                <View style={styles.avatarInfo}>
                  <Text style={styles.userName}>{displayUser.fullName}</Text>
                  <Text style={styles.userEmail}>{displayUser.email}</Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Email Verified</Text>
                <Text
                  style={[
                    styles.detailValue,
                    displayUser.emailVerified
                      ? styles.statusVerified
                      : styles.statusUnverified,
                  ]}
                >
                  {displayUser.emailVerified ? 'Verified' : 'Not Verified'}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>MFA</Text>
                <Text
                  style={[
                    styles.detailValue,
                    displayUser.mfaEnabled
                      ? styles.statusVerified
                      : styles.statusNeutral,
                  ]}
                >
                  {displayUser.mfaEnabled ? 'Enabled' : 'Disabled'}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Member Since</Text>
                <Text style={styles.detailValue}>
                  {new Date(displayUser.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            </>
          ) : (
            <Text style={styles.emptyText}>Unable to load profile</Text>
          )}
        </View>
      </View>

      {/* Billing & Subscription section */}
      {displayUser ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Billing</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.adminRow}
              activeOpacity={0.7}
              onPress={() => router.push('/settings/subscription')}
            >
              <View style={styles.adminIconContainer}>
                <Ionicons name="card-outline" size={20} color="#1a56db" />
              </View>
              <View style={styles.adminInfo}>
                <Text style={styles.adminLabel}>Subscription</Text>
                <Text style={styles.adminSublabel}>
                  Manage your plan and billing details
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.adminRow}
              activeOpacity={0.7}
              onPress={() => router.push('/settings/plans')}
            >
              <View style={styles.adminIconContainer}>
                <Ionicons name="pricetags-outline" size={20} color="#1a56db" />
              </View>
              <View style={styles.adminInfo}>
                <Text style={styles.adminLabel}>Plans</Text>
                <Text style={styles.adminSublabel}>
                  View available plans and upgrade
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.adminRow}
              activeOpacity={0.7}
              onPress={() => router.push('/settings/usage')}
            >
              <View style={styles.adminIconContainer}>
                <Ionicons name="bar-chart-outline" size={20} color="#1a56db" />
              </View>
              <View style={styles.adminInfo}>
                <Text style={styles.adminLabel}>Usage & Quotas</Text>
                <Text style={styles.adminSublabel}>
                  Track your feature usage and limits
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Admin section — visible only for admin/editor/reviewer roles */}
      {displayUser?.organizationRole &&
        ADMIN_ROLES.includes(displayUser.organizationRole) ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Admin</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.adminRow}
              activeOpacity={0.7}
              onPress={() => router.push('/admin')}
            >
              <View style={styles.adminIconContainer}>
                <Ionicons name="shield-outline" size={20} color="#1a56db" />
              </View>
              <View style={styles.adminInfo}>
                <Text style={styles.adminLabel}>Admin Dashboard</Text>
                <Text style={styles.adminSublabel}>
                  Review queue, doctrines, and editorial management
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Developer section — API keys for Enterprise users */}
      {displayUser ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Developer</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.adminRow}
              activeOpacity={0.7}
              onPress={() => router.push('/settings/api-keys')}
            >
              <View style={styles.adminIconContainer}>
                <Ionicons name="key-outline" size={20} color="#1a56db" />
              </View>
              <View style={styles.adminInfo}>
                <Text style={styles.adminLabel}>API Keys</Text>
                <Text style={styles.adminSublabel}>
                  Manage API keys for integrations (Enterprise)
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>App</Text>
            <Text style={styles.detailValue}>{APP_NAME}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Version</Text>
            <Text style={styles.detailValue}>1.0.0</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 4,
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
  loader: { paddingVertical: 20 },
  avatarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  avatarInfo: { flex: 1 },
  userName: { fontSize: 17, fontWeight: '600', color: '#111827' },
  userEmail: { fontSize: 14, color: '#6b7280', marginTop: 2 },
  divider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  detailLabel: { fontSize: 14, color: '#6b7280' },
  detailValue: { fontSize: 14, color: '#111827', fontWeight: '500' },
  statusVerified: { color: '#059669' },
  statusUnverified: { color: '#dc2626' },
  statusNeutral: { color: '#6b7280' },
  emptyText: { fontSize: 14, color: '#9ca3af', textAlign: 'center', padding: 16 },
  adminRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  adminIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  adminInfo: {
    flex: 1,
  },
  adminLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  adminSublabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 1,
  },
  logoutButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  logoutText: { color: '#dc2626', fontSize: 16, fontWeight: '600' },
});
