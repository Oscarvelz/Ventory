create table if not exists pieces (
  id text primary key,
  user_id text not null,
  name text not null,
  category text not null default '',
  brand text not null default '',
  status text not null default 'available',
  qty integer not null default 1,
  size_system text not null default '',
  size_label text not null default '',
  us_size text not null default '',
  fit text not null default 'women',
  cost_cents integer not null default 0,
  ask_cents integer not null default 0,
  sale_cents integer,
  discount_cents integer not null default 0,
  source text not null default '',
  channel text not null default '',
  client_name text not null default '',
  received_on text,
  sold_on text,
  notes text not null default '',
  sort integer not null default 0
);

create index if not exists pieces_user_sort_idx on pieces (user_id, sort);

create table if not exists preferences (
  user_id text primary key,
  theme text not null default 'night'
);

create table if not exists checkpoints (
  id text primary key,
  user_id text not null,
  label text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
