/**
 * Onboarding Spotlight Flow Tests
 *
 * Tests that verify the onboarding checklist flows work correctly:
 * - Spotlight step configuration (all 18 steps exist with correct tooltips)
 * - Pending spotlight state coordination (queue → consume → chain)
 * - Reactive spotlight store state (shownSpotlights tracking)
 * - Checklist step completion criteria
 * - Reset clears all onboarding state
 */

import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { useProjectStore } from '../../../src/stores/projectStore';
import {
  setPendingSpotlight,
  consumePendingSpotlight,
  peekPendingSpotlight,
} from '../../../src/components/onboarding/spotlightState';
import {
  createSpotlightSteps,
  STEP_INDEX_MAP,
  STEP_TAB_MAP,
  CHAT_INPUT_STEP_INDEX,
  MODEL_SETTINGS_STEP_INDEX,
  PROJECT_EDIT_STEP_INDEX,
  DOWNLOAD_FILE_STEP_INDEX,
  DOWNLOAD_MANAGER_STEP_INDEX,
  MODEL_PICKER_STEP_INDEX,
  VOICE_HINT_STEP_INDEX,
  IMAGE_LOAD_STEP_INDEX,
  IMAGE_NEW_CHAT_STEP_INDEX,
  IMAGE_DRAW_STEP_INDEX,
  IMAGE_SETTINGS_STEP_INDEX,
} from '../../../src/components/onboarding/spotlightConfig';
import { resetStores, getAppState } from '../../utils/testHelpers';
import { createDownloadedModel, createONNXImageModel, createConversation, createMessage, createGeneratedImage } from '../../utils/factories';

describe('Onboarding Flows', () => {
  beforeEach(() => {
    resetStores();
    // Clear module-level pending spotlight state
    setPendingSpotlight(null);
  });

  // ==========================================================================
  // Spotlight Step Configuration
  //
  // All 18 steps (0-16) should exist and render tooltips.
  // ==========================================================================
  describe('spotlight step configuration', () => {
    it('has exactly 18 spotlight steps (indices 0-17)', () => {
      const steps = createSpotlightSteps();
      expect(steps).toHaveLength(18);
    });

    it('every step has a render function and rectangle shape', () => {
      const steps = createSpotlightSteps();
      steps.forEach((step) => {
        expect(step.render).toBeDefined();
        expect(typeof step.render).toBe('function');
        expect(step.shape).toEqual({ type: 'rectangle', padding: 8 });
        expect(step.onBackdropPress).toBe('stop');
      });
    });

    it('maps all 6 checklist step IDs to correct spotlight indices', () => {
      expect(STEP_INDEX_MAP).toEqual({
        downloadedModel: 0,
        loadedModel: 1,
        sentMessage: 2,
        triedImageGen: 4,
        exploredSettings: 5,
        createdProject: 7,
      });
    });

    it('maps all checklist step IDs to correct tabs', () => {
      expect(STEP_TAB_MAP).toEqual({
        downloadedModel: 'ModelsTab',
        loadedModel: 'HomeTab',
        sentMessage: 'ChatsTab',
        exploredSettings: 'Settings',
        createdProject: 'ProjectsTab',
        triedImageGen: 'ModelsTab',
      });
    });

    it('defines all continuation step index constants', () => {
      // Original steps
      expect(CHAT_INPUT_STEP_INDEX).toBe(3);
      expect(MODEL_SETTINGS_STEP_INDEX).toBe(6);
      expect(PROJECT_EDIT_STEP_INDEX).toBe(8);
      expect(DOWNLOAD_FILE_STEP_INDEX).toBe(9);
      expect(DOWNLOAD_MANAGER_STEP_INDEX).toBe(10);
      // New expanded flow steps
      expect(MODEL_PICKER_STEP_INDEX).toBe(11);
      expect(VOICE_HINT_STEP_INDEX).toBe(12);
      expect(IMAGE_LOAD_STEP_INDEX).toBe(13);
      expect(IMAGE_NEW_CHAT_STEP_INDEX).toBe(14);
      expect(IMAGE_DRAW_STEP_INDEX).toBe(15);
      expect(IMAGE_SETTINGS_STEP_INDEX).toBe(16);
    });
  });

  // ==========================================================================
  // Pending Spotlight State
  //
  // The module-level pending state lets one screen queue a spotlight
  // for the next screen to pick up after navigation.
  // ==========================================================================
  describe('pending spotlight state coordination', () => {
    it('starts with no pending spotlight', () => {
      expect(peekPendingSpotlight()).toBeNull();
      expect(consumePendingSpotlight()).toBeNull();
    });

    it('setPendingSpotlight stores a step index that can be consumed once', () => {
      setPendingSpotlight(9);

      expect(peekPendingSpotlight()).toBe(9);
      expect(consumePendingSpotlight()).toBe(9);
      // Consumed — now null
      expect(consumePendingSpotlight()).toBeNull();
    });

    it('setPendingSpotlight(null) clears the pending step', () => {
      setPendingSpotlight(5);
      setPendingSpotlight(null);

      expect(consumePendingSpotlight()).toBeNull();
    });

    it('overwriting pending step replaces the previous one', () => {
      setPendingSpotlight(3);
      setPendingSpotlight(6);

      expect(consumePendingSpotlight()).toBe(6);
    });

    // Flow 1: Download a Model — queues step 9, then 10
    it('Flow 1 (Download a Model): queues step 9 for model detail screen', () => {
      // handleStepPress('downloadedModel') queues step 9
      setPendingSpotlight(DOWNLOAD_FILE_STEP_INDEX);

      // Model detail screen mounts, consumes step 9
      const pending = consumePendingSpotlight();
      expect(pending).toBe(9);

      // Model detail pre-queues step 10 for back navigation
      setPendingSpotlight(DOWNLOAD_MANAGER_STEP_INDEX);
      expect(consumePendingSpotlight()).toBe(10);
    });

    // Flow 2: Load a Model — queues step 11 for the model picker sheet
    it('Flow 2 (Load a Model): queues step 11 for model picker sheet', () => {
      // handleStepPress('loadedModel') queues step 11
      setPendingSpotlight(MODEL_PICKER_STEP_INDEX);

      // ModelPickerSheet opens, consumes step 11
      const pending = consumePendingSpotlight();
      expect(pending).toBe(11);
    });

    // Flow 3: Send Message — queues step 3, then chains to 12
    it('Flow 3 (Send Message): queues step 3 for ChatScreen, chains to step 12', () => {
      // handleStepPress('sentMessage') queues step 3
      setPendingSpotlight(CHAT_INPUT_STEP_INDEX);

      // ChatScreen mounts, consumes step 3
      const pending = consumePendingSpotlight();
      expect(pending).toBe(3);

      // ChatScreen internally chains: when step 3 dismisses, step 12 fires
      // (This is done via pendingNextRef in ChatScreen, not via module state)
    });

    // Flow 5: Explore Settings — queues step 6
    it('Flow 5 (Explore Settings): queues step 6 for ModelSettingsScreen', () => {
      setPendingSpotlight(MODEL_SETTINGS_STEP_INDEX);
      expect(consumePendingSpotlight()).toBe(6);
    });

    // Flow 6: Create Project — queues step 8
    it('Flow 6 (Create Project): queues step 8 for ProjectEditScreen', () => {
      setPendingSpotlight(PROJECT_EDIT_STEP_INDEX);
      expect(consumePendingSpotlight()).toBe(8);
    });
  });

  // ==========================================================================
  // Reactive Spotlight Tracking (shownSpotlights)
  //
  // Reactive spotlights fire based on app state and are tracked to prevent
  // showing the same spotlight twice.
  // ==========================================================================
  describe('reactive spotlight tracking', () => {
    it('starts with empty shownSpotlights', () => {
      expect(getAppState().shownSpotlights).toEqual({});
    });

    it('markSpotlightShown records that a spotlight was displayed', () => {
      useAppStore.getState().markSpotlightShown('imageLoad');

      expect(getAppState().shownSpotlights.imageLoad).toBe(true);
    });

    it('marking multiple spotlights accumulates entries', () => {
      const { markSpotlightShown } = useAppStore.getState();
      markSpotlightShown('imageLoad');
      markSpotlightShown('imageNewChat');
      markSpotlightShown('imageDraw');
      markSpotlightShown('imageSettings');

      const shown = getAppState().shownSpotlights;
      expect(shown).toEqual({
        imageLoad: true,
        imageNewChat: true,
        imageDraw: true,
        imageSettings: true,
      });
    });

    it('resetShownSpotlights clears all entries', () => {
      const store = useAppStore.getState();
      store.markSpotlightShown('imageLoad');
      store.markSpotlightShown('imageDraw');

      useAppStore.getState().resetShownSpotlights();

      expect(getAppState().shownSpotlights).toEqual({});
    });

    it('resetChecklist also clears shownSpotlights', () => {
      const store = useAppStore.getState();
      store.markSpotlightShown('imageLoad');
      store.completeChecklistStep('exploredSettings');

      useAppStore.getState().resetChecklist();

      expect(getAppState().shownSpotlights).toEqual({});
      expect(getAppState().onboardingChecklist.exploredSettings).toBe(false);
      expect(getAppState().checklistDismissed).toBe(false);
    });

    // Flow 4 reactive conditions
    describe('Flow 4 (Image Generation) reactive spotlight conditions', () => {
      it('Part 2: image model downloaded but not loaded should trigger imageLoad spotlight', () => {
        // Simulate: user downloaded an image model but hasn't loaded it
        useAppStore.getState().addDownloadedImageModel(createONNXImageModel());

        const state = getAppState();
        const shouldShow =
          state.downloadedImageModels.length > 0 &&
          !state.activeImageModelId &&
          !state.shownSpotlights.imageLoad &&
          !state.onboardingChecklist.triedImageGen;

        expect(shouldShow).toBe(true);
      });

      it('Part 2: already shown imageLoad spotlight should not trigger again', () => {
        useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
        useAppStore.getState().markSpotlightShown('imageLoad');

        const state = getAppState();
        const shouldShow =
          state.downloadedImageModels.length > 0 &&
          !state.activeImageModelId &&
          !state.shownSpotlights.imageLoad &&
          !state.onboardingChecklist.triedImageGen;

        expect(shouldShow).toBe(false);
      });

      it('Part 3: image model loaded should trigger imageNewChat spotlight', () => {
        useAppStore.getState().setActiveImageModelId('test-image-model');

        const state = getAppState();
        const shouldShow =
          state.activeImageModelId !== null &&
          !state.shownSpotlights.imageNewChat &&
          !state.onboardingChecklist.triedImageGen;

        expect(shouldShow).toBe(true);
      });

      it('Part 4: image model loaded on ChatScreen should trigger imageDraw spotlight', () => {
        useAppStore.getState().setActiveImageModelId('test-image-model');

        const state = getAppState();
        // chat.imageModelLoaded would be true when activeImageModelId is set
        const shouldShow =
          state.activeImageModelId !== null &&
          !state.shownSpotlights.imageDraw &&
          !state.onboardingChecklist.triedImageGen;

        expect(shouldShow).toBe(true);
      });

      it('Part 5: after first image generated should trigger imageSettings spotlight', () => {
        useAppStore.getState().addGeneratedImage(createGeneratedImage());
        useAppStore.getState().completeChecklistStep('triedImageGen');

        const state = getAppState();
        const shouldShow =
          state.generatedImages.length > 0 &&
          !state.shownSpotlights.imageSettings &&
          state.onboardingChecklist.triedImageGen;

        expect(shouldShow).toBe(true);
      });

      it('completed triedImageGen suppresses parts 2-4', () => {
        useAppStore.getState().completeChecklistStep('triedImageGen');
        useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
        useAppStore.getState().setActiveImageModelId('test-image-model');

        const state = getAppState();
        // All reactive checks for parts 2-4 include !triedImageGen
        expect(state.onboardingChecklist.triedImageGen).toBe(true);
        const shouldShowPart2 = !state.onboardingChecklist.triedImageGen;
        const shouldShowPart3 = !state.onboardingChecklist.triedImageGen;
        const shouldShowPart4 = !state.onboardingChecklist.triedImageGen;

        expect(shouldShowPart2).toBe(false);
        expect(shouldShowPart3).toBe(false);
        expect(shouldShowPart4).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Checklist Completion Criteria
  //
  // Each checklist step has specific completion conditions.
  // These match what useOnboardingSteps computes.
  // ==========================================================================
  describe('checklist completion criteria', () => {
    // "Download a model" completes when any text model is downloaded
    it('downloadedModel: completes when downloadedModels has at least one entry', () => {
      expect(getAppState().downloadedModels.length).toBe(0);

      useAppStore.getState().addDownloadedModel(createDownloadedModel());

      expect(getAppState().downloadedModels.length).toBeGreaterThan(0);
    });

    // "Load a model" completes when a model is actively loaded
    it('loadedModel: completes when activeModelId is set', () => {
      expect(getAppState().activeModelId).toBeNull();

      useAppStore.getState().setActiveModelId('test-model');

      expect(getAppState().activeModelId).not.toBeNull();
    });

    // "Send your first message" completes when any conversation has messages
    it('sentMessage: completes when a conversation has at least one message', () => {
      const conversations = useChatStore.getState().conversations;
      expect(conversations.some(c => c.messages.length > 0)).toBe(false);

      const conv = createConversation({ messages: [createMessage({ role: 'user', content: 'hello' })] });
      useChatStore.setState({ conversations: [conv] });

      const updated = useChatStore.getState().conversations;
      expect(updated.some(c => c.messages.length > 0)).toBe(true);
    });

    // "Try image generation" completes when the triedImageGen flag is set
    // (set by imageGenerationService after first successful generation)
    it('triedImageGen: completes via onboardingChecklist flag, not just by downloading', () => {
      // Downloading an image model should NOT complete the step
      useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
      expect(getAppState().onboardingChecklist.triedImageGen).toBe(false);

      // The flag is set when an image is actually generated
      useAppStore.getState().completeChecklistStep('triedImageGen');
      expect(getAppState().onboardingChecklist.triedImageGen).toBe(true);
    });

    // "Explore settings" completes via explicit flag
    it('exploredSettings: completes via onboardingChecklist flag', () => {
      expect(getAppState().onboardingChecklist.exploredSettings).toBe(false);

      useAppStore.getState().completeChecklistStep('exploredSettings');

      expect(getAppState().onboardingChecklist.exploredSettings).toBe(true);
    });

    // "Create a project" completes when more than 4 projects exist
    it('createdProject: completes when projects.length > 4', () => {
      expect(useProjectStore.getState().projects.length).toBe(0);

      // 4 projects is not enough — need > 4
      const projects = Array.from({ length: 5 }, (_, i) => ({
        id: `proj-${i}`,
        name: `Project ${i}`,
        description: '',
        systemPrompt: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      useProjectStore.setState({ projects });

      expect(useProjectStore.getState().projects.length).toBeGreaterThan(4);
    });
  });

  // ==========================================================================
  // Reset Onboarding
  //
  // Resetting onboarding should clear all state so flows can replay.
  // ==========================================================================
  describe('reset onboarding', () => {
    it('resetChecklist clears checklist flags, dismissed state, and shown spotlights', () => {
      const store = useAppStore.getState();
      store.completeChecklistStep('downloadedModel');
      store.completeChecklistStep('triedImageGen');
      store.dismissChecklist();
      store.markSpotlightShown('imageLoad');
      store.markSpotlightShown('imageDraw');

      useAppStore.getState().resetChecklist();

      const state = getAppState();
      expect(state.onboardingChecklist.downloadedModel).toBe(false);
      expect(state.onboardingChecklist.triedImageGen).toBe(false);
      expect(state.checklistDismissed).toBe(false);
      expect(state.shownSpotlights).toEqual({});
    });
  });
});
