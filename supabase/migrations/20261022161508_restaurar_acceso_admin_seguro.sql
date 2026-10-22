-- El historial y los cambios de estado requieren la sesión administrativa real.
-- Las reservas públicas y la gestión por token conservan sus contratos.
alter table public.citas enable row level security;
drop policy if exists acceso_publico on public.citas;
drop policy if exists web_lectura on public.citas;
drop policy if exists web_estado on public.citas;
drop policy if exists web_reserva on public.citas;
drop policy if exists admin_historial on public.citas;
drop policy if exists admin_estado on public.citas;
create policy web_reserva on public.citas for insert to anon, authenticated
    with check (estado = 'pendiente');
create policy admin_historial on public.citas for select to authenticated
    using ((select public.es_admin()));
create policy admin_estado on public.citas for update to authenticated
    using ((select public.es_admin())) with check ((select public.es_admin()));
revoke update, delete on public.citas from anon;
grant select, insert, update on public.citas to authenticated;
-- No se concede borrado: cancelar preserva el historial y activa las reglas existentes.
notify pgrst, 'reload schema';
