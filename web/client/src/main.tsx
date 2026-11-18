import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'remixicon/fonts/remixicon.css';
import './styles.css';
import { App } from './App.js';

/** How long the first paint waits for the icon and title fonts, so icons never show as empty boxes and the title does not jump. */
const FONT_WAIT_MS = 1500;

// a slow network still gets the page after FONT_WAIT_MS, drawn in fallback fonts
void Promise.race([
  Promise.all([document.fonts.load('16px remixicon'), document.fonts.load('800 16px "Head Hunter Display"')]).catch(() => undefined),
  new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
]).then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
