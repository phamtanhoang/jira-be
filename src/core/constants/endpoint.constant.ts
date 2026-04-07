export const ENDPOINTS = {
  AUTH: {
    BASE: 'auth',
    REGISTER: 'register',
    VERIFY_EMAIL: 'verify-email',
    LOGIN: 'login',
    REFRESH: 'refresh',
    LOGOUT: 'logout',
    ME: 'me',
  },
  SETTINGS: {
    BASE: 'settings',
    APP_INFO: 'app-info',
    BY_KEY: ':key',
  },
} as const;
