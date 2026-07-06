import { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { hardwareService } from '../../services/hardware';
import { useAppStore } from '../../stores';
import { RootStackParamList } from '../../navigation/types';
import { DownloadedModel, InferenceBackend } from '../../types';
import {
  AccelerationCapability,
  acceleratedBackendFor,
  acceleratedSearchQuery,
  shouldSuggestAcceleration,
} from '../../utils/acceleration';

const EMPTY_CAPABILITY: AccelerationCapability = { hasNpu: false, hasGpu: false };

export interface AccelerationTip {
  /** Show the chat nudge: local llama model on CPU + the device has an NPU/GPU. */
  visible: boolean;
  /** True when the device has an NPU (Qualcomm HTP) — labels the enable button. */
  hasNpu: boolean;
  /** Switch generation to the fastest backend (NPU, else GPU); marks settings pending. */
  enableAcceleration: () => void;
  /** Open the Models tab with the HF search prefilled to a Q4_0 build of this model. */
  getAcceleratedModel: () => void;
}

/**
 * Owns the "you can go faster on the GPU/NPU" chat tip. The View renders `visible` and
 * dispatches the two intents — it holds no capability probing, no settings mutation,
 * and no navigation logic. Capability comes from the single hardwareService source; the
 * show/hide + backend/target decisions are the pure helpers in utils/acceleration.
 */
export function useAccelerationTip(params: {
  activeModel: DownloadedModel | undefined;
  isRemote: boolean;
  inferenceBackend: string | undefined;
}): AccelerationTip {
  const { activeModel, isRemote, inferenceBackend } = params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [capability, setCapability] = useState<AccelerationCapability>(EMPTY_CAPABILITY);

  useEffect(() => {
    let alive = true;
    hardwareService.getAccelerationCapability().then(c => { if (alive) setCapability(c); }).catch(() => { });
    return () => { alive = false; };
  }, []);

  const visible = shouldSuggestAcceleration({
    engine: activeModel?.engine,
    isRemote,
    inferenceBackend: inferenceBackend as InferenceBackend | undefined,
    capability,
  });

  const enableAcceleration = useCallback(() => {
    useAppStore.getState().updateSettings({ inferenceBackend: acceleratedBackendFor(capability) });
  }, [capability]);

  const getAcceleratedModel = useCallback(() => {
    navigation.navigate('Main', {
      screen: 'ModelsTab',
      params: { initialTab: 'text', initialSearchQuery: acceleratedSearchQuery(activeModel?.id) },
    } as never);
  }, [navigation, activeModel?.id]);

  return { visible, hasNpu: capability.hasNpu, enableAcceleration, getAcceleratedModel };
}
