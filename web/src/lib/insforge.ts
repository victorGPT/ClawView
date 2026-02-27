import { createClient } from '@insforge/sdk';

const baseUrl = import.meta.env.VITE_INSFORGE_BASE_URL;
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY;

export const hasInsforgeConfig = Boolean(baseUrl && anonKey);

export const insforge = hasInsforgeConfig
  ? createClient({
      baseUrl: baseUrl as string,
      anonKey: anonKey as string,
    })
  : null;
