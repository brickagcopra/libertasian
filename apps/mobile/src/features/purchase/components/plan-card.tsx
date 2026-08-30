import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useTheme } from '@/providers/theme-provider';

import type { PurchasePlanOption } from '../products';

export interface PlanCardProps {
  plan: PurchasePlanOption;
  selected: boolean;
  disabled?: boolean;
  onSelect: (productId: PurchasePlanOption['productId']) => void;
}

/**
 * One purchasable option.
 *
 * Renders the store's title, the store's duration and the store's localized
 * price, all three, always. Guideline 3.1.2(c): "Before asking a customer to
 * subscribe, you should clearly describe what the user will get for the price."
 *
 * NOTHING here is computed. There is no currency symbol in this file, no period
 * string, no number formatting and no fallback copy for a missing price — a
 * plan with no price is not rendered at all, because a card that showed a
 * blank where the price goes would be a subscription offered without its price.
 */
export const PlanCard = memo(function PlanCard({
  plan,
  selected,
  disabled = false,
  onSelect,
}: PlanCardProps) {
  const { theme } = useTheme();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      // The label reads the three required facts in one utterance, so a
      // VoiceOver user gets the same disclosure a sighted one does.
      accessibilityLabel={`${plan.title}, ${plan.duration}, ${plan.priceString}`}
      disabled={disabled}
      onPress={() => onSelect(plan.productId)}
      style={{
        borderRadius: theme.radius,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.accent : theme.line,
        backgroundColor: theme.surface,
        padding: 16,
        marginBottom: 12,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={{ fontFamily: theme.serif, fontSize: 20, color: theme.ink }}
          >
            {plan.title}
          </Text>
          <Text
            style={{
              fontFamily: theme.sans,
              fontSize: 14,
              color: theme.inkSoft,
              marginTop: 2,
            }}
          >
            {plan.duration}
          </Text>
          {plan.description ? (
            <Text
              style={{
                fontFamily: theme.sans,
                fontSize: 13,
                color: theme.inkFaint,
                marginTop: 8,
              }}
            >
              {plan.description}
            </Text>
          ) : null}
        </View>

        <Text
          style={{
            fontFamily: theme.sans,
            fontSize: 18,
            fontWeight: '600',
            color: theme.ink,
          }}
        >
          {plan.priceString}
        </Text>
      </View>
    </Pressable>
  );
});
