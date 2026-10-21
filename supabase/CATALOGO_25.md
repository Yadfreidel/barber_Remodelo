# Catálogo de 25 cortes

Los 25 estilos sustituyen la selección pública anterior. Los servicios anteriores
permanecen intactos en la base y en el almacenamiento del navegador; sus IDs y las
citas que los referencian no se borran ni se renombran.

- Precios numéricos en DOP y duración en minutos: tabla del usuario aplicada exactamente.
- Solo corte: no incluye barba, lavado, productos ni extras. Los módulos opcionales
  ya existentes mantienen sus reglas y solo cobran lo que el cliente selecciona.
- Fuente inicial: `assets/catalogo/catalogo-25.json`; su módulo de distribución
  `models/catalogo25.js` incluye los metadatos para la web sin nuevas dependencias.
- Las tarifas vigentes se leen de `servicios` en el servidor. LocalStorage es caché;
  una reserva de estos estilos nunca se confirma con una tarifa local sin validar.
- Las imágenes WebP corresponden por ID a los PNG del paquete original. El manifiesto
  `assets/catalogo/imagenes-origen.json` registra hashes de ambos archivos. Se conservaron
  las dimensiones originales, reduciendo el peso conjunto a aproximadamente 3,8 MB.
- Las imágenes son simulaciones con IA, como indica el catálogo de origen.

## Base de datos

Migración: `migrations/20261021155903_catalogo_25_cortes.sql`.

Se importa mediante `catalogo_id` único, sin cambiar nombres/IDs de servicios anteriores.
`ON CONFLICT DO NOTHING` permite repetirla sin duplicar registros ni sobrescribir las
ediciones administrativas. No cambia horarios de apertura, cierre, intervalos,
notificaciones, pagos ni reglas de promociones/productos.

La duración de cada nueva cita importada se captura en `duracion_reservada`. Editar
la duración de un corte solo afecta a reservas futuras. La migración no actualiza
ninguna cita existente. La búsqueda de espacios reutiliza `_en_horario` y `_slot_libre`,
respetando la configuración de agenda actual. Las reservas de estos cortes pasan por
`cotizar_cita` / `reservar_cita` aunque los módulos adicionales estén desactivados.
El trigger también impide solapamientos al insertar o reactivar una cita importada.

## Administrar tarifas

En el panel existente, pestaña **Servicios**, editar el corte y guardar **Precio**
y **Duración del corte (minutos)**. El guardado requiere la sesión de Supabase Auth y
la autorización en `admin_usuarios` que ya usa la aplicación. El RPC
`admin_actualizar_corte` usa SECURITY INVOKER y una política RLS limitada a estos estilos.
No habilita modificaciones de los servicios anteriores. Una importación repetida
respeta estas tarifas editadas.

Los botones de eliminar y restaurar del catálogo siguen administrando la presentación
local, como antes; no borran filas con citas ni revierten tarifas guardadas en el servidor.
La tarifa del servidor vuelve a cargarse al actualizar el catálogo.

## Ejecución local

La migración ya se aplicó al PostgreSQL local del proyecto y se verificó por la API.
Para repetir la importación sin crear citas:

```text
npm run catalogo:local
npm run catalogo:verificar
```

El importador solo conecta a `127.0.0.1:54322`. Comprueba dentro de la transacción que
los servicios anteriores y todas las citas conservan sus datos. El segundo comando
solo consulta el catálogo y cotizaciones: no reserva ni envía mensajes.

Para un proyecto remoto, aplicar la migración junto con las migraciones anteriores
por el procedimiento habitual de despliegue. No se ha aplicado a ninguna base remota.

## Verificaciones

- `npm run check`, `git diff --check` y `npm test`.
- PostgreSQL temporal: importación repetida, 25 precios/duraciones exactos, permisos,
  solapamientos entre dos horas diferentes, concurrencia y protección de citas anteriores.
- Resumen de cliente con DOM simulado: seleccionar corte 11 → 17 → 11 produce
  RD$450 / 30 min → RD$800 / 60 min → RD$450 / 30 min, sin acumulación.
- API local real: cotización de los mismos estilos, sin crear citas.
- Imágenes: dimensiones, comparación con los PNG originales y revisión de hoja visual.

No había navegador conectado: queda pendiente comprobar manualmente el flujo completo
visual y la edición desde los controles del panel. No se crearon reservas reales ni
se enviaron mensajes durante la verificación.
