/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_LAUNCH_YEAR: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
