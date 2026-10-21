-- =====================================================================
-- ESQUEMA BASE (para un proyecto de Supabase nuevo)
-- Tablas que ya usa la app: barberos, servicios y citas.
-- Si las tablas ya existen, no las modifica (create if not exists).
-- =====================================================================

create table if not exists public.barberos (
    id bigint generated always as identity primary key,
    nombre text not null,
    activo boolean not null default true,
    creado_en timestamptz not null default now()
);

create table if not exists public.servicios (
    id bigint generated always as identity primary key,
    nombre text not null,
    precio numeric(10, 2) not null default 0,
    duracion_minutos int not null default 60 check (duracion_minutos > 0),
    creado_en timestamptz not null default now()
);

create table if not exists public.citas (
    id bigint generated always as identity primary key,
    nombre_cliente text not null,
    telefono_cliente text not null,
    email text,
    barbero_id bigint not null references public.barberos (id),
    servicio_id bigint not null references public.servicios (id),
    fecha date not null,
    hora time not null,
    estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'cancelada')),
    creado_en timestamptz not null default now()
);

-- Anti double-booking: un barbero no puede tener dos citas activas a la misma hora
create unique index if not exists citas_barbero_id_fecha_hora_key
    on public.citas (barbero_id, fecha, hora) where estado <> 'cancelada';
create index if not exists citas_fecha_idx on public.citas (fecha);

-- Acceso que necesita hoy la web con la anon key (lectura, reserva y cambio de estado desde el panel)
alter table public.barberos enable row level security;
alter table public.servicios enable row level security;
alter table public.citas enable row level security;

drop policy if exists web_lectura on public.barberos;
create policy web_lectura on public.barberos for select to anon, authenticated using (true);
drop policy if exists web_alta on public.barberos;
create policy web_alta on public.barberos for insert to anon, authenticated with check (true);

drop policy if exists web_lectura on public.servicios;
create policy web_lectura on public.servicios for select to anon, authenticated using (true);
drop policy if exists web_alta on public.servicios;
create policy web_alta on public.servicios for insert to anon, authenticated with check (true);

drop policy if exists web_lectura on public.citas;
create policy web_lectura on public.citas for select to anon, authenticated using (true);
drop policy if exists web_reserva on public.citas;
create policy web_reserva on public.citas for insert to anon, authenticated with check (true);
drop policy if exists web_estado on public.citas;
create policy web_estado on public.citas for update to anon, authenticated using (true) with check (true);

grant select, insert on public.barberos, public.servicios to anon, authenticated;
grant select, insert, update on public.citas to anon, authenticated;

-- Datos iniciales: mismos barberos y catálogo que muestra la web
insert into public.barberos (nombre)
select v.nombre from (values ('Isaac Garcia'), ('Yadfreidel Victoria'), ('Acxel Rosario')) v (nombre)
where not exists (select 1 from public.barberos b where b.nombre = v.nombre);

insert into public.servicios (nombre, precio, duracion_minutos)
select v.nombre, v.precio, 60 from (values
    ('Corte Signature Master', 700), ('High / Mid / Low Skin Fade', 750), ('Blowout / Taper Fade Moderno', 700),
    ('Buzz Cut con Line Up', 550), ('Pompadour Clásico Ejecutivo', 800), ('Modern Mullet Texturizado', 750),
    ('French Crop con Textura', 700), ('Corte Clásico a Tijera', 850), ('Corte Elite & Diseño de Cejas', 850),
    ('Corte Kids (Menores de 12)', 500), ('Ritual de Barba Toalla Caliente', 500), ('Perfilado de Barba y Cerquillo', 350),
    ('Barba con Degradado (Beard Fade)', 450), ('Esculpido de Barba Larga', 550), ('Camuflaje de Barba Elite', 650),
    ('Hidratación Profunda de Barba', 400), ('Limpieza con Mascarilla Negra', 600), ('Facial Premium de Oro 24K', 900),
    ('Diseño de Perilla / Candado', 400), ('Alaciado de Barba Rebelde', 800), ('Combo Ejecutivo Real', 900),
    ('Combo Master Absoluto', 1100), ('Combo El Padrino VIP', 1600), ('Combo Oro Inmortal', 1950),
    ('Combo Urbano Black', 1350), ('Combo Herencia (Padre e Hijo)', 1100), ('Combo Fresh & Clean Business', 1200),
    ('Combo Groom / Novio & Celebridades', 2500)
) v (nombre, precio)
where not exists (select 1 from public.servicios s where s.nombre = v.nombre);
