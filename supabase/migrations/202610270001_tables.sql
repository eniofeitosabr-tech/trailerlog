-- Fase 1: preparar em banco de TESTES. Não aplicado automaticamente pelo app.
begin;
create table public.trucks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
    source_id text not null check (length(source_id) > 0),
    truck_number text not null check (length(trim(truck_number)) > 0),
    condition text,
    notes text,
    legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
    revision bigint not null default 1 check (revision > 0),
    created_at timestamptz not null default now(),
    unique (user_id, source_id), unique (user_id, id)
);
create table public.journeys (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
    source_id text not null check (length(source_id) > 0),
    truck_number text not null check (length(trim(truck_number)) > 0),
    started_at timestamptz not null,
    ended_at timestamptz,
    status text not null check (status in ('Em andamento', 'Finalizada')),
    legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
    revision bigint not null default 1 check (revision > 0),
    created_at timestamptz not null default now(),
    check (ended_at is null or ended_at >= started_at),
    check ((status = 'Em andamento' and ended_at is null) or (status = 'Finalizada' and ended_at is not null)),
    unique (user_id, source_id), unique (user_id, id)
);
create unique index journeys_one_active_per_user on public.journeys(user_id) where status = 'Em andamento';
create table public.trailer_uses (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
    source_id text not null check (length(source_id) > 0),
    journey_id uuid,
    trailer_number text not null check (length(trim(trailer_number)) > 0),
    truck_number text,
    used_at timestamptz,
    legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
    revision bigint not null default 1 check (revision > 0),
    created_at timestamptz not null default now(),
    unique (user_id, source_id),
    foreign key (user_id, journey_id) references public.journeys(user_id, id) on delete restrict
);
create table public.data_imports (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
    source_id text not null,
    checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
    status text not null default 'pending' check (status in ('pending', 'completed', 'conflict')),
    created_at timestamptz not null default now(),
    unique (user_id, source_id)
);
create index trailer_uses_user_journey on public.trailer_uses(user_id, journey_id);
-- Segurança ativada antes de qualquer acesso pela API. Políticas na próxima versão.
alter table public.trucks enable row level security;
alter table public.journeys enable row level security;
alter table public.trailer_uses enable row level security;
alter table public.data_imports enable row level security;
revoke all on public.trucks, public.journeys, public.trailer_uses, public.data_imports from anon, authenticated;
commit;
