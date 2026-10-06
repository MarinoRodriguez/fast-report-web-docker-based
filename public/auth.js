/**
 * FastReport Web Editor - Authentication & Token Refresh Handler
 * -------------------------------------------------------------
 * Manages JWT Access and Refresh Tokens, session validation (/api/auth/check),
 * and automatic token refresh on 401 Unauthorized responses.
 */

const ACCESS_TOKEN_KEY = 'fastreport_access_token';
const REFRESH_TOKEN_KEY = 'fastreport_refresh_token';
const USER_DATA_KEY = 'fastreport_user_data';

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getCurrentUser() {
  const raw = localStorage.getItem(USER_DATA_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function setSession(accessToken, refreshToken, user) {
  if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  if (user) localStorage.setItem(USER_DATA_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_DATA_KEY);
  sessionStorage.removeItem('active_session_id');
}

export function redirectToAuth() {
  clearSession();
  if (!window.location.pathname.endsWith('auth.html')) {
    window.location.href = '/auth.html';
  }
}

let isRefreshing = false;
let refreshSubscribers = [];

function subscribeTokenRefresh(cb) {
  refreshSubscribers.push(cb);
}

function onRefreshed(newAccessToken) {
  refreshSubscribers.forEach((cb) => cb(newAccessToken));
  refreshSubscribers = [];
}

/**
 * Enhanced fetch wrapper:
 * Automatically includes Bearer token and attempts refresh token rotation on 401.
 */
export async function apiFetch(url, options = {}) {
  const token = getAccessToken();
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  // Also pass x-auth-token for backward compatibility
  const user = getCurrentUser();
  if (user?.username && !headers.has('x-auth-token')) {
    headers.set('x-auth-token', user.username);
  }

  const mergedOptions = { ...options, headers };
  const response = await fetch(url, mergedOptions);

  if (response.status === 401) {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      redirectToAuth();
      return response;
    }

    if (!isRefreshing) {
      isRefreshing = true;

      try {
        const refreshRes = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });

        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          setSession(refreshData.accessToken, refreshData.refreshToken, refreshData.user);
          isRefreshing = false;
          onRefreshed(refreshData.accessToken);

          // Retry initial request with new token
          headers.set('Authorization', `Bearer ${refreshData.accessToken}`);
          return fetch(url, { ...options, headers });
        } else {
          isRefreshing = false;
          redirectToAuth();
          return response;
        }
      } catch (err) {
        isRefreshing = false;
        redirectToAuth();
        return response;
      }
    } else {
      // Queue requests while token is refreshing
      return new Promise((resolve) => {
        subscribeTokenRefresh(async (newToken) => {
          headers.set('Authorization', `Bearer ${newToken}`);
          resolve(fetch(url, { ...options, headers }));
        });
      });
    }
  }

  return response;
}

/**
 * Validates session on startup.
 */
export async function ensureAuthenticated() {
  const token = getAccessToken();
  if (!token) {
    redirectToAuth();
    return null;
  }

  try {
    const res = await apiFetch('/api/auth/check');
    if (!res.ok) {
      redirectToAuth();
      return null;
    }
    const data = await res.json();
    return data.user;
  } catch (_) {
    redirectToAuth();
    return null;
  }
}
