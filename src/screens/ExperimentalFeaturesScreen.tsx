import React from 'react';
import { ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { Card } from '../components';
import { useAppStore } from '../stores';
import { useTheme, useThemedStyles } from '../theme';
import { createStyles } from './ExperimentalFeaturesScreen.styles';

export const ExperimentalFeaturesScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const enabled = useAppStore(state => state.settings.experimentalMtp);
  const updateSettings = useAppStore(state => state.updateSettings);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          testID="back-button"
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Experimental Features</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          These features are still being tested. They may change or behave
          differently across models and devices.
        </Text>
        <Card style={styles.featureCard}>
          <View style={styles.featureRow}>
            <View style={styles.featureCopy}>
              <Text style={styles.featureTitle}>Multi-Token Prediction</Text>
              <Text style={styles.experimentalLabel}>EXPERIMENTAL</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={value =>
                updateSettings({ experimentalMtp: value })
              }
              trackColor={{ false: colors.surfaceLight, true: colors.primary }}
              thumbColor={colors.text}
              accessibilityLabel="Multi-Token Prediction"
              accessibilityState={{ checked: enabled }}
              testID="experimental-mtp-toggle"
            />
          </View>
          <Text style={styles.featureDescription}>
            Uses draft heads embedded in compatible GGUF models. May improve
            generation speed. Reload the model after changing this setting.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};
