import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { DrawerItem } from '@/components/ui/DrawerItem';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { ScreenHeader } from '@/components/ui/ScreenHeader';

export default function PrimitivesShowcase() {
  const [filter, setFilter] = useState<'all' | 'active'>('all');
  const [text, setText] = useState('');

  return (
    <View className="flex-1 bg-surface-canvas">
      <ScreenHeader title="Primitives" rightAction={<Text className="text-meta text-zinc-500">v1</Text>} />
      <ScrollView contentContainerClassName="p-4 gap-4">
        <Section title="Typography">
          <Card>
            <Text className="text-display text-zinc-900">Display 28/700</Text>
            <Text className="text-heading text-zinc-900 mt-2">Heading 22/600</Text>
            <Text className="text-subhead text-zinc-900 mt-2">Subhead 18/600</Text>
            <Text className="text-body-strong text-zinc-900 mt-2">Body strong 16/500</Text>
            <Text className="text-body text-zinc-700 mt-2">Body 15/400 lorem ipsum dolor</Text>
            <Text className="text-meta text-zinc-500 mt-2">Meta 13/400</Text>
            <Text className="text-eyebrow text-zinc-500 mt-2">EYEBROW 11/600</Text>
          </Card>
        </Section>

        <Section title="Buttons">
          <Card>
            <View className="gap-3">
              <Button label="Primary" variant="primary" />
              <Button label="Secondary" variant="secondary" />
              <Button label="Ghost" variant="ghost" />
              <Button label="Destructive" variant="destructive" />
              <Button label="Disabled" disabled />
            </View>
          </Card>
        </Section>

        <Section title="Input">
          <Card>
            <Input placeholder="Type here..." value={text} onChangeText={setText} />
          </Card>
        </Section>

        <Section title="Badges & Chips">
          <Card>
            <View className="flex-row flex-wrap gap-2 mb-3">
              <Badge label="Accent" tone="accent" />
              <Badge label="Accent soft" tone="accent-soft" />
              <Badge label="Pill" tone="pill" />
              <Badge label="Neutral" tone="neutral" />
              <Badge label="Eyebrow" eyebrow />
            </View>
            <View className="flex-row flex-wrap gap-2">
              <Chip
                label="All"
                tone="neutral"
                selected={filter === 'all'}
                onPress={() => setFilter('all')}
              />
              <Chip
                label="Active"
                tone="accent"
                selected={filter === 'active'}
                onPress={() => setFilter('active')}
              />
            </View>
          </Card>
        </Section>

        <Section title="ListItem">
          <Card padded={false}>
            <ListItem title="Settings" subtitle="App preferences" leadingIcon="settings-outline" />
            <View className="h-px bg-surface-border" />
            <ListItem title="Profile" leadingIcon="person-outline" />
          </Card>
        </Section>

        <Section title="DrawerItem">
          <Card padded={false}>
            <DrawerItem icon="briefcase-outline" label="Workspace" trailingChip="14" />
            <DrawerItem icon="shield-outline" label="Admin" collapsible />
            <DrawerItem icon="settings-outline" label="Settings" active />
          </Card>
        </Section>

        <Section title="EmptyState">
          <Card padded={false}>
            <EmptyState
              illustration={<Ionicons name="folder-outline" size={48} color="#A1A1AA" />}
              heading="No matters yet"
              body="Create a matter to organize your legal work."
              primaryCta={{ label: 'New matter', onPress: () => {} }}
              secondaryCta={{ label: 'Learn more', onPress: () => {} }}
            />
          </Card>
        </Section>

      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text className="text-eyebrow text-zinc-500 mb-2">{title}</Text>
      {children}
    </View>
  );
}
