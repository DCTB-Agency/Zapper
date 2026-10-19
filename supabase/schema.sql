-- Telenet Avondgids: database-schema voor Supabase.
-- Plak dit in Supabase > SQL Editor en klik Run. Je kan het veilig opnieuw uitvoeren.

-- Eén profiel per gebruiker: favorieten, interesses en meldingsvoorkeuren.
create table if not exists public.profielen (
  user_id      uuid primary key references auth.users on delete cascade,
  naam         text,
  favorieten   text[]  not null default '{}',   -- zender-id's, bv. {vtmhd,eenhd}
  themas       text[]  not null default '{}',   -- id's uit web/themas.json
  trefwoorden  text[]  not null default '{}',   -- vrije zoekwoorden, bv. {thuis,"formule 1"}
  melding_aan  boolean not null default true,
  melding_uur  smallint not null default 17 check (melding_uur between 6 and 23),
  tips_in_melding boolean not null default true, -- ook tips op basis van interesses
  bijgewerkt   timestamptz not null default now()
);

-- Kijklijst: een specifieke uitzending (soort 'uitzending') of een hele reeks
-- volgen op titel (soort 'reeks'), zodat elke nieuwe uitzending meetelt.
create table if not exists public.kijklijst (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  soort      text not null check (soort in ('uitzending', 'reeks')),
  titel      text not null,
  zender     text,         -- bij een uitzending
  start      bigint,       -- unix-tijd, bij een uitzending
  einde      bigint,
  aangemaakt timestamptz not null default now()
);
create unique index if not exists kijklijst_uniek
  on public.kijklijst (user_id, soort, lower(titel), coalesce(zender, ''), coalesce(start, 0));

-- Web-push abonnementen: één per toestel.
create table if not exists public.push_abonnementen (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  toestel    text,
  aangemaakt timestamptz not null default now()
);

-- Welke dagelijkse melding al verstuurd is (alleen de server schrijft hierin).
create table if not exists public.meldingen_log (
  user_id uuid not null references auth.users on delete cascade,
  dag     date not null,
  primary key (user_id, dag)
);

-- Row Level Security: iedereen ziet en wijzigt alleen zijn eigen rijen.
alter table public.profielen          enable row level security;
alter table public.kijklijst          enable row level security;
alter table public.push_abonnementen  enable row level security;
alter table public.meldingen_log      enable row level security;

drop policy if exists "eigen profiel" on public.profielen;
create policy "eigen profiel" on public.profielen
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "eigen kijklijst" on public.kijklijst;
create policy "eigen kijklijst" on public.kijklijst
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "eigen toestellen" on public.push_abonnementen;
create policy "eigen toestellen" on public.push_abonnementen
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- meldingen_log: geen policy, dus alleen bereikbaar met de service-sleutel.

-- Een push-abonnement mag bij een nieuwe login van eigenaar wisselen
-- (zelfde toestel, andere gebruiker). Dat kan RLS niet, deze functie wel.
create or replace function public.registreer_toestel(p_endpoint text, p_p256dh text, p_auth text, p_toestel text)
returns void language sql security definer set search_path = public as $$
  insert into push_abonnementen (user_id, endpoint, p256dh, auth, toestel)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_toestel)
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, toestel = excluded.toestel;
$$;
revoke all on function public.registreer_toestel(text, text, text, text) from public, anon;
grant execute on function public.registreer_toestel(text, text, text, text) to authenticated;
