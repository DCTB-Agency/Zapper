-- Update voor databases die al bestonden: kolom voor je streamingdiensten.
-- Plak dit in Supabase > SQL Editor en klik op Run. Je kan het gerust twee keer uitvoeren.
alter table public.profielen add column if not exists streaming text[] not null default '{}';
