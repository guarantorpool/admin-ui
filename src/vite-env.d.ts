/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_IDLE_LOCK_MINUTES?: string;
  readonly VITE_TIME_ZONE?: string;
  readonly VITE_APP_ENV?: string;
}
