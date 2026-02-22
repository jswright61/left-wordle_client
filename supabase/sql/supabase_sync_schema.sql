-- Left Wordle cloud sync schema
-- Apply in Supabase SQL editor after creating the project.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  preferences jsonb not null default '{}'::jsonb,
  legacy_stats jsonb not null default '{}'::jsonb,
  preferences_updated_at timestamptz,
  legacy_updated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);


create table if not exists public.games (
    user_id uuid not null references auth.users(id) on delete cascade,
    puzzle_num integer not null,
    date date not null,
    result smallint not null check (result between 1 and 7),
    answer text,
    mode text,
    starter text,
    completed_at timestamptz not null,
    updated_at timestamptz not null,
    device_id text,
    created_at timestamptz not null default timezone('utc', now()),
    primary key (user_id, puzzle_num)
);

create table if not exists public.current_game_state (
    user_id uuid primary key references auth.users(id) on delete cascade,
    puzzle_num integer not null,
    date date not null,
    row_index integer not null default 0,
    board_state jsonb not null default '[]'::jsonb,
    evaluations jsonb not null default '[]'::jsonb,
    solution text,
    game_status text not null default 'IN_PROGRESS',
    hard_mode boolean not null default false,
    last_played_at timestamptz,
    last_completed_at timestamptz,
    updated_at timestamptz not null default timezone('utc', now()),
    device_id text,
    schema_version integer not null default 1,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists games_user_updated_idx on public.games (user_id, updated_at desc);
create index if not exists current_game_state_updated_idx on public.current_game_state (updated_at desc);

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.current_game_state enable row level security;

drop policy if exists "profiles owner"      on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own"
    on public.profiles
    for select
    using ( (select auth.uid()) = user_id );

create policy "profiles_insert_own"
    on public.profiles
    for insert
    with check ( (select auth.uid()) = user_id );

create policy "profiles_update_own"
    on public.profiles
    for update
    using ( (select auth.uid()) = user_id )
    with check ( (select auth.uid()) = user_id );

drop policy if exists "games owner"      on public.games;
drop policy if exists "games_select_own" on public.games;
drop policy if exists "games_insert_own" on public.games;
drop policy if exists "games_update_own" on public.games;
drop policy if exists "games_delete_own" on public.games;

create policy "games_select_own"
    on public.games
    for select
    using ( (select auth.uid()) = user_id );

create policy "games_insert_own"
    on public.games
    for insert
    with check ( (select auth.uid()) = user_id );

create policy "games_update_own"
    on public.games
    for update
    using ( (select auth.uid()) = user_id )
    with check ( (select auth.uid()) = user_id );

create policy "games_delete_own"
    on public.games
    for delete
    using ( (select auth.uid()) = user_id );

drop policy if exists "current_game_state_select_own" on public.current_game_state;
drop policy if exists "current_game_state_insert_own" on public.current_game_state;
drop policy if exists "current_game_state_update_own" on public.current_game_state;
drop policy if exists "current_game_state_delete_own" on public.current_game_state;

create policy "current_game_state_select_own"
    on public.current_game_state
    for select
    using ( (select auth.uid()) = user_id );

create policy "current_game_state_insert_own"
    on public.current_game_state
    for insert
    with check ( (select auth.uid()) = user_id );

create policy "current_game_state_update_own"
    on public.current_game_state
    for update
    using ( (select auth.uid()) = user_id )
    with check ( (select auth.uid()) = user_id );

create policy "current_game_state_delete_own"
    on public.current_game_state
    for delete
    using ( (select auth.uid()) = user_id );
