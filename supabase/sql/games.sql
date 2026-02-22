-- games
create table games (
  user_id uuid not null references auth.users(id) on delete cascade,
  puzzle_num int not null,
  date date not null,
  result int not null check (result between 1 and 7),
  answer text,
  mode text,
  starter text,
  completed_at timestamptz not null,
  updated_at timestamptz not null,
  device_id text,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, puzzle_num)
);

create index if not exists games_user_updated_idx on public.games (user_id, updated_at desc);


-- Row Level Security
alter table games enable row level security;

drop policy if exists "games owner"      on public.games;
drop policy if exists "games_select_own" on public.games;
drop policy if exists "games_insert_own" on public.games;
drop policy if exists "games_update_own" on public.games;
drop policy if exists "games_delete_own" on public.games;

create policy "games_select_own"
    on public.games
    for select
    using (auth.uid() = user_id);

create policy "games_insert_own"
    on public.games
    for insert
    with check (auth.uid() = user_id);

create policy "games_update_own"
    on public.games
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "games_delete_own"
    on public.games
    for delete
    using (auth.uid() = user_id);
