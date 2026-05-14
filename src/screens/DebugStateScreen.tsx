import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { useAppStore } from '../stores/appStore';
import { shouldShowProAha } from '../utils/proPrompt';

const PRO_AHA_THRESHOLD = 3;
const PRO_AHA_REPEAT_START = 15;
const PRO_AHA_REPEAT_INTERVAL = 10;

function nextFireCount(current: number): number {
  if (current < PRO_AHA_THRESHOLD) return PRO_AHA_THRESHOLD;
  if (current < PRO_AHA_REPEAT_START) return PRO_AHA_REPEAT_START;
  const passed = current - PRO_AHA_REPEAT_START;
  return PRO_AHA_REPEAT_START + (Math.floor(passed / PRO_AHA_REPEAT_INTERVAL) + 1) * PRO_AHA_REPEAT_INTERVAL;
}

function nextShareFireCount(current: number): number {
  if (current < 2) return 2;
  return Math.ceil((current + 1) / 10) * 10;
}

export const DebugStateScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const textGenerationCount = useAppStore(s => s.textGenerationCount);
  const imageGenerationCount = useAppStore(s => s.imageGenerationCount);
  const hasRegisteredPro = useAppStore(s => s.hasRegisteredPro);
  const proAhaTriggeredBy = useAppStore(s => s.proAhaTriggeredBy);
  const hasEngagedSharePrompt = useAppStore(s => s.hasEngagedSharePrompt);

  const setHasRegisteredPro = useAppStore(s => s.setHasRegisteredPro);
  const setProAhaTriggeredBy = useAppStore(s => s.setProAhaTriggeredBy);

  const getPrediction = (): string => {
    if (hasRegisteredPro) return 'PRO sheet will never show - user registered. Share sheet unaffected.';
    if (proAhaTriggeredBy !== null) return `PRO sheet blocked this session (triggered by ${proAhaTriggeredBy}). Reopen the chat to reset.`;
    const nextText = textGenerationCount + 1;
    const nextImage = imageGenerationCount + 1;
    if (shouldShowProAha(nextText)) return `PRO sheet WILL show on next text generation (count ${nextText}).`;
    if (shouldShowProAha(nextImage)) return `PRO sheet WILL show on next image generation (count ${nextImage}).`;
    return `PRO sheet will not show yet. Next text fire at count ${nextFireCount(textGenerationCount)}.`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Debug State</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        <Text style={styles.sectionTitle}>Generation Counts</Text>
        <View style={styles.card}>
          <Row label="Text generations" value={String(textGenerationCount)} colors={colors} />
          <Row label="Image generations" value={String(imageGenerationCount)} colors={colors} />
          <Row label="Share prompt engaged" value={hasEngagedSharePrompt ? 'Yes' : 'No'} colors={colors} highlight={hasEngagedSharePrompt} />
        </View>

        <Text style={styles.sectionTitle}>Share Sheet</Text>
        <View style={styles.card}>
          <Row label="Fires at (text + image)" value="2, 10, 20, 30..." colors={colors} />
          <Row label="Next text fire" value={String(nextShareFireCount(textGenerationCount))} colors={colors} />
        </View>

        <Text style={styles.sectionTitle}>PRO Sheet</Text>
        <View style={styles.card}>
          <Row label="Registered PRO" value={hasRegisteredPro ? 'Yes - never shows again' : 'No'} colors={colors} highlight={hasRegisteredPro} />
          <Row label="Triggered this session" value={proAhaTriggeredBy ?? 'No - eligible'} colors={colors} highlight={proAhaTriggeredBy !== null} />
          <Row label="Fires at (text + image)" value="3, 15, 25, 35..." colors={colors} />
          <Row label="Next text fire" value={hasRegisteredPro ? 'Never' : String(nextFireCount(textGenerationCount))} colors={colors} />
          <Row label="Next image fire" value={hasRegisteredPro ? 'Never' : String(nextFireCount(imageGenerationCount))} colors={colors} />
          <Row label="Text hits PRO now?" value={shouldShowProAha(textGenerationCount) ? 'Yes' : 'No'} colors={colors} highlight={shouldShowProAha(textGenerationCount)} />
          <Row label="Image hits PRO now?" value={shouldShowProAha(imageGenerationCount) ? 'Yes' : 'No'} colors={colors} highlight={shouldShowProAha(imageGenerationCount)} />
        </View>

        <Text style={styles.sectionTitle}>Next Generation Will...</Text>
        <View style={styles.card}>
          <Text style={styles.prediction}>{getPrediction()}</Text>
        </View>

        <Text style={styles.sectionTitle}>Debug Actions</Text>
        <View style={styles.actionGroup}>
          <TouchableOpacity style={styles.actionButton} onPress={() => {
            setHasRegisteredPro(false);
            setProAhaTriggeredBy(null);
          }}>
            <Text style={styles.actionText}>Reset PRO state (keep counts)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => {
            setHasRegisteredPro(false);
            setProAhaTriggeredBy(null);
            useAppStore.setState({ textGenerationCount: 0, imageGenerationCount: 0 });
          }}>
            <Text style={styles.actionText}>Reset everything (PRO + counts)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => {
            useAppStore.setState({ textGenerationCount: PRO_AHA_THRESHOLD - 1 });
          }}>
            <Text style={styles.actionText}>Set text count to 2 (PRO fires on next text gen)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => {
            useAppStore.setState({ imageGenerationCount: PRO_AHA_THRESHOLD - 1 });
          }}>
            <Text style={styles.actionText}>Set image count to 2 (PRO fires on next image gen)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => {
            useAppStore.setState({ textGenerationCount: 1 });
          }}>
            <Text style={styles.actionText}>Set text count to 1 (share fires on next text gen)</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
};

const Row: React.FC<{ label: string; value: string; colors: ThemeColors; highlight?: boolean }> = ({ label, value, colors, highlight }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
    <Text style={{ ...(TYPOGRAPHY.bodySmall as object), color: colors.textSecondary, flex: 1 }}>{label}</Text>
    <Text style={{ ...(TYPOGRAPHY.bodySmall as object), color: highlight ? colors.primary : colors.text, flex: 1, textAlign: 'right' }}>{value}</Text>
  </View>
);

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: 60,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
  },
  backButton: { width: 36, padding: SPACING.xs },
  headerTitle: { ...TYPOGRAPHY.h2, color: colors.text },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  sectionTitle: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    ...shadows.small,
  },
  prediction: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    padding: SPACING.md,
    lineHeight: 20,
  },
  actionGroup: { gap: SPACING.sm },
  actionButton: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: SPACING.md,
    ...shadows.small,
  },
  actionText: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
});
