-- Update: films en reeksen van streamingdiensten op je kijklijst.
-- Plak dit in Supabase > SQL Editor en klik op Run. Je kan het gerust twee keer uitvoeren.
-- Een streamingtitel is een kijklijst-rij met soort 'streaming': zender = dienstcode (bv. nfx),
-- start = lanceerdag (unix-tijd, leeg als hij al te zien is), ref = JustWatch-id van de titel.
alter table public.kijklijst add column if not exists ref text;
alter table public.kijklijst drop constraint if exists kijklijst_soort_check;
alter table public.kijklijst add constraint kijklijst_soort_check check (soort in ('uitzending', 'reeks', 'streaming'));
