-- =====================================================================
-- IDENTIDAD DEL NEGOCIO: COLORES, CORREO DE CONTACTO Y POLÍTICAS INFORMATIVAS
--
-- La configuración sigue guardándose en negocio_config.datos (jsonb, una sola fila: instalación
-- de un solo negocio). Esta migración solo amplía la validación del servidor al publicar:
--   - color_principal y color_acento: '' (valor por defecto del sitio) o '#rrggbb' con contraste
--     mínimo de 4.5:1 sobre el fondo oscuro de la web (#0b0b0c), que también es el color del texto
--     de los botones rellenos con ese color;
--   - correo: '' o una dirección de correo de hasta 120 caracteres;
--   - politica_reservas y politica_cancelacion: texto informativo de hasta 1200 caracteres.
--     Se muestran como texto plano; no crean reglas de cancelación, cobros ni penalizaciones.
-- Solo administradores (_exigir_panel(true)). ADITIVA: no borra columnas, tablas ni datos.
-- =====================================================================

-- Luminancia relativa WCAG de un color '#rrggbb' (null si el formato no es válido)
create or replace function public._luminancia(p_color text) returns numeric
language plpgsql immutable set search_path = public, pg_temp as $$
declare
    v_canal numeric;
    v_lum numeric := 0;
    v_pesos numeric[] := array[0.2126, 0.7152, 0.0722];
    i int;
begin
    if p_color is null or p_color !~ '^#[0-9a-fA-F]{6}$' then
        return null;
    end if;
    for i in 1..3 loop
        v_canal := ('x' || lpad(substr(p_color, 2 * i, 2), 8, '0'))::bit(32)::int / 255.0;
        v_lum := v_lum + v_pesos[i] * case when v_canal <= 0.03928 then v_canal / 12.92 else power((v_canal + 0.055) / 1.055, 2.4) end;
    end loop;
    return v_lum;
end;
$$;

-- Contraste WCAG de un color frente al fondo oscuro de la web (#0b0b0c)
create or replace function public._contraste_sobre_fondo(p_color text) returns numeric
language sql immutable set search_path = public, pg_temp as $$
    select round((greatest(_luminancia(p_color), _luminancia('#0b0b0c')) + 0.05)
               / (least(_luminancia(p_color), _luminancia('#0b0b0c')) + 0.05), 2)
$$;

create or replace function public.panel_guardar_negocio(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_red text;
    v_item jsonb;
    v_linea text;
    v_color text;
begin
    perform _exigir_panel(true);
    if length(coalesce(p_datos ->> 'nombre', '')) > 80 or length(coalesce(p_datos ->> 'descripcion', '')) > 300
       or not _imagen_valida(p_datos ->> 'logo_url') or not _imagen_valida(p_datos ->> 'portada_url')
       or (nullif(p_datos ->> 'whatsapp', '') is not null and length(normalizar_telefono(p_datos ->> 'whatsapp')) not between 10 and 15)
       or (nullif(p_datos ->> 'telefono', '') is not null and length(normalizar_telefono(p_datos ->> 'telefono')) not between 7 and 15) then
        raise exception 'negocio_invalido';
    end if;
    for v_red in select jsonb_object_keys(coalesce(p_datos -> 'redes', '{}'::jsonb)) loop
        if v_red not in ('instagram', 'facebook', 'tiktok', 'youtube')
           or (nullif(p_datos -> 'redes' ->> v_red, '') is not null
               and (p_datos -> 'redes' ->> v_red !~ '^https://[^\s"''<>]+$' or length(p_datos -> 'redes' ->> v_red) > 200)) then
            raise exception 'negocio_invalido: redes';
        end if;
    end loop;
    if jsonb_array_length(coalesce(p_datos -> 'faq', '[]'::jsonb)) > 20 then raise exception 'negocio_invalido: faq'; end if;
    for v_item in select * from jsonb_array_elements(coalesce(p_datos -> 'faq', '[]'::jsonb)) loop
        if length(coalesce(v_item ->> 'pregunta', '')) not between 1 and 160 or length(coalesce(v_item ->> 'respuesta', '')) not between 1 and 600 then
            raise exception 'negocio_invalido: faq';
        end if;
    end loop;
    if jsonb_array_length(coalesce(p_datos -> 'horarios_publicos', '[]'::jsonb)) > 10 then raise exception 'negocio_invalido: horarios'; end if;
    for v_linea in select jsonb_array_elements_text(coalesce(p_datos -> 'horarios_publicos', '[]'::jsonb)) loop
        if length(v_linea) > 80 then raise exception 'negocio_invalido: horarios'; end if;
    end loop;

    -- Identidad: colores legibles sobre el fondo de la web
    foreach v_color in array array[coalesce(p_datos ->> 'color_principal', ''), coalesce(p_datos ->> 'color_acento', '')] loop
        if v_color <> '' and (v_color !~ '^#[0-9a-fA-F]{6}$' or _contraste_sobre_fondo(v_color) < 4.5) then
            raise exception 'negocio_invalido: color';
        end if;
    end loop;
    if nullif(p_datos ->> 'correo', '') is not null
       and (length(p_datos ->> 'correo') > 120 or p_datos ->> 'correo' !~ '^[^\s@<>"'']+@[^\s@<>"'']+\.[^\s@<>"'']+$') then
        raise exception 'negocio_invalido: correo';
    end if;
    if length(coalesce(p_datos ->> 'politica_reservas', '')) > 1200 or length(coalesce(p_datos ->> 'politica_cancelacion', '')) > 1200 then
        raise exception 'negocio_invalido: politicas';
    end if;

    insert into negocio_config (id, datos, actualizado_en, actualizado_por) values (true, p_datos, now(), auth.uid())
    on conflict (id) do update set datos = excluded.datos, actualizado_en = now(), actualizado_por = auth.uid();
    perform _auditar('negocio_publicado', 'configuracion', 'negocio', p_datos - 'logo_url' - 'portada_url');
    return negocio_publico();
end;
$$;

revoke all on function public._luminancia(text) from public, anon, authenticated;
revoke all on function public._contraste_sobre_fondo(text) from public, anon, authenticated;
