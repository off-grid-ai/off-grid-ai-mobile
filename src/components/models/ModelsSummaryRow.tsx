import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import type { ModelRowType } from './ModelsManagerSheet';

type Props = {
  labels: Record<ModelRowType, string>;
  /** Count of downloaded models per type — shown under each caption so the card
   *  carries information at a glance (replaces the separate stats row). */
  counts?: Partial<Record<ModelRowType, number>>;
  isLoading: boolean;
  onPress: () => void;
};

const TYPE_ICONS: { type: ModelRowType; icon: string; caption: string }[] = [
  { type: 'text', icon: 'message-square', caption: 'Text' },
  { type: 'image', icon: 'image', caption: 'Image' },
  { type: 'voice', icon: 'volume-2', caption: 'Voice' },
  { type: 'speech', icon: 'mic', caption: 'Speech' },
];

/**
 * Collapsed Models control. A labelled strip with one captioned icon per model
 * type — emerald + bright caption when that type has an active model, dimmed +
 * muted when not. Tap → manager sheet.
 */
export const ModelsSummaryRow: React.FC<Props> = ({ labels, counts, isLoading, onPress }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <AnimatedPressable style={styles.container} hapticType="selection" testID="models-summary" onPress={onPress}>
      <View style={styles.header}>
        <Text style={styles.label}>Models</Text>
        {isLoading
          ? <ActivityIndicator size="small" color={colors.primary} />
          : <Icon name="chevron-down" size={14} color={colors.textMuted} />}
      </View>
      <View style={styles.icons}>
        {TYPE_ICONS.map(({ type, icon, caption }) => {
          const active = !!labels[type] && labels[type] !== '—';
          const count = counts?.[type];
          return (
            <View key={type} style={[styles.iconCol, !active && styles.inactive]}>
              <Icon name={icon} size={18} color={active ? colors.primary : colors.textMuted} />
              <View style={styles.captionRow}>
                <Text style={[styles.caption, active && styles.captionActive]}>{caption}</Text>
                {typeof count === 'number' && (
                  <Text style={[styles.count, count > 0 && styles.countActive]}>{count}</Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </AnimatedPressable>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
    marginTop: SPACING.md,
    marginBottom: SPACING.lg,
    ...shadows.small,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  label: { ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted },
  icons: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.sm,
  },
  iconCol: { alignItems: 'center' as const, gap: SPACING.xs },
  inactive: { opacity: 0.35 },
  captionRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  caption: { ...TYPOGRAPHY.metaSmall, color: colors.textMuted },
  captionActive: { color: colors.textSecondary },
  count: { ...TYPOGRAPHY.metaSmall, color: colors.textMuted },
  countActive: { color: colors.primary },
});
