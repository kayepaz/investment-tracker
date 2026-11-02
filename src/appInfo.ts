export const APP_NAME = 'Investment Tracker';

/**
 * Whether the service worker should be registered.
 * Only in production builds, and only where the browser supports it.
 */
export function shouldRegisterServiceWorker(isProduction: boolean, hasServiceWorkerApi: boolean): boolean {
  return isProduction && hasServiceWorkerApi;
}
