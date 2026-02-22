-- current_game_state
create table if not exists public.current_game_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  puzzle_num int not null,
  date date not null,
  row_index int not null default 0,
  board_state jsonb not null default '[]'::jsonb,
  evaluations jsonb not null default '[]'::jsonb,
  solution text,
  game_status text not null default 'IN_PROGRESS',
  hard_mode boolean not null default false,
  last_played_at timestamptz,
  last_completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  device_id text,
  schema_version int not null default 1,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists current_game_state_updated_idx on public.current_game_state (updated_at desc);

alter table public.current_game_state enable row level security;

drop policy if exists "current_game_state_select_own" on public.current_game_state;
drop policy if exists "current_game_state_insert_own" on public.current_game_state;
drop policy if exists "current_game_state_update_own" on public.current_game_state;
drop policy if exists "current_game_state_delete_own" on public.current_game_state;

create policy "current_game_state_select_own"
    on public.current_game_state
    for select
    using (auth.uid() = user_id);

create policy "current_game_state_insert_own"
    on public.current_game_state
    for insert
    with check (auth.uid() = user_id);

create policy "current_game_state_update_own"
    on public.current_game_state
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "current_game_state_delete_own"
    on public.current_game_state
    for delete
    using (auth.uid() = user_id);
