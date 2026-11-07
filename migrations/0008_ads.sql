create table if not exists ads (
  id text primary key,
  user_id text not null,
  product text not null,
  spent_cents integer not null default 0,
  started_on text,
  ended_on text,
  worked text not null default 'running'
);
