const LAST_KNOWN_SIGNED_IN_KEY = 'ylabs:last-known-signed-in';

export const rememberSignedIn = (signedIn: boolean): void => {
  try {
    window.localStorage.setItem(LAST_KNOWN_SIGNED_IN_KEY, signedIn ? '1' : '0');
  } catch {
    return;
  }
};

export const wasSignedInLastVisit = (): boolean => {
  try {
    return window.localStorage.getItem(LAST_KNOWN_SIGNED_IN_KEY) === '1';
  } catch {
    return false;
  }
};
