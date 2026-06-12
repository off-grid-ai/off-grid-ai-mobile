import type { ComponentType } from 'react';

export interface RegisteredScreen {
  name: string;
  component: ComponentType<any>;
}

const screens: RegisteredScreen[] = [];

export function registerScreen(screen: RegisteredScreen): void {
  screens.push(screen);
}

export function getRegisteredScreens(): RegisteredScreen[] {
  return screens;
}

export function _clearScreensForTesting(): void {
  screens.length = 0;
}
