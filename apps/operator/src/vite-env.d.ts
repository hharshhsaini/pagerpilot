/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRUEFORGE_BASE_URL?: string;
  readonly VITE_PAGERPILOT_AGENT_NAME?: string;
  readonly VITE_PAGERPILOT_AGENT_ID?: string;
  readonly VITE_PAGERPILOT_INCIDENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
