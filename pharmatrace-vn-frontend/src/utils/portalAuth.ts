export const getPortalKey = (path: string = typeof window !== 'undefined' ? window.location.pathname : '/'): 'warehouse' | 'admin' | 'customer' => {
  if (path.startsWith('/warehouse')) return 'warehouse';
  if (path.startsWith('/admin')) return 'admin';
  return 'customer';
};

export const getPortalStorageKeys = (portal: 'warehouse' | 'admin' | 'customer' = getPortalKey()) => {
  return {
    ACCESS_TOKEN: `pharma_${portal}_access_token`,
    REFRESH_TOKEN: `pharma_${portal}_refresh_token`,
    TOKEN_EXPIRY: `pharma_${portal}_token_expiry`,
    USER: `pharma_${portal}_user`,
  };
};

export const getPortalToken = (portal: 'warehouse' | 'admin' | 'customer' = getPortalKey()): string | null => {
  if (typeof window === 'undefined') return null;
  const keys = getPortalStorageKeys(portal);
  let token = localStorage.getItem(keys.ACCESS_TOKEN);
  if (!token && portal === 'customer') {
    token = localStorage.getItem('pharma_access_token') || localStorage.getItem('access_token');
  }
  return token;
};

export const getPortalUser = (portal: 'warehouse' | 'admin' | 'customer' = getPortalKey()): Record<string, unknown> | null => {
  if (typeof window === 'undefined') return null;
  const keys = getPortalStorageKeys(portal);
  const raw = localStorage.getItem(keys.USER);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {}
  }
  if (portal === 'customer') {
    const saved = localStorage.getItem('pharma-auth');
    if (saved) {
      try {
        const { state } = JSON.parse(saved);
        if (state?.user) return state.user;
      } catch {}
    }
  }
  return null;
};

export const setPortalAuth = (
  portal: 'warehouse' | 'admin' | 'customer',
  user: Record<string, unknown> | null,
  accessToken?: string | null,
  refreshToken?: string | null,
  expiresAt?: number | null,
) => {
  if (typeof window === 'undefined') return;
  const keys = getPortalStorageKeys(portal);
  if (accessToken) localStorage.setItem(keys.ACCESS_TOKEN, accessToken);
  if (refreshToken) localStorage.setItem(keys.REFRESH_TOKEN, refreshToken);
  if (expiresAt) localStorage.setItem(keys.TOKEN_EXPIRY, expiresAt.toString());
  if (user) localStorage.setItem(keys.USER, JSON.stringify(user));

  if (portal === 'customer') {
    if (accessToken) localStorage.setItem('pharma_access_token', accessToken);
    if (refreshToken) localStorage.setItem('pharma_refresh_token', refreshToken);
    if (expiresAt) localStorage.setItem('pharma_token_expiry', expiresAt.toString());
  }
};

export const clearPortalAuth = (portal: 'warehouse' | 'admin' | 'customer' = getPortalKey()) => {
  if (typeof window === 'undefined') return;
  const keys = getPortalStorageKeys(portal);
  localStorage.removeItem(keys.ACCESS_TOKEN);
  localStorage.removeItem(keys.REFRESH_TOKEN);
  localStorage.removeItem(keys.TOKEN_EXPIRY);
  localStorage.removeItem(keys.USER);

  if (portal === 'customer') {
    localStorage.removeItem('pharma_access_token');
    localStorage.removeItem('pharma_refresh_token');
    localStorage.removeItem('pharma_token_expiry');
    localStorage.removeItem('access_token');
  }
};
