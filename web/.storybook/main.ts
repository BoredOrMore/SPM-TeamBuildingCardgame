import type { StorybookConfig } from '@storybook/react-vite';

/** Storybook for checking card faces and sizes against CARD_SPEC.md without starting a game. */
const config: StorybookConfig = {
  stories: ['../client/src/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
  // card art lives in the client's public folder, as in the game
  staticDirs: ['../client/public'],
  core: { disableTelemetry: true },
};

export default config;
