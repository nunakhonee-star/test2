create extension if not exists pgcrypto;

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('panel','inverter','battery')),
  brand text not null,
  model text not null,
  power_kw numeric,
  panel_wp integer,
  capacity_kwh numeric,
  sell_price numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.equipment enable row level security;

drop policy if exists "anon read equipment" on public.equipment;
drop policy if exists "anon insert equipment" on public.equipment;

create policy "anon read equipment"
on public.equipment for select
to anon
using (true);

create policy "anon insert equipment"
on public.equipment for insert
to anon
with check (true);

insert into public.equipment(category,brand,model,panel_wp,sell_price)
select 'panel','Demo Solar','580W',580,3200
where not exists(select 1 from public.equipment where brand='Demo Solar' and model='580W');

insert into public.equipment(category,brand,model,power_kw,sell_price)
select 'inverter','Demo Inverter','10K',10,45000
where not exists(select 1 from public.equipment where brand='Demo Inverter' and model='10K');

insert into public.equipment(category,brand,model,capacity_kwh,sell_price)
select 'battery','Demo Battery','15kWh',15,99000
where not exists(select 1 from public.equipment where brand='Demo Battery' and model='15kWh');
