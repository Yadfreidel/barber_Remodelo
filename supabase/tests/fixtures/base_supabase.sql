-- Esquema base SOLO para pruebas: imita Supabase (roles, auth.uid, privilegios por defecto)
-- y las tablas existentes que usa la app (barberos, servicios, citas).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
create table auth.users (id uuid primary key, email text, encrypted_password text, email_confirmed_at timestamptz default now(),
    created_at timestamptz not null default now(), last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;

create table public.barberos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    activo boolean default true
);
create table public.servicios (
    id bigint generated always as identity primary key,
    nombre text not null,
    precio numeric,
    duracion_minutos int
);
create table public.citas (
    id bigint generated always as identity primary key,
    nombre_cliente text,
    telefono_cliente text,
    email text,
    barbero_id uuid references public.barberos (id),
    servicio_id bigint references public.servicios (id),
    fecha date not null,
    hora time not null,
    estado text not null default 'pendiente',
    creado_en timestamptz default now(),
    unique (barbero_id, fecha, hora)
);

-- RLS permisiva como la usa hoy la app con la anon key
alter table public.barberos enable row level security;
alter table public.servicios enable row level security;
alter table public.citas enable row level security;
create policy acceso_publico on public.barberos for all using (true) with check (true);
create policy acceso_publico on public.servicios for all using (true) with check (true);
create policy acceso_publico on public.citas for all using (true) with check (true);
