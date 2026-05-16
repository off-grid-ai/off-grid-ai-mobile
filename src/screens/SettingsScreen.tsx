import React, { useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { AttachStep } from 'react-native-spotlight-tour';
import { useNavigation, CommonActions, CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Card } from '../components';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { MadeWithLove } from '../components/MadeWithLove';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';
import { useAppStore, useRemoteServerStore } from '../stores';
import { hardwareService } from '../services';
import { RootStackParamList, MainTabParamList } from '../navigation/types';
import { GITHUB_URL, SHARE_ON_X_URL } from '../utils/sharePrompt';
import packageJson from '../../package.json';

const FEEDBACK_EMAIL = 'support@offgridmobile.co';

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'SettingsTab'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const completeChecklistStep = useAppStore((s) => s.completeChecklistStep);
  const resetChecklist = useAppStore((s) => s.resetChecklist);
  const deviceInfo = useAppStore((s) => s.deviceInfo);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  useEffect(() => {
    completeChecklistStep('exploredSettings');

  }, []);

  const handleSendFeedback = async () => {
    const { downloadedModels, activeModelId } = useAppStore.getState();
    const { activeServerId } = useRemoteServerStore.getState();

    const [buildNumber, fsInfo] = await Promise.all([
      DeviceInfo.getBuildNumber(),
      RNFS.getFSInfo(),
    ]);

    const ramGB = hardwareService.getTotalMemoryGB().toFixed(1);
    const tier = hardwareService.getDeviceTier();
    const freeGB = (fsInfo.freeSpace / (1024 * 1024 * 1024)).toFixed(1);
    const activeModel = downloadedModels.find(m => m.id === activeModelId);
    const modelLine = activeModel ? activeModel.fileName : 'None';
    const remoteServer = activeServerId ? 'Yes' : 'No';
    const deviceLine = deviceInfo
      ? `Device: ${deviceInfo.deviceModel} (${deviceInfo.systemName} ${deviceInfo.systemVersion})`
      : 'Device: Unknown';

    const subject = encodeURIComponent(`[Feedback] Off Grid v${packageJson.version}`);
    const body = encodeURIComponent(
      `Hi,\n\n[Describe your feedback or issue here]\n\n` +
      `---\n` +
      `App: v${packageJson.version} (build ${buildNumber})\n` +
      `${deviceLine}\n` +
      `RAM: ${ramGB} GB · Tier: ${tier}\n` +
      `Model: ${modelLine}\n` +
      `Free storage: ${freeGB} GB\n` +
      `Remote server: ${remoteServer}`,
    );
    const url = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        'Could Not Open Mail',
        `Looks like there was an issue. You can reach out to us at ${FEEDBACK_EMAIL}`,
        [{ text: 'OK' }],
      );
    }
  };

  const handleResetOnboarding = () => {
    setOnboardingComplete(false);
    // Navigate to root stack and reset to Onboarding
    // getParent() reaches the RootStack from inside the Tab navigator
    navigation.getParent()?.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Onboarding' }],
      })
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>

        {/* Theme Selector */}
        <AnimatedEntry index={0} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.themeToggleRow}>
            <Text style={styles.themeToggleLabel}>Appearance</Text>
            <View style={styles.themeSelector}>
              {([
                { mode: 'system' as const, icon: 'monitor' },
                { mode: 'light' as const, icon: 'sun' },
                { mode: 'dark' as const, icon: 'moon' },
              ]).map(({ mode, icon }) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.themeSelectorOption,
                    themeMode === mode && styles.themeSelectorOptionActive,
                  ]}
                  onPress={() => setThemeMode(mode)}
                >
                  <Icon
                    name={icon}
                    size={16}
                    color={themeMode === mode ? colors.background : colors.textMuted}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </AnimatedEntry>

        {/* MEE Resource Saver */}
        <AnimatedEntry index={1} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.navSection}>
            <View style={styles.navItem}>
              <View style={styles.navItemIcon}>
                <Icon name="activity" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>RAM Health Monitor</Text>
                <Text style={styles.navItemDesc}>Show real-time memory usage overlay</Text>
              </View>
              <Switch
                value={settings.showHealthMonitor}
                onValueChange={(v) => updateSettings({ showHealthMonitor: v })}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>
            <View style={styles.navItem}>
              <View style={styles.navItemIcon}>
                <Icon name="cpu" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>MEE Auto-Optimize</Text>
                <Text style={styles.navItemDesc}>Auto-tune steps, cache, and background tasks per device</Text>
              </View>
              <Switch
                value={settings.meeAutoOptimize}
                onValueChange={(v) => updateSettings({ meeAutoOptimize: v })}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>
            <View style={[styles.navItem, styles.navItemLast]}>
              <View style={styles.navItemIcon}>
                <Icon name="battery-charging" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Resource Saver</Text>
                <Text style={styles.navItemDesc}>Disable reasoning &amp; tools to save ~30% battery/RAM</Text>
              </View>
              <Switch
                value={settings.meeResourceSaver}
                onValueChange={(v) => {
                  updateSettings({
                    meeResourceSaver: v,
                    thinkingEnabled: v ? false : true,
                    enabledTools: v ? [] : ['web_search', 'calculator', 'get_current_datetime', 'get_device_info', 'read_url', 'search_knowledge_base'],
                  });
                }}
                trackColor={{ false: colors.border, true: '#F59E0B' }}
              />
            </View>
          </View>
        </AnimatedEntry>

        {/* Navigation Items */}
        <AttachStep index={5} fill>
          <View style={styles.navSection}>
            {[
              { icon: 'sliders', title: 'Model Settings', desc: 'System prompt, generation, and performance', screen: 'ModelSettings' as const },
              { icon: 'wifi', title: 'Remote Servers', desc: 'Connect to Ollama, LM Studio, and more', screen: 'RemoteServers' as const },
            //  { icon: 'search', title: 'Web Search', desc: 'Configure search API key for reliable results', screen: 'WebSearchSettings' as const },
              { icon: 'mic', title: 'Voice Transcription', desc: 'On-device speech to text', screen: 'VoiceSettings' as const },
              { icon: 'lock', title: 'Security', desc: 'Passphrase and app lock', screen: 'SecuritySettings' as const },
              { icon: 'smartphone', title: 'Device Information', desc: 'Hardware and compatibility', screen: 'DeviceInfo' as const },
              { icon: 'hard-drive', title: 'Storage', desc: 'Models and data usage', screen: 'StorageSettings' as const },
            ].map((item, index, arr) => (
              <AnimatedListItem
                key={item.screen}
                index={index + 1}
                staggerMs={40}
                trigger={focusTrigger}
                style={[styles.navItem, index === arr.length - 1 && styles.navItemLast]}
                onPress={() => navigation.navigate(item.screen)}
              >
                <View style={styles.navItemIcon}>
                  <Icon name={item.icon} size={16} color={colors.textSecondary} />
                </View>
                <View style={styles.navItemContent}>
                  <Text style={styles.navItemTitle}>{item.title}</Text>
                  <Text style={styles.navItemDesc}>{item.desc}</Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textMuted} />
              </AnimatedListItem>
            ))}
          </View>
        </AttachStep>

        {/* PRO */}
        <AnimatedEntry index={6} staggerMs={40} trigger={focusTrigger}>
          <TouchableOpacity
            style={styles.proCard}
            onPress={() => navigation.navigate('ProDetail')}
            activeOpacity={0.75}
          >
            <View style={styles.proCardContent}>
              <View style={styles.proIconContainer}>
                <Icon name="award" size={16} color={styles.proIcon.color} />
              </View>
              <View style={styles.proCardText}>
                <Text style={styles.proTitle}>Off Grid PRO</Text>
                <Text style={styles.proDesc}>Voice. MCPs. Calendar. WhatsApp.</Text>
                <Text style={styles.proCtaLink}>I am in 🔥</Text>
              </View>
              <Icon name="chevron-right" size={16} color={styles.proChevron.color} />
            </View>
          </TouchableOpacity>
        </AnimatedEntry>

        {/* Community */}
        <AnimatedEntry index={7} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.navSection}>
            <TouchableOpacity style={styles.navItem} onPress={() => Linking.openURL(GITHUB_URL)}>
              <View style={styles.navItemIcon}>
                <Icon name="star" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Star on GitHub</Text>
                <Text style={styles.navItemDesc}>Support the open-source project</Text>
              </View>
              <Icon name="external-link" size={14} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navItem} onPress={handleSendFeedback}>
              <View style={styles.navItemIcon}>
                <Icon name="mail" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Send Feedback</Text>
                <Text style={styles.navItemDesc}>Report a bug or share a suggestion</Text>
              </View>
              <Icon name="external-link" size={14} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.navItem, styles.navItemLast]} onPress={() => Linking.openURL(SHARE_ON_X_URL)}>
              <View style={styles.navItemIcon}>
                <Icon name="share-2" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Share on X</Text>
                <Text style={styles.navItemDesc}>Tell others about Off Grid</Text>
              </View>
              <Icon name="external-link" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </AnimatedEntry>

        {/* About */}
        <AnimatedEntry index={8} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.navSection}>
            <TouchableOpacity style={[styles.navItem, styles.navItemLast]} onPress={() => navigation.navigate('About')}>
              <View style={styles.navItemIcon}>
                <Icon name="info" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>About</Text>
                <Text style={styles.navItemDesc}>Version {packageJson.version}</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </AnimatedEntry>

        {/* Privacy */}
        <AnimatedEntry index={9} staggerMs={40} trigger={focusTrigger}>
          <Card style={styles.privacyCard}>
            <View style={styles.privacyIconContainer}>
              <Icon name="shield" size={18} color={colors.textSecondary} />
            </View>
            <Text style={styles.privacyTitle}>Privacy First</Text>
            <Text style={styles.privacyText}>
              All your data stays on this device. No conversations, prompts, or
              personal information is ever sent to any server.
            </Text>
          </Card>
        </AnimatedEntry>

        {/* Reset Onboarding */}
        <AnimatedEntry index={10} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.devButtonGroup}>
            <TouchableOpacity style={styles.devButton} onPress={handleResetOnboarding}>
              <Icon name="rotate-ccw" size={14} color={colors.textMuted} />
              <Text style={styles.devButtonText}>Reset Onboarding</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.devButton} onPress={resetChecklist}>
              <Icon name="list" size={14} color={colors.textMuted} />
              <Text style={styles.devButtonText}>Reset Onboarding Checklist</Text>
            </TouchableOpacity>
          </View>
        </AnimatedEntry>
        <MadeWithLove />
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, minHeight: 60,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface, ...shadows.small, zIndex: 1,
  },
  title: { ...TYPOGRAPHY.h2, color: colors.text },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  themeToggleRow: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const,
    backgroundColor: colors.surface, borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.lg, ...shadows.small,
  },
  themeToggleLabel: { ...TYPOGRAPHY.body, color: colors.text },
  themeSelector: { flexDirection: 'row' as const, backgroundColor: colors.surfaceLight, borderRadius: 8, padding: 3, gap: 2 },
  themeSelectorOption: { width: 34, height: 30, borderRadius: 6, alignItems: 'center' as const, justifyContent: 'center' as const },
  themeSelectorOptionActive: { backgroundColor: colors.primary },
  navSection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginBottom: SPACING.lg,
    overflow: 'hidden' as const,
    ...shadows.small,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navItemLast: { borderBottomWidth: 0 },
  navItemIcon: {
    width: 28, height: 28, borderRadius: 6, backgroundColor: 'transparent',
    alignItems: 'center' as const, justifyContent: 'center' as const, marginRight: SPACING.md,
  },
  navItemContent: { flex: 1 },
  navItemTitle: { ...TYPOGRAPHY.body, fontWeight: '400' as const, color: colors.text },
  navItemDesc: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: 2 },
  section: { marginBottom: SPACING.lg },
  aboutRow: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const,
    alignItems: 'center' as const, marginBottom: SPACING.sm,
  },
  aboutLabel: { ...TYPOGRAPHY.body, color: colors.textSecondary },
  aboutValue: { ...TYPOGRAPHY.body, fontWeight: '400' as const, color: colors.text },
  aboutText: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, lineHeight: 18 },
  privacyCard: { alignItems: 'center' as const, backgroundColor: colors.surface },
  privacyIconContainer: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'transparent',
    alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: SPACING.md,
  },
  privacyTitle: { ...TYPOGRAPHY.h3, color: colors.text, marginBottom: SPACING.sm },
  privacyText: { ...TYPOGRAPHY.body, color: colors.textSecondary, textAlign: 'center' as const, lineHeight: 20 },
  devButton: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: SPACING.sm, paddingVertical: SPACING.md, marginTop: SPACING.lg,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' as const, borderRadius: 6,
  },
  devButtonGroup: { gap: 12 },
  devButtonText: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
  proCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginBottom: SPACING.lg,
    overflow: 'hidden' as const,
    ...shadows.small,
  },
  proCardContent: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: SPACING.md,
    gap: SPACING.md,
  },
  proCardText: { flex: 1 },
  proTitle: { ...TYPOGRAPHY.body, color: colors.text },
  proDesc: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: 2 },
  proIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.sm,
  },
  proIcon: { color: colors.background },
  proChevron: { color: colors.textMuted },
  proCtaLink: { ...TYPOGRAPHY.bodySmall, color: colors.primary, marginTop: SPACING.xs },
});
