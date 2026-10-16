-- Love Ocean v3: skema Supabase (aman dijalankan berulang).
-- Jalankan di Supabase > SQL Editor. Perlu: Authentication > Sign In / Providers > "Allow anonymous sign-ins" AKTIF.
--
-- PERHATIAN bila project Anda sudah memakai versi sebelumnya:
--  * Semua policy lama pada tabel bottles/replies/reports dihapus lalu diganti.
--  * Fungsi catch_bottle, sea_count, release_bottle, report_bottle, delete_my_data diganti.
--  * Kolom baru ditambahkan tanpa menghapus data lama.

------------------------------------------------------------------------------
-- Tabel
------------------------------------------------------------------------------
create table if not exists public.bottles (
  id         uuid primary key default gen_random_uuid(),
  author     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nickname   text not null default '',
  message    text not null,
  mood       text not null default 'cinta',
  caught_by  uuid references auth.users (id) on delete set null,
  caught_at  timestamptz,
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.bottles add column if not exists mood      text not null default 'cinta';
alter table public.bottles add column if not exists caught_at timestamptz;
alter table public.bottles add column if not exists hidden    boolean not null default false;

create table if not exists public.replies (
  id         uuid primary key default gen_random_uuid(),
  bottle_id  uuid not null references public.bottles (id) on delete cascade,
  author     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nickname   text not null default '',
  message    text not null,
  created_at timestamptz not null default now()
);
-- Fitur chat: pesan bisa diubah (edited_at) dan dihapus (deleted_at, isi dikosongkan).
alter table public.replies add column if not exists edited_at  timestamptz;
alter table public.replies add column if not exists deleted_at timestamptz;

create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  bottle_id  uuid not null references public.bottles (id) on delete cascade,
  reporter   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason     text not null default '',
  created_at timestamptz not null default now()
);
alter table public.reports add column if not exists reason text not null default '';
create unique index if not exists reports_once on public.reports (bottle_id, reporter);

-- Botol yang pernah dipegang seseorang tidak muncul lagi untuknya.
create table if not exists public.catch_log (
  user_id    uuid not null references auth.users (id) on delete cascade,
  bottle_id  uuid not null references public.bottles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, bottle_id)
);

-- Pencatat untuk batas penggunaan (tetap ada walau botol dihapus).
create table if not exists public.rate_log (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_log_idx on public.rate_log (user_id, kind, created_at desc);

-- Pengguna yang diblokir pengelola (isi lewat Table Editor).
create table if not exists public.banned_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists bottles_sea_idx    on public.bottles (created_at) where caught_by is null and not hidden;
create index if not exists bottles_author_idx on public.bottles (author, created_at desc);
create index if not exists bottles_caught_idx on public.bottles (caught_by);
create index if not exists replies_bottle_idx on public.replies (bottle_id, created_at);

-- Batasan isi (not valid = data lama tidak diperiksa ulang).
alter table public.bottles drop constraint if exists bottles_message_len;
alter table public.bottles add  constraint bottles_message_len check (char_length(message) between 1 and 280) not valid;
alter table public.bottles drop constraint if exists bottles_nick_len;
alter table public.bottles add  constraint bottles_nick_len    check (char_length(nickname) <= 30) not valid;
alter table public.bottles drop constraint if exists bottles_mood_ok;
alter table public.bottles add  constraint bottles_mood_ok     check (mood in ('cinta','rindu','semangat','syukur','curhat')) not valid;
alter table public.replies drop constraint if exists replies_message_len;
alter table public.replies add  constraint replies_message_len check (deleted_at is not null or char_length(message) between 1 and 280) not valid;
alter table public.replies drop constraint if exists replies_nick_len;
alter table public.replies add  constraint replies_nick_len    check (char_length(nickname) <= 30) not valid;

------------------------------------------------------------------------------
-- Penyaring isi: tautan, email, akun media sosial, nomor telepon
------------------------------------------------------------------------------
create or replace function public.lo_is_clean(t text) returns boolean
language sql immutable as $$
  select not (
       t ~* '(https?:|www\.|[a-z0-9-]+\.(com|net|org|id|co|io|me|xyz|link|app|info|site|online)\y)'
    or t ~* '[a-z0-9._%+-]+@[a-z0-9.-]+'
    or t ~* '(^|\s)@[a-z0-9_.]{3,}'
    or t ~* '\y(whatsapp|telegram|instagram|tiktok|facebook|snapchat|discord)\y'
    or t ~* '\y(wa|ig)\s*[:=@]'
    or t ~* 'line\s*id'
    or t ~* '\y(dot|titik)\s*(com|id|net)\y'
    or t ~  '(\d[ .\-()]{0,2}){9,}'
  );
$$;

------------------------------------------------------------------------------
-- Pemeriksaan saat menulis
------------------------------------------------------------------------------
create or replace function public.lo_rate(p_kind text, p_limit int, p_window interval, p_gap interval, p_err text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int; last_at timestamptz;
begin
  select count(*), max(created_at) into n, last_at
  from public.rate_log where user_id = me and kind = p_kind and created_at > now() - p_window;
  if last_at is not null and last_at > now() - p_gap then raise exception 'terlalu_cepat'; end if;
  if n >= p_limit then raise exception '%', p_err; end if;
  insert into public.rate_log (user_id, kind) values (me, p_kind);
end $$;

create or replace function public.bottles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or exists (select 1 from public.banned_users where user_id = me) then
    raise exception 'tidak_boleh';
  end if;
  new.author    := me;
  new.message   := btrim(new.message);
  new.nickname  := btrim(coalesce(new.nickname, ''));
  new.mood      := coalesce(nullif(new.mood, ''), 'cinta');
  new.caught_by := null;
  new.caught_at := null;
  new.hidden    := false;
  if not public.lo_is_clean(new.message) or not public.lo_is_clean(new.nickname) then
    raise exception 'tautan_dilarang';
  end if;
  perform public.lo_rate('throw', 10, interval '24 hours', interval '5 seconds', 'limit_botol');
  return new;
end $$;

drop trigger if exists bottles_guard_trg on public.bottles;
create trigger bottles_guard_trg before insert on public.bottles
  for each row execute function public.bottles_guard();

create or replace function public.replies_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); b public.bottles; n int;
begin
  if me is null or exists (select 1 from public.banned_users where user_id = me) then
    raise exception 'tidak_boleh';
  end if;
  select * into b from public.bottles where id = new.bottle_id;
  if not found or b.hidden or b.caught_by is null or me not in (b.author, b.caught_by) then
    raise exception 'tidak_boleh';
  end if;
  select count(*) into n from public.replies where bottle_id = new.bottle_id;
  if n >= 100 then raise exception 'percakapan_penuh'; end if;
  new.author     := me;
  new.message    := btrim(new.message);
  new.nickname   := btrim(coalesce(new.nickname, ''));
  new.edited_at  := null;
  new.deleted_at := null;
  if not public.lo_is_clean(new.message) or not public.lo_is_clean(new.nickname) then
    raise exception 'tautan_dilarang';
  end if;
  perform public.lo_rate('reply', 30, interval '1 hour', interval '2 seconds', 'limit_balasan');
  return new;
end $$;

drop trigger if exists replies_guard_trg on public.replies;
create trigger replies_guard_trg before insert on public.replies
  for each row execute function public.replies_guard();

------------------------------------------------------------------------------
-- Row Level Security
------------------------------------------------------------------------------
alter table public.bottles      enable row level security;
alter table public.replies      enable row level security;
alter table public.reports      enable row level security;
alter table public.catch_log    enable row level security;
alter table public.rate_log     enable row level security;
alter table public.banned_users enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('bottles','replies','reports','catch_log','rate_log','banned_users')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy bottles_select on public.bottles for select to authenticated
  using (author = auth.uid() or (caught_by = auth.uid() and not hidden));
create policy bottles_insert on public.bottles for insert to authenticated
  with check (author = auth.uid());
create policy bottles_delete on public.bottles for delete to authenticated
  using (author = auth.uid());

create policy replies_select on public.replies for select to authenticated
  using (exists (
    select 1 from public.bottles b
    where b.id = replies.bottle_id
      and (b.author = auth.uid() or (b.caught_by = auth.uid() and not b.hidden))
  ));
create policy replies_insert on public.replies for insert to authenticated
  with check (author = auth.uid());

-- reports, catch_log, rate_log, banned_users: tanpa policy = tertutup untuk klien.

revoke all on public.bottles, public.replies, public.reports, public.catch_log,
              public.rate_log, public.banned_users from anon, authenticated;
revoke all on sequence public.rate_log_id_seq from anon, authenticated;
grant select, insert, delete on public.bottles to authenticated;
grant select, insert         on public.replies to authenticated;

------------------------------------------------------------------------------
-- Fungsi untuk aplikasi
------------------------------------------------------------------------------
drop function if exists public.sea_count();
drop function if exists public.sea_view();
drop function if exists public.catch_bottle();
drop function if exists public.catch_bottle(text);
drop function if exists public.release_bottle(uuid);
drop function if exists public.report_bottle(uuid, text);
drop function if exists public.edit_reply(uuid, text);
drop function if exists public.delete_reply(uuid);
drop function if exists public.delete_my_data();

-- Jumlah botol yang mengapung + suasana beberapa botol (untuk digambar di laut). Tanpa isi pesan.
create function public.sea_view() returns json
language sql stable security definer set search_path = public as $$
  with floating as (
    select b.id, b.mood from public.bottles b
    where b.caught_by is null and not b.hidden
      and b.author <> auth.uid()
      and b.created_at > now() - interval '14 days'
      and not exists (select 1 from public.catch_log c where c.user_id = auth.uid() and c.bottle_id = b.id)
  )
  select json_build_object(
    'count', (select count(*) from floating),
    'moods', coalesce((select json_agg(mood) from (select mood from floating order by random() limit 6) m), '[]'::json)
  );
$$;

create function public.catch_bottle(p_mood text default null) returns setof public.bottles
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); b public.bottles; n int;
begin
  if me is null or exists (select 1 from public.banned_users where user_id = me) then
    raise exception 'tidak_boleh';
  end if;
  select count(*) into n from public.rate_log
    where user_id = me and kind = 'catch' and created_at > now() - interval '24 hours';
  if n >= 15 then raise exception 'limit_harian'; end if;

  -- Coba suasana yang dipilih dulu; jika kosong, ambil botol apa saja.
  for i in 1..2 loop
    select * into b from public.bottles x
    where x.caught_by is null and not x.hidden and x.author <> me
      and x.created_at > now() - interval '14 days'
      and (i = 2 or p_mood is null or x.mood = p_mood)
      and not exists (select 1 from public.catch_log c where c.user_id = me and c.bottle_id = x.id)
    order by random() limit 1
    for update skip locked;
    exit when b.id is not null or p_mood is null;
  end loop;

  if b.id is null then return; end if;   -- laut sepi: tidak memakai jatah harian
  update public.bottles set caught_by = me, caught_at = now() where id = b.id returning * into b;
  insert into public.catch_log (user_id, bottle_id) values (me, b.id) on conflict do nothing;
  insert into public.rate_log (user_id, kind) values (me, 'catch');
  return next b;
end $$;

create function public.release_bottle(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  perform 1 from public.bottles where id = p_id and caught_by = me for update;
  if not found then raise exception 'tidak_boleh'; end if;
  delete from public.replies where bottle_id = p_id;
  update public.bottles set caught_by = null, caught_at = null where id = p_id;
end $$;

create function public.report_bottle(p_id uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  perform 1 from public.bottles where id = p_id and me in (author, caught_by);
  if not found then raise exception 'tidak_boleh'; end if;
  insert into public.reports (bottle_id, reporter, reason)
    values (p_id, me, left(coalesce(p_reason, ''), 300)) on conflict do nothing;
  update public.bottles set hidden = true where id = p_id;
end $$;

-- Ubah pesan sendiri (hanya selama botol tidak disembunyikan).
create function public.edit_reply(p_id uuid, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); msg text := btrim(coalesce(p_message, ''));
begin
  if me is null or exists (select 1 from public.banned_users where user_id = me) then
    raise exception 'tidak_boleh';
  end if;
  perform 1 from public.replies rp join public.bottles b on b.id = rp.bottle_id
    where rp.id = p_id and rp.author = me and rp.deleted_at is null
      and not b.hidden and me in (b.author, b.caught_by)
    for update of rp;
  if not found then raise exception 'tidak_boleh'; end if;
  if char_length(msg) not between 1 and 280 then raise exception 'pesan_kosong'; end if;
  if not public.lo_is_clean(msg) then raise exception 'tautan_dilarang'; end if;
  perform public.lo_rate('edit', 30, interval '1 hour', interval '1 second', 'limit_balasan');
  update public.replies set message = msg, edited_at = now() where id = p_id;
end $$;

-- Hapus pesan sendiri: isi dikosongkan, barisnya tetap ada sebagai "pesan dihapus".
create function public.delete_reply(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'tidak_boleh'; end if;
  update public.replies set message = '', deleted_at = now()
    where id = p_id and author = me and deleted_at is null;
  if not found then raise exception 'tidak_boleh'; end if;
end $$;

create function public.delete_my_data() returns void
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'tidak_boleh'; end if;
  -- Botol orang lain yang sedang kamu pegang kembali ke laut tanpa percakapan.
  delete from public.replies where bottle_id in (select id from public.bottles where caught_by = me);
  update public.bottles set caught_by = null, caught_at = null where caught_by = me;
  delete from auth.users where id = me;   -- menghapus botol, balasan, dan catatan lain lewat cascade
end $$;

-- Dijadwalkan pengelola (Supabase > Integrations > Cron), mis. tiap hari.
create or replace function public.purge_expired() returns void
language sql security definer set search_path = public as $$
  delete from public.bottles where caught_by is null and not hidden and created_at < now() - interval '14 days';
  delete from public.bottles where caught_by is not null and not hidden and coalesce(caught_at, created_at) < now() - interval '30 days';
  delete from public.rate_log where created_at < now() - interval '2 days';
$$;

revoke all on function public.lo_rate(text, int, interval, interval, text) from public, anon, authenticated;
revoke all on function public.bottles_guard()  from public, anon, authenticated;
revoke all on function public.replies_guard()  from public, anon, authenticated;
revoke all on function public.purge_expired()  from public, anon, authenticated;
revoke all on function public.lo_is_clean(text) from public, anon, authenticated;

revoke all on function public.sea_view(), public.catch_bottle(text), public.release_bottle(uuid),
               public.report_bottle(uuid, text), public.delete_my_data() from public, anon;
grant execute on function public.sea_view(), public.catch_bottle(text), public.release_bottle(uuid),
               public.report_bottle(uuid, text), public.delete_my_data() to authenticated;

revoke all on function public.edit_reply(uuid, text), public.delete_reply(uuid) from public, anon;
grant execute on function public.edit_reply(uuid, text), public.delete_reply(uuid) to authenticated;

------------------------------------------------------------------------------
-- Laporan: diperiksa AI (Cloudflare Workers AI) dan halaman admin
------------------------------------------------------------------------------
alter table public.reports add column if not exists status          text not null default 'baru';
alter table public.reports add column if not exists ai_status       text;
alter table public.reports add column if not exists ai_category     text;
alter table public.reports add column if not exists ai_confidence   int;
alter table public.reports add column if not exists ai_reason       text;
alter table public.reports add column if not exists ai_at           timestamptz;
alter table public.reports add column if not exists resolved_at     timestamptz;
alter table public.reports add column if not exists resolved_action text;
alter table public.reports drop constraint if exists reports_status_ok;
alter table public.reports add  constraint reports_status_ok check (status in ('baru','selesai'));
alter table public.reports drop constraint if exists reports_ai_status_ok;
alter table public.reports add  constraint reports_ai_status_ok
  check (ai_status is null or ai_status in ('memeriksa','sah','tidak_sah','ragu','gagal'));
create index if not exists reports_open_idx on public.reports (created_at desc) where status = 'baru';

-- Daftar admin. Tertutup untuk klien; diisi manual (lihat catatan di akhir berkas).
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

drop function if exists public.ai_apply(uuid, text, text, text, int);
drop function if exists public.admin_reports(text);
drop function if exists public.admin_resolve(uuid, text);
drop function if exists public.admin_recheck(uuid);

-- Hanya dipanggil oleh Cloudflare Function memakai kunci service_role.
-- Aturan keselamatan: AI hanya boleh memulihkan botol bila yakin >= 80 DAN kategorinya 'tidak_ada'.
-- Selain itu hasilnya menjadi 'ragu' dan tetap masuk antrean admin.
create function public.ai_apply(p_report uuid, p_verdict text, p_category text, p_reason text, p_confidence int)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r public.reports;
  v text := p_verdict;
  c int  := greatest(0, least(100, coalesce(p_confidence, 0)));
begin
  if v not in ('sah','tidak_sah','ragu','gagal') then raise exception 'tidak_boleh'; end if;
  if v = 'tidak_sah' and (c < 80 or coalesce(p_category, '') <> 'tidak_ada') then v := 'ragu'; end if;

  update public.reports
     set ai_status = v, ai_category = left(coalesce(p_category, ''), 40), ai_confidence = c,
         ai_reason = left(coalesce(p_reason, ''), 500), ai_at = now()
   where id = p_report and ai_status = 'memeriksa'
   returning * into r;
  if not found then raise exception 'tidak_boleh'; end if;

  if v = 'tidak_sah' then
    update public.reports set status = 'selesai', resolved_at = now(), resolved_action = 'ai_pulihkan'
     where id = p_report;
    -- Botol baru dipulihkan bila tidak ada laporan lain yang masih terbuka.
    if not exists (select 1 from public.reports where bottle_id = r.bottle_id and id <> p_report and status = 'baru') then
      update public.bottles set hidden = false where id = r.bottle_id;
    end if;
  end if;
  return v;
end $$;

-- Daftar laporan untuk halaman admin. tab: 'tinjau' (perlu ditinjau), 'ai' (dipulihkan AI), 'selesai'.
create function public.admin_reports(p_tab text default 'tinjau') returns json
language plpgsql stable security definer set search_path = public as $$
declare cnt json; items json;
begin
  if not public.is_admin() then raise exception 'tidak_boleh'; end if;

  select json_build_object(
    'tinjau',  count(*) filter (where status = 'baru'),
    'ai',      count(*) filter (where resolved_action = 'ai_pulihkan'),
    'selesai', count(*) filter (where status = 'selesai' and coalesce(resolved_action, '') <> 'ai_pulihkan')
  ) into cnt from public.reports;

  select coalesce(json_agg(x order by x.created_at desc), '[]'::json) into items from (
    select r.id, r.created_at, r.status, r.ai_status, r.ai_category, r.ai_confidence, r.ai_reason,
           r.reason, r.resolved_action,
           b.message as bottle_message, b.nickname as bottle_nickname, b.created_at as bottle_at,
           b.hidden, (b.caught_by is not null) as caught,
           coalesce((
             select json_agg(json_build_object(
                      'role', case when rp.author = b.author then 'pembuat' else 'penemu' end,
                      'nickname', rp.nickname, 'message', rp.message, 'created_at', rp.created_at,
                      'deleted', rp.deleted_at is not null, 'edited', rp.edited_at is not null
                    ) order by rp.created_at)
               from public.replies rp where rp.bottle_id = b.id
           ), '[]'::json) as thread
      from public.reports r
      join public.bottles b on b.id = r.bottle_id
     where case p_tab
             when 'tinjau' then r.status = 'baru'
             when 'ai'     then r.resolved_action = 'ai_pulihkan'
             else r.status = 'selesai' and coalesce(r.resolved_action, '') <> 'ai_pulihkan'
           end
     order by r.created_at desc
     limit 50
  ) x;

  return json_build_object('counts', cnt, 'items', items);
end $$;

-- Tindakan admin. action: pulihkan, hapus, blokir_pembuat, blokir_penemu, tinjau_ulang.
create function public.admin_resolve(p_report uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reports; b public.bottles; target uuid;
begin
  if not public.is_admin() then raise exception 'tidak_boleh'; end if;
  select * into r from public.reports where id = p_report;
  if not found then raise exception 'tidak_boleh'; end if;
  select * into b from public.bottles where id = r.bottle_id;

  if p_action = 'pulihkan' then
    update public.reports set status = 'selesai', resolved_at = now(), resolved_action = 'pulihkan'
     where bottle_id = r.bottle_id and status = 'baru';
    update public.bottles set hidden = false where id = r.bottle_id;

  elsif p_action = 'hapus' then
    delete from public.bottles where id = r.bottle_id;   -- laporan dan balasan ikut terhapus (cascade)

  elsif p_action in ('blokir_pembuat', 'blokir_penemu') then
    target := case when p_action = 'blokir_pembuat' then b.author else b.caught_by end;
    if target is null then raise exception 'tidak_boleh'; end if;
    insert into public.banned_users (user_id, note) values (target, 'Laporan ' || p_report::text)
      on conflict do nothing;
    update public.reports set status = 'selesai', resolved_at = now(), resolved_action = p_action
     where bottle_id = r.bottle_id and status = 'baru';
    update public.bottles set hidden = true where id = r.bottle_id;

  elsif p_action = 'tinjau_ulang' then
    -- Membatalkan pemulihan otomatis AI: sembunyikan lagi dan kembalikan ke antrean.
    update public.bottles set hidden = true where id = r.bottle_id;
    update public.reports set status = 'baru', resolved_at = null, resolved_action = null, ai_status = 'ragu'
     where id = p_report;

  else
    raise exception 'tidak_boleh';
  end if;
end $$;

-- Mengulang pemeriksaan AI (laporan yang belum sempat diperiksa atau macet).
create function public.admin_recheck(p_report uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'tidak_boleh'; end if;
  update public.reports
     set ai_status = null, ai_category = null, ai_confidence = null, ai_reason = null, ai_at = null
   where id = p_report and status = 'baru';
  if not found then raise exception 'tidak_boleh'; end if;
end $$;

revoke all on function public.is_admin(), public.admin_reports(text), public.admin_resolve(uuid, text),
                       public.admin_recheck(uuid) from public, anon;
grant execute on function public.is_admin(), public.admin_reports(text), public.admin_resolve(uuid, text),
                          public.admin_recheck(uuid) to authenticated;

revoke all on function public.ai_apply(uuid, text, text, text, int) from public, anon, authenticated;
grant execute on function public.ai_apply(uuid, text, text, text, int) to service_role;

-- LANGKAH MANUAL (sekali saja): jadikan akunmu admin setelah kamu pernah masuk dengan email.
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'GANTI_DENGAN_EMAILMU';
