// Public client settings for the shared Supabase project "faro" (safe to publish: every ventory_ table is guarded by row-level security).
export const SUPABASE_URL = "https://bybldbmwxucdvhfqspnf.supabase.co";
export const SUPABASE_KEY = "sb_publishable_5He-O0ak3eJcniBfgBQnHA_yRKjyHi7";
export const APP_VERSION = "1.5.0";

// A local test server (localhost) runs on this device only, unless ?cloud=1 asks for the real project.
const LOCAL_TEST = typeof location !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !/[?&]cloud=1/.test(location.search);
export const CLOUD_READY = !LOCAL_TEST && SUPABASE_URL.startsWith("https://") && !SUPABASE_KEY.startsWith("__");
