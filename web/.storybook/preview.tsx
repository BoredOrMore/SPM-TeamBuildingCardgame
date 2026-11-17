import type { Preview } from '@storybook/react-vite';
import 'remixicon/fonts/remixicon.css';
import '../client/src/styles.css';
import { PreviewProvider } from '../client/src/cards.js';
import { LANGS, setLang, type Lang } from '../client/src/i18n.js';

/** The screen sizes CARD_SPEC.md says every card change must be checked at. */
const SPEC_VIEWPORTS = {
  phone: { name: 'Phone 390 × 844', styles: { width: '390px', height: '844px' }, type: 'mobile' },
  laptop: { name: 'Small laptop 1024 × 640', styles: { width: '1024px', height: '640px' }, type: 'desktop' },
  desktop: { name: 'Desktop 1280 × 800', styles: { width: '1280px', height: '800px' }, type: 'desktop' },
} as const;

const preview: Preview = {
  parameters: {
    layout: 'padded',
    viewport: { options: SPEC_VIEWPORTS },
  },
  globalTypes: {
    lang: {
      description: 'Card text language',
      toolbar: { title: 'Language', icon: 'globe', items: [...LANGS], dynamicTitle: true },
    },
  },
  initialGlobals: { lang: 'en', viewport: { value: 'phone', isRotated: false } },
  decorators: [
    // the hover tooltip and touch preview need the provider the game wraps every screen in; the key redraws cards when the language changes
    (Story, { globals }) => {
      setLang(globals.lang as Lang);
      return (
        <PreviewProvider>
          <div key={globals.lang as string}>
            <Story />
          </div>
        </PreviewProvider>
      );
    },
  ],
};

export default preview;
