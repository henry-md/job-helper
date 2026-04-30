declare const __DEBUG_UI__: boolean;
declare const __HIDE_TOP_LVL_AI_CHAT__: boolean;

interface ImportMetaEnv {
  readonly DEV?: boolean;
  readonly VITE_HIDE_TOP_LVL_AI_CHAT?: string;
  readonly VITE_JOB_HELPER_APP_BASE_URL?: string;
  readonly [key: string]: boolean | string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
