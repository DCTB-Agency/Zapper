// Publieke instellingen van de app. Deze waarden mogen in de browser staan:
// de anon-sleutel geeft alleen toegang binnen de Row Level Security-regels.
// Laat SUPABASE_URL leeg om de app in demo-modus te draaien (alles lokaal in de browser).
window.TVGIDS_CONFIG = {
  SUPABASE_URL: "",        // bv. "https://abcdefgh.supabase.co"
  SUPABASE_ANON_KEY: "",   // Supabase > Project Settings > API > anon public
  VAPID_PUBLIC_KEY: ""     // uitvoer van: python3 maak_vapid.py
};
