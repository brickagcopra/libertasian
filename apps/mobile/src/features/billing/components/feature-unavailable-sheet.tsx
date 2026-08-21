import { Modal, Text, View } from 'react-native';

import { Button } from '../../../components/ui/Button';
import { useTheme } from '../../../providers/theme-provider';

export interface FeatureUnavailableSheetProps {
  visible: boolean;
  /**
   * One sentence naming the feature that is not included, e.g. "Saving
   * documents for offline reading is not included in your plan." Must name no
   * tier and no price — see the wording rules below.
   */
  message: string;
  onClose: () => void;
}

/**
 * The sheet shown in place of a create/save action when the subscription
 * query says the feature is not included. Proactive gate: no request fires
 * and nothing is written locally.
 *
 * Wording rules are the ones already documented on
 * `features/derivatives/renderers/gated-notice.tsx`, and they exist because
 * App Review rejected build 20 under Guideline 2.1(b) for naming a
 * purchasable tier. So this sheet:
 *
 * - states that the feature is not included, and nothing more;
 * - names no plan or tier (naming what to buy is an offer to sell);
 * - shows no price;
 * - has exactly one dismiss button — no CTA, no `router.push`, no link.
 *
 * It deliberately takes no `planName` prop. Not accepting one is what stops a
 * future caller from quietly reintroducing "You're on the Free plan" here.
 */
export function FeatureUnavailableSheet({
  visible,
  message,
  onClose,
}: FeatureUnavailableSheetProps) {
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
          <Text
            accessibilityRole="header"
            style={{ fontFamily: theme.serif, fontSize: 24, letterSpacing: -0.5, color: theme.ink }}
          >
            Not included in your plan
          </Text>
          <Text style={{ marginTop: 6, fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
            {message}
          </Text>
          <View style={{ height: 18 }} />
          <Button label="OK" variant="primary" full onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
