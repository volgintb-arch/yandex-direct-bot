import WebApp from '@twa-dev/sdk';

/** Telegram WebApp helper bootstrap. Call once at app start. */
export function initTelegram(): void {
  try {
    WebApp.ready();
    WebApp.expand();
    WebApp.disableVerticalSwipes?.();
  } catch {
    // not in Telegram (e.g. dev preview) — fine
  }
}

export function getInitData(): string {
  try {
    return WebApp.initData ?? '';
  } catch {
    return '';
  }
}

export function getThemeParams() {
  try {
    return WebApp.themeParams;
  } catch {
    return {};
  }
}

export const isInTelegram = (): boolean => {
  try {
    return Boolean(WebApp.initData);
  } catch {
    return false;
  }
};
