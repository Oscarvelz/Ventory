create table if not exists subcategory_marks (
  user_id text not null,
  category text not null,
  subcategory text not null,
  photo text not null default '',
  primary key (user_id, category, subcategory)
);
