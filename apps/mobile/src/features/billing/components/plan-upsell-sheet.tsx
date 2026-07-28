import { Modal, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '../../../components/ui/Button';
import { useTheme } from '../../../providers/theme-provider';

export interface PlanUpsellSheetProps {
  visible: boolean;
  /** Display name of the plan the org is currently on (e.g. 'Free'). */
  planName: string;
  /**
   * Sentence describing what upgrading unlocks. Rendered after
   * "You're on the {planName} plan."
   */
  message: string;
  onClose: () => void;
}

/**
 * Proactive Edu+ paywall sheet. Shown in place of a create/save action when
 * the subscription query says the org is below the required tier, so no
 * request ever fires and nothing is written locally.
 *
 * Shared by the reader (bookmarks, annotations, save-offline) and the codal
 * list (save-offline) so all paywalled affordances read identically.
 */
export function PlanUpsellSheet({
  visible,
  planName,
  message,
  onClose,
}: PlanUpsellSheetProps) {
  const { theme } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: theme.bg,
            padding: 22,
            paddingBottom: 36,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
          }}
        >
          <Text style={{ fontFamily: theme.serif, fontSize: 24, letterSpacing: -0.5, color: theme.ink }}>
            Available on Edu plans and above
          </Text>
          <Text style={{ marginTop: 6, fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
            {`You're on the ${planName} plan. ${message}`}
          </Text>
          <View style={{ height: 18 }} />
          <Button
            label="See plans"
            variant="primary"
            full
            onPress={() => {
              onClose();
              router.push('/settings/plans');
            }}
          />
          <View style={{ height: 8 }} />
          <Pressable onPress={onClose} style={{ paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: theme.inkSoft }}>
              Not now
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
