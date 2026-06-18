/**
 * Vite environment type declarations.
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_APP_SERVER: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
