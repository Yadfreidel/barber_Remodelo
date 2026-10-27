# Módulos de crecimiento — instalación y configuración

Todos los módulos quedan **desactivados** tras instalar.

## 1. Base de datos (proyecto compartido con dominó)

La barbería vive en su propio esquema **`barberia`**; sus funciones internas están en **`barberia_private`**, que no se expone. La instalación no crea, cambia ni borra nada en `public`, `private` ni `auth`, y tampoco toca la configuración de Auth. Las tablas de dominó (`public.players`, `public.matches`) siguen igual.

1. **SQL Editor → New query**: pega y ejecuta `supabase/base_completa.sql` completo. Es una sola transacción: si algo falla, no queda nada a medias. Se puede volver a ejecutar sin duplicar datos. La última fila indica el estado (`Instalado en barberia…`).
2. **Exponer el esquema a la API** (sin esto la web recibe el error `PGRST106` / *Invalid schema*):
   - Abre *Project Settings → Data API* (en algunas versiones: *API → Data API settings*).
   - En **Exposed schemas** deja los que ya están (`public`, `graphql_public` y cualquier otro que use dominó) y **añade** `barberia`.
   - **No** añadas `barberia_private`. No cambies *Extra search path*.
   - Pulsa **Save**. Si la web sigue diciendo que el esquema no existe, ejecuta `notify pgrst, 'reload schema';`.
3. **Comprueba** la instalación con `supabase/barberia_verificacion.sql`. Es de solo lectura y cada bloque indica el resultado esperado.
4. **Web**: en `assets/config.js` pon la URL del proyecto compartido y su clave **pública** (anon / publishable). Nunca pongas la `service_role` ni una clave secreta. El cliente ya usa `db: { schema: 'barberia' }`.

Las migraciones de `supabase/migrations/` son el historial y están escritas para `public`. **No las ejecutes en el proyecto compartido.** `base_completa.sql` se genera a partir de ellas con `npm run base:completa`, que las traslada a `barberia` y falla si queda alguna referencia a `public.`.

### Actualizar un proyecto donde ya ejecutaste base_completa.sql

Ejecuta `supabase/barberia_actualizacion.sql` en el SQL Editor. Solo aplica las migraciones nuevas: «Mis citas», los horarios de 08:00 a 22:00 cada 30 minutos y las reservas sin duplicados. Conserva todas las citas, se ejecuta en una sola transacción y se puede repetir sin problema. Después comprueba la instalación con `barberia_verificacion.sql`.

Cómo se tratan las citas antiguas: las que no tenían duración guardada reciben la duración actual de su servicio (30 minutos si el servicio no tiene). Desde ese momento su hora de fin no cambia aunque luego se edite el catálogo. El horario semanal general solo pasa a 08:00–22:00 si conservaba los valores de fábrica (09:00–20:00). Los días cerrados, los horarios por barbero, los descansos y los bloqueos no se tocan.

**Cuentas de clientes (opcional).** En «Mis citas» los clientes pueden crear una cuenta para ver sus citas en otro dispositivo. Como el Auth es compartido con dominó, el enlace de confirmación del correo lleva a la *Site URL* del proyecto. Para que lleve a la barbería, añade `https://yadfreidel.github.io/barber_Remodelo/` en *Authentication → URL Configuration → Redirect URLs*. Es un cambio de la configuración compartida y conviene revisarlo antes. Sin este paso, el cliente confirma su correo y luego inicia sesión en «Mis citas» de forma normal.

### Si ya tenías la barbería instalada en public (versión anterior)

Tras los pasos 1 y 2, ejecuta `supabase/barberia_migrar_desde_public.sql`. Copia a `barberia` las citas, los clientes, la configuración y el resto de datos, conservando los ids, así que los enlaces `?cita=` siguen sirviendo. Solo funciona una vez, con `barberia` recién instalado, y no toca `public`. El bloque 8 de la verificación lista las tablas antiguas que quedan en `public`: bórralas a mano solo después de confirmar que dominó no las usa.

## 2. Administrador

Los permisos del panel dependen **solo** de `barberia.admin_usuarios` y `barberia.barbero_usuarios`. Un administrador de dominó no tiene acceso a la barbería, y viceversa.

1. Crea el usuario en *Authentication → Users*. El Auth es compartido: si el correo ya existe, se reutiliza.
2. Vuelve a ejecutar `base_completa.sql`, que autoriza el correo configurado (`yafre2310@gmail.com`), o ejecuta directamente:
   ```sql
   insert into barberia.admin_usuarios (user_id)
   select id from auth.users where email = 'correo@ejemplo.com'
   on conflict do nothing;
   ```
3. Los barberos se vinculan desde *Panel → Barberos → Acceso al panel*.

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
   Las funciones usan la `SUPABASE_SERVICE_ROLE_KEY` del servidor (nunca en el navegador) y trabajan sobre `db: { schema: 'barberia' }`.
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

### Avisos de la cita al cliente (migración 20261031000000)

La reserva se completa en la app (`reservar_cita`) y **no abre WhatsApp**. Los avisos al cliente son un complemento que
envía el servidor por la misma cola:

| Situación | Mensaje (tipo) | Cuándo |
|---|---|---|
| Cita web pendiente (política actual) | `solicitud` «solicitud recibida» | al reservar |
| La barbería la confirma | `confirmacion` | al confirmar (una sola vez) |
| Cita creada ya confirmada (panel) | `confirmacion` | al crearla (sin «solicitud») |
| Cancelación / reprogramación | `cancelacion` / `reprogramacion` | al cambiar |

- **Consentimiento:** casilla «Quiero recibir por WhatsApp la confirmación y los avisos de esta cita» al reservar
  (`cita_avisos_whatsapp`). Sin consentimiento no se envía ningún aviso de la cita, recordatorios incluidos. Es independiente
  del consentimiento de marketing. Las citas creadas desde el panel no lo piden: no reciben avisos hasta que el cliente lo acepte en otra reserva.
- **Fiabilidad:** la cita se guarda primero; si WhatsApp falla, la cita sigue guardada y visible. Cada aviso tiene una clave
  única (`solicitud:<cita>`, `confirmacion:<cita>:<fecha>T<hora>`), así que reintentos o eventos repetidos no lo duplican.
- **Plantillas a crear en Meta** (categoría *Utility*, idioma `es`), y su nombre en Panel › WhatsApp (campo «nombre de plantilla de Meta»).
  Parámetros, en este orden: {{1}} cliente, {{2}} servicio, {{3}} barbero, {{4}} fecha, {{5}} hora, {{6}} barbería (nombre – dirección), {{7}} enlace a la cita.
  - Solicitud recibida: «Hola {{1}}, recibimos tu solicitud de cita en {{6}}: {{2}} con {{3}}, {{4}} a las {{5}}. Está pendiente de confirmación. Detalles: {{7}}»
  - Confirmación: «Hola {{1}}, tu cita en {{6}} está confirmada: {{2}} con {{3}}, {{4}} a las {{5}}. Gestiónala aquí: {{7}}»
  Ninguno dice que la cita está pagada.
- **Teléfono:** se guarda normalizado (10 dígitos) y la función añade el código de país configurado en el módulo (`codigo_pais`, por defecto 1 para RD).

Para que se envíen de verdad faltan los pasos 1–6 de arriba (credenciales de Meta, despliegue de `whatsapp-enviar`, cron y
activar el módulo) y crear estas dos plantillas. Para probar sin escribir a clientes, usa en Meta un número de prueba y destinatarios de prueba.

## 5. Panel de gestión

Migración: `migrations/20261023000000_panel_administracion.sql` (aplicar después de las anteriores; en local la aplica `npm run local`).

**Acceso:** desde **Más → Acceso administrativo**, con correo y contraseña de Supabase Auth.

| Rol | Cómo se asigna | Qué puede hacer |
|---|---|---|
| Administrador | Fila en `admin_usuarios` (sección 2) | Todo el panel |
| Barbero | Panel → Barberos → Acceso al panel (la cuenta debe existir en Authentication) | Solo su agenda: confirmar, completar, marcar "no asistió" y anotar |

Los permisos se comprueban en el servidor (funciones `panel_*` y RLS), no solo ocultando botones.

**Recuperación de contraseña:** "¿Olvidaste tu contraseña?" envía el enlace de Supabase Auth. Configura la URL de la web en *Authentication → URL Configuration*. El entorno local no envía correos; ahí usa:

```bash
npm run local:usuario -- correo@ejemplo.com nuevaClave            # crea la cuenta o cambia la contraseña
npm run local:usuario -- correo@ejemplo.com nuevaClave --admin    # además la hace administradora
```

**Qué necesita servidor o integración externa:**
- Todo el panel guarda en la base (Supabase o el entorno local). Sin base de datos la web pública funciona en modo local, pero el panel no puede abrirse.
- Fotos de servicios, barberos, logo y portada: se reducen en el navegador y se guardan en la base como imagen comprimida. Para mucho volumen conviene Supabase Storage.
- WhatsApp: "Abrir WhatsApp con texto" funciona siempre (lo envía la persona). El envío automático requiere el módulo WhatsApp, las credenciales de Meta (sección 4) y el nombre de cada plantilla aprobada. El panel muestra el estado real de cada envío.
- Pagos: el panel registra cobros hechos fuera de la app (efectivo, tarjeta, transferencia); no cobra en línea.

## 6. Pruebas

```bash
npm install
npm test        # PostgreSQL 17 real local (embedded-postgres) + módulo de WhatsApp
npm run check   # sintaxis de los módulos JS del frontend
```

## 7. Inventario, ventas y caja (Panel › Finanzas)

Solo para administradores; el servidor rechaza a barberos, clientes y visitantes aunque llamen a la API. Requiere conexión: un cobro nunca se da por confirmado si no lo guardó el servidor.

**Cargar el inventario inicial**
1. *Inventario › Proveedores*: agrega tus proveedores (opcional).
2. *Inventario › Artículos › Nuevo artículo*: nombre, tipo (*Para vender* o *Insumo*), unidad (unidad, par, ml, l, g, kg), precio de venta, **costo unitario**, existencia mínima y **existencia inicial**. Sin costo, el valor del inventario y el margen salen como incompletos.
3. Más adelante, la mercancía nueva se registra en *Inventario › Compras › Registrar compra*. Su pago se registra aparte con *Registrar pago*, que queda como gasto enlazado a la compra.
4. Opcional: en *Consumo por servicio* indica cuánto insumo usa cada servicio, por ejemplo 20 ml por corte. Se descuenta al completar la cita.

**Registrar una venta**
1. *Caja › Abrir caja* con el fondo inicial. Solo hace falta para cobrar o devolver en efectivo.
2. *Ventas y cobros › Nuevo cobro*, o *Cobrar* en una cita de la agenda. Busca, toca los servicios o productos, elige el barbero de cada servicio y, si hay descuento, escribe el motivo.
3. Elige el medio de pago. Puedes combinar varios. En efectivo escribe lo recibido: se muestra el cambio y se registra solo el importe cobrado.
4. Pulsa *Confirmar cobro*. El comprobante interno (no fiscal) aparece en pantalla y se puede imprimir.
5. Si el cliente paga una parte antes (anticipo), el resto se cobra con *Cobrar saldo*. El ingreso cuenta una sola vez.

**Cerrar la caja**
1. *Caja › Cerrar caja*: cuenta el efectivo de la gaveta y escribe la cifra. Se muestra la diferencia con el esperado.
2. Si hay diferencia, la observación es obligatoria. El cierre queda guardado, y una corrección posterior registra el valor anterior, el motivo y quién la hizo.

**Reglas**
- La existencia solo cambia con movimientos: compra, venta, consumo, pérdida, devolución o ajuste por conteo. Nunca queda negativa. Los artículos se desactivan, no se borran.
- Las ventas, pagos y cierres confirmados no se editan ni se borran. Se corrigen con devoluciones, reembolsos o anulaciones, que quedan en el historial.
- Valoración del inventario: costo promedio ponderado. El margen estimado es ventas netas menos el costo de lo vendido y de los insumos consumidos. **No** es la ganancia neta, porque no incluye gastos.
- No hay impuestos ni comisiones configurados en el sistema, así que no se aplican.

## Cuentas de barberos y avisos (migración 20261028000000)

**Cuentas.** Las contraseñas viven solo en Supabase Auth. Panel › Barberos › «Agregar barbero» o «Habilitar acceso»
crea la cuenta con una contraseña temporal y la vincula con el perfil (`panel_cuenta_vincular`, validada en la base).
Al entrar, el barbero debe cambiarla: el servidor lo comprueba con la huella del hash de Auth.

- Con la Edge Function `barbero-cuenta` desplegada, la cuenta se crea ya confirmada (sin enviar correos):
  `supabase functions deploy barbero-cuenta` (usa los secretos automáticos SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY).
- Sin ella, se usa el registro normal de Auth: el barbero recibe un correo de confirmación.
- «Enviar enlace para restablecer contraseña», el registro profesional y el cambio de correo usan el envío de correos de Supabase Auth.
  El servicio de correo por defecto de Supabase está muy limitado (pocos envíos por hora y solo a miembros del equipo del proyecto):
  para correos reales configura un SMTP propio en Authentication › Emails › SMTP. Es configuración compartida con las otras
  aplicaciones del proyecto: decídelo antes de cambiarla.

**Avisos.** Cada cita nueva, cancelada, reprogramada o reasignada genera un aviso interno para la cuenta del barbero
(o para administración si no tiene cuenta), uno por evento y destinatario. Con la app abierta se ve y suena en el panel.

**Avisos con la app cerrada (Web Push) — migración 20261101000000.** La cita y su aviso interno se guardan aunque esto falle.
El push solo dice «Nueva reserva. Toca para ver los detalles.»; al tocarlo abre esa cita en el panel (pide iniciar sesión
si hace falta y el servidor comprueba que la cita sea de esa cuenta).

1. Claves VAPID: ya generadas con `node local/generar-vapid.mjs`. La pública está en `assets/config.js`; la privada
   SOLO en `local/.vapid.json` (fuera de Git). No las regeneres: invalidaría los dispositivos registrados.
2. Secretos de la función (Supabase › Edge Functions › Secrets, o por terminal):
   `npx supabase secrets set --project-ref <PROYECTO> VAPID_PUBLIC_KEY=<pública> VAPID_PRIVATE_KEY=<privada de local/.vapid.json> VAPID_SUBJECT=mailto:tu@correo.com CRON_SECRET=<secreto largo>`
3. Despliega `push-enviar` **sin verificación JWT** (la protege `CRON_SECRET`): `npx supabase functions deploy push-enviar --no-verify-jwt --project-ref <PROYECTO>`.
4. Disparo inmediato (recomendado): Supabase › Database › Webhooks › *Create a new hook* sobre la tabla `barberia.push_envios`,
   evento **Insert**, tipo *HTTP Request*, método POST a `https://<PROYECTO>.supabase.co/functions/v1/push-enviar` con la cabecera
   `Authorization: Bearer <CRON_SECRET>`. Así el aviso sale en segundos.
5. Reintentos: programa además la llamada cada minuto con `cron.example.sql` (requiere pg_cron y pg_net). Sin el paso 4, el aviso tarda hasta un minuto.
6. Activación en cada teléfono: Panel › Notificaciones › «Activar avisos y sonido» y «Probar notificación».
   - Android: Chrome (funciona sin instalar; opcional ⋮ › Instalar app).
   - iPhone/iPad: iOS 16.4 o posterior, Safari › Compartir › Agregar a inicio, abrir desde ese ícono y activar ahí.
   El sonido con la app cerrada lo pone el sistema; en silencio o «No molestar» puede no sonar.
