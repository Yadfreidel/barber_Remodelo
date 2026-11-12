# Pantalla de turnos con fila y citas de hoy: orden de publicación

Migración: `20261108000000_pantalla_tv_listas.sql` (aditiva: no crea tablas ni columnas).

- `consultar_cita` añade `referencia`, el código público que ya mostraba el comprobante (`C-00412`). Así el detalle de la cita muestra el mismo código que la TV.
- `fila_pantalla` añade `fecha`, `espera` y `citas`:
  - `espera`: código, estado, turnos delante y minutos estimados.
  - `citas`: código, hora, estado y silla.
  - No incluye nombres, teléfonos, notas, fotos, ids internos ni tokens.
- El código de la cita solo se muestra. Para consultar o cambiar una cita sigue haciendo falta el enlace privado (token).

## 1. Base de datos — APLICADA (12/11/2026)

La migración ya está en el proyecto compartido (verificado en solo lectura: `fila_pantalla` devuelve `fecha`, `espera` y `citas`). `INSTALADO_HASTA` apunta a ella.

## 2. Web (GitHub Pages)

Sube `main` a `remodelo` (el sitio publicado) y a `origin`. Comprueba que el despliegue de Pages termine en «success» y que `/barber_Remodelo/pantalla-turnos.html` muestre «Fila sin cita» y «Citas de hoy».

Si la web sale antes que el SQL, no se rompe nada:

- la TV sigue mostrando el llamado, el QR y el contador, pero sin las dos listas;
- el detalle de la cita no muestra el código;
- la confirmación sí lo muestra, porque ya lo traía.

## 3. En el local

La TV se actualiza sola cada 3 s y cambia de día a medianoche (hora de Santo Domingo). Si hay más filas de las que caben, rota páginas cada 8 s con el indicador «1 de N». Las citas aparecen cuando la barbería las confirma: las pendientes no salen.
