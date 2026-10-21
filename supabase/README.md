# Módulos de crecimiento — instalación y configuración

Todos los módulos quedan **desactivados** tras instalar. Sin la migración, la web funciona exactamente igual que antes.

## 1. Base de datos

Ejecuta en orden en el SQL Editor de Supabase (o `supabase db push`):

1. `migrations/20261021000000_modulos_crecimiento.sql` — tablas nuevas, columnas opcionales en `citas`, funciones y RLS. Es aditiva e idempotente.
2. `migrations/20261021000001_citas_unicidad_activas.sql` — **revísala antes de aplicarla.** Si `citas` tiene un `UNIQUE (barbero_id, fecha, hora)` simple, las citas canceladas bloquean ese horario para siempre. Este archivo lo cambia por un índice único con el mismo nombre que ignora las canceladas. Sigue impidiendo el double-booking entre citas activas. La lista de espera y la reprogramación lo necesitan.

Requisitos que valida la migración: `citas.fecha` de tipo `date` y `citas.hora` de tipo `time`.

## 2. Administrador

1. Crea el usuario en *Authentication → Users*.
2. Autorízalo:
   ```sql
   insert into public.admin_usuarios (user_id) values ('<uuid-del-usuario>');
   ```
3. En la web, abre el panel con la clave actual, ve a la pestaña **Módulos** e inicia sesión con ese usuario.

La clave local del panel sigue abriendo las pestañas existentes. Las acciones de los módulos exigen la sesión de Supabase y se validan en el servidor.

## 3. Ajustes de los módulos (pestaña Módulos)

| Módulo | Ajustes principales |
|---|---|
| general | `hora_apertura`, `hora_cierre`, `intervalo_minutos`, `horas_minimas_cambio`, `zona_horaria`, `url_publica` (URL de la web, necesaria para los enlaces de WhatsApp) |
| whatsapp | `horas_antes` (p. ej. `[24, 2]`), `max_intentos`, `codigo_pais`, nombres de las plantillas |
| lista_espera | `minutos_vencimiento_oferta`, `max_dias_anticipacion`, `max_inscripciones_por_telefono` |
| recuperacion | `dias_inactividad`, `dias_entre_contactos`, `max_contactos` (requiere también el módulo whatsapp) |
| referidos | `beneficio_tipo` (`porcentaje`/`monto`), `beneficio_valor`, `acumulable_con_promocion` |
| productos | `max_unidades_por_producto` |

Reglas de negocio:

- **Pago:** la app no cobra. El admin marca la cita como **Completada y pagada** (botón de caja registradora en Citas). Ese hecho otorga los referidos y cuenta para la recuperación.
- **Referidos:** el beneficio se otorga una sola vez, cuando el referido completa y paga su primera visita. Se bloquean los autorreferidos, los teléfonos ya referidos y los clientes con visitas pagadas previas.
- **Reembolsos:** si se reembolsa la visita que generó el beneficio y este no se ha usado, se anula. Si ya se usó, no se recupera y queda anotado en el referido.
- **Promociones:** se aplica una sola por cita, la de mayor descuento. No se acumulan entre sí. Un beneficio de referido no se combina con una promoción salvo que `acumulable_con_promocion = true`. Cancelar una cita libera el cupo de la promoción.
- **Productos:** se reservan al crear la cita y se descuentan del stock de forma atómica. Se devuelven al cancelarla. El total va en `citas.total_productos`, separado del precio del servicio. Si una cita cancelada se reactiva desde el panel, los productos **no** se vuelven a reservar.

## 4. WhatsApp (Meta Cloud API)

El envío está desactivado hasta completar **todo** lo siguiente:

1. Crea en Meta las plantillas, en español (`es`):
   - `recordatorio_cita`: cuerpo con {{1}} nombre, {{2}} servicio, {{3}} fecha, {{4}} hora y {{5}} enlace. Tres botones de respuesta rápida: Confirmar, Cancelar, Reprogramar.
   - `oferta_lista_espera`: {{1}} nombre, {{2}} fecha, {{3}} hora, {{4}} minutos de validez, {{5}} enlace. Un botón de respuesta rápida: Aceptar.
   - `recuperacion_cliente`: {{1}} nombre, {{2}} enlace de reserva, {{3}} enlace de baja. Un botón de respuesta rápida: Darme de baja.
2. Configura los secretos:
   ```bash
   supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... \
     WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=... CRON_SECRET=... \
     WHATSAPP_ENVIO_HABILITADO=true
   ```
3. Despliega las funciones (Meta no envía un JWT de Supabase; la autenticidad se valida con la firma `X-Hub-Signature-256` y `CRON_SECRET`):
   ```bash
   supabase functions deploy whatsapp-webhook --no-verify-jwt
   supabase functions deploy whatsapp-enviar --no-verify-jwt
   ```
4. En Meta, configura el webhook con la URL `https://<PROYECTO>.supabase.co/functions/v1/whatsapp-webhook`, el `WHATSAPP_VERIFY_TOKEN` y la suscripción a `messages`.
5. Programa las tareas con `cron.example.sql` (requiere las extensiones `pg_cron` y `pg_net`).
6. Activa el módulo `whatsapp` y define `general.url_publica`.

Garantías del sistema:

- **Idempotencia:** cada mensaje tiene una `clave_idempotencia` única, así que no se duplica aunque el cron se ejecute varias veces.
- **Reclamo de mensajes:** usa `FOR UPDATE SKIP LOCKED`, para que dos ejecuciones simultáneas no envíen el mismo mensaje.
- **Recordatorios de citas canceladas o reprogramadas:** se omiten.
- **Reintentos:** solo ante errores 429 o 5xx, con espera exponencial.
- **Envíos sin confirmación:** si el proveedor no confirmó un envío, el mensaje se marca como `fallido` y no se reintenta solo. El reintento manual desde el panel avisa del riesgo de duplicar.
- **Eventos del webhook:** se procesan una sola vez por id. Además, cada token debe pertenecer al teléfono que responde.

Si el cliente no puede usar los botones, el enlace del mensaje (`?cita=<token>`) permite confirmar, cancelar o reprogramar desde la web. Son tokens aleatorios por cita y nunca se exponen en las lecturas públicas de `citas`.

## 5. Pruebas

```bash
npm install
npm test        # PostgreSQL 17 real local (embedded-postgres) + módulo de WhatsApp
npm run check   # sintaxis de los módulos JS del frontend
```
