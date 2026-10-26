-- Update: meerdere profielen per login (zoals bij Netflix).
-- Plak dit in Supabase > SQL Editor en klik op Run. Je kan het gerust twee keer uitvoeren.
-- Bestaande gegevens blijven staan: alles wat er al is, wordt profiel 0 (het hoofdprofiel).

-- Profielen: per login meerdere rijen, genummerd 0, 1, 2, ...
alter table public.profielen add column if not exists profiel smallint not null default 0;
alter table public.profielen drop constraint if exists profielen_pkey;
alter table public.profielen add primary key (user_id, profiel);

-- Kijklijst: per profiel.
alter table public.kijklijst add column if not exists profiel smallint not null default 0;
drop index if exists public.kijklijst_uniek;
create unique index if not exists kijklijst_uniek_profiel
  on public.kijklijst (user_id, profiel, soort, lower(titel), coalesce(zender, ''), coalesce(start, 0));

-- Toestellen: de meldingen van een toestel horen bij het profiel dat er actief is.
alter table public.push_abonnementen add column if not exists profiel smallint not null default 0;

-- Meldingenlog: één melding per profiel per dag.
alter table public.meldingen_log add column if not exists profiel smallint not null default 0;
alter table public.meldingen_log drop constraint if exists meldingen_log_pkey;
alter table public.meldingen_log add primary key (user_id, profiel, dag);

-- Toestel registreren, nu met het profiel erbij.
drop function if exists public.registreer_toestel(text, text, text, text);
create or replace function public.registreer_toestel(p_endpoint text, p_p256dh text, p_auth text, p_toestel text, p_profiel smallint default 0)
returns void language sql security definer set search_path = public as $$
  insert into push_abonnementen (user_id, endpoint, p256dh, auth, toestel, profiel)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_toestel, p_profiel)
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, toestel = excluded.toestel, profiel = excluded.profiel;
$$;
revoke all on function public.registreer_toestel(text, text, text, text, smallint) from public, anon;
grant execute on function public.registreer_toestel(text, text, text, text, smallint) to authenticated;
