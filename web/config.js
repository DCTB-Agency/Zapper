// Publieke instellingen van de app. Deze waarden mogen in de browser staan:
// de anon-sleutel geeft alleen toegang binnen de Row Level Security-regels.
// Laat SUPABASE_URL leeg om de app in demo-modus te draaien (alles lokaal in de browser).
window.TVGIDS_CONFIG = {
  SUPABASE_URL: "https://wevtsetlcfbphixczmra.supabase.co",
  // Supabase > Project Settings > API Keys > Legacy API keys > anon public
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldnRzZXRsY2ZicGhpeGN6bXJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MjkwMTcsImV4cCI6MjEwODAwNTAxN30.4F1VeXs_XsLSIywpCGgS1LeyQwW_Te1GZ_0tUQQTHb8",
  // uitvoer van: python3 maak_vapid.py
  VAPID_PUBLIC_KEY: "BEtTfj6jYKdMcnBCcEMk-0T1fVPuuWobbK02r4wB7TUqCBcBdCKd9hZ9ku-c9d2GclL7WLJWbchg6Edhmx2Shvw"
};
