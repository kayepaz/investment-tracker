import { describe, expect, it } from 'vitest';
import { APP_NAME, shouldRegisterServiceWorker } from './appInfo';

describe('appInfo', () => {
  it('has the app name', () => {
    expect(APP_NAME).toBe('Investment Tracker');
  });

  it('registers the service worker only in production with browser support', () => {
    expect(shouldRegisterServiceWorker(true, true)).toBe(true);
    expect(shouldRegisterServiceWorker(false, true)).toBe(false);
    expect(shouldRegisterServiceWorker(true, false)).toBe(false);
  });
});
