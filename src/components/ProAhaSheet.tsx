import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from './AppSheet';
import { useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';

interface ProAhaSheetProps {
  visible: boolean;
  onClose: () => void;
  onRegister: () => void;
}

export const ProAhaSheet: React.FC<ProAhaSheetProps> = ({ visible, onClose, onRegister }) => {
  const styles = useThemedStyles(createStyles);

  const handleCta = () => {
    onClose();
    onRegister();
  };

  return (
    <AppSheet visible={visible} onClose={onClose} enableDynamicSizing title="Off Grid PRO">
      <View style={styles.content}>
        <Text style={styles.headline}>Loving Off Grid?</Text>
        <Text style={styles.subheadline}>
          Help us build what's next - and get it free for life.
        </Text>

        <View style={styles.priceRow}>
          <Text style={styles.price}>$10 lifetime access</Text>
        </View>

        <View style={styles.featureList}>
          {[
            'Voice-native conversation',
            'Custom MCP servers',
            'Calendar and WhatsApp integration',
            'More, shipping monthly',
          ].map(feature => (
            <View key={feature} style={styles.featureRow}>
              <Icon name="check" size={14} color={styles.checkIcon.color} />
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.guarantee}>
          Ship in 12 weeks or full refund. No questions asked.
        </Text>

        <TouchableOpacity style={styles.ctaButton} onPress={handleCta}>
          <Text style={styles.ctaText}>I am in 🔥</Text>
        </TouchableOpacity>
      </View>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
    alignItems: 'center' as const,
  },
  headline: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    textAlign: 'center' as const,
    marginBottom: SPACING.sm,
  },
  subheadline: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    marginBottom: SPACING.md,
  },
  priceRow: {
    marginBottom: SPACING.lg,
  },
  price: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
    textAlign: 'center' as const,
  },
  featureList: {
    width: '100%' as const,
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  featureRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  checkIcon: {
    color: colors.primary,
  },
  featureText: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  guarantee: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    textAlign: 'center' as const,
    marginBottom: SPACING.lg,
  },
  ctaButton: {
    width: '100%' as const,
    paddingVertical: SPACING.md,
    backgroundColor: colors.primary,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.sm,
  },
  ctaText: {
    ...TYPOGRAPHY.body,
    color: colors.background,
  },
});
