/**
 * ImageGenAdviceCard — GPU-path speed/quality guidance. Renders nothing off the mnn path
 * or at good settings; shows the right tips (raise steps / lower size / raise size) when
 * the live settings warrant it. Drives the REAL store + REAL advice rule.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/Feather', () => 'Icon');

import { ImageGenAdviceCard } from '../../../src/components/GenerationSettingsModal/ImageGenAdviceCard';
import { useAppStore } from '../../../src/stores';

const setup = (backend: string | undefined, imageSteps: number, imageWidth: number) => {
  useAppStore.setState({
    downloadedImageModels: backend
      ? ([{ id: 'img', name: 'M', modelPath: '/m', backend, downloadedAt: '', size: 1 }] as any)
      : ([] as any),
    activeImageModelId: backend ? 'img' : null,
    settings: { ...useAppStore.getState().settings, imageSteps, imageWidth, imageHeight: imageWidth },
  });
};

describe('ImageGenAdviceCard', () => {
  it('renders nothing on the NPU (qnn) path', () => {
    setup('qnn', 8, 512);
    const { queryByTestId } = render(<ImageGenAdviceCard />);
    expect(queryByTestId('image-gen-advice')).toBeNull();
  });

  it('renders nothing at the sweet spot (mnn, 22 steps, 256)', () => {
    setup('mnn', 22, 256);
    const { queryByTestId } = render(<ImageGenAdviceCard />);
    expect(queryByTestId('image-gen-advice')).toBeNull();
  });

  it('shows the raise-steps tip on the GPU path at low steps', () => {
    setup('mnn', 8, 256);
    const { getByTestId, queryByTestId } = render(<ImageGenAdviceCard />);
    expect(getByTestId('image-gen-advice')).toBeTruthy();
    expect(getByTestId('image-gen-advice-steps')).toBeTruthy();
    expect(queryByTestId('image-gen-advice-size')).toBeNull();
  });

  it('shows the lower-size tip when too large (512)', () => {
    setup('mnn', 22, 512);
    const { getByTestId } = render(<ImageGenAdviceCard />);
    expect(getByTestId('image-gen-advice-size')).toBeTruthy();
  });

  it('shows the raise-size (garbage) tip when below 256 (the 128 case)', () => {
    setup('mnn', 22, 128);
    const { getByTestId, queryByTestId } = render(<ImageGenAdviceCard />);
    expect(getByTestId('image-gen-advice-raise-size')).toBeTruthy();
    expect(queryByTestId('image-gen-advice-size')).toBeNull();
  });
});
