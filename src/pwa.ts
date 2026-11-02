import { shouldRegisterServiceWorker } from './appInfo';

/**
 * Registers the offline service worker in production builds.
 * In development the service worker is skipped so code changes show up immediately.
 */
export function registerServiceWorker(): void {
  if (!shouldRegisterServiceWorker(import.meta.env.PROD, 'serviceWorker' in navigator)) {
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error: unknown) => {
      console.error('Service worker registration failed', error);
    });
  });
}
