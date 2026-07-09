import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { Button, Card } from '../../components';
import { CustomAlert, hideAlert } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';
import { useBackupRestore } from './useBackupRestore';

export const BackupRestoreScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { busy, alertState, setAlertState, exportAll, importFromFile } = useBackupRestore();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Backup & Restore</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Back up</Text>
          <Text style={styles.sectionBody}>
            Save every project and all of its conversations to a single file, including each
            project's knowledge base. Keep the file somewhere safe so you can restore it later or
            move it to another device.
          </Text>
          <Button
            title="Export everything"
            onPress={exportAll}
            loading={busy === 'export'}
            disabled={busy !== null}
            icon={<Icon name="upload" size={16} color={colors.background} />}
          />
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Restore</Text>
          <Text style={styles.sectionBody}>
            Pick a backup file to bring your projects and conversations back. Restoring only adds
            what is missing. Projects and chats you already have are left as they are, so nothing is
            overwritten or deleted.
          </Text>
          <Button
            title="Restore from file"
            variant="outline"
            onPress={importFromFile}
            loading={busy === 'import'}
            disabled={busy !== null}
            icon={<Icon name="download" size={16} color={colors.primary} />}
          />
        </Card>

        <Text style={styles.hint}>
          You can also export a single project from its page, or a single chat from the chat menu.
        </Text>
      </ScrollView>

      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </SafeAreaView>
  );
};
