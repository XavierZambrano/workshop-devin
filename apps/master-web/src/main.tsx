import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ComponentType } from 'react';
import './index.css';

const root = createRoot(document.getElementById('root')!);
const mediaView = new URLSearchParams(location.search).get('view') === 'media';

function render(Component: ComponentType) {
  root.render(
    <StrictMode>
      <Component />
    </StrictMode>,
  );
}

if (mediaView) {
  void import('./media/MediaApp').then(({ default: MediaApp }) => render(MediaApp));
} else {
  void import('./App').then(({ default: App }) => render(App));
}
