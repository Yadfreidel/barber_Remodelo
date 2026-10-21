# Tarjeta digital de cita (Meta Cloud API)

## Qué hace y cuándo se envía

La tarjeta se integra en `whatsapp-enviar`, dentro del envío existente de cada mensaje
`recordatorio`. No crea otra fila en la cola, no añade triggers y no escribe en `citas`.
Se conservan el teléfono, los botones y las claves de idempotencia actuales.
El nombre, servicio, profesional, fecha, hora, referencia y estado se vuelven a leer de
la cita guardada. El título solo dice «Confirmación de cita» si `estado=confirmada`;
una solicitud pendiente conserva ese estado aunque el cliente confirme su asistencia.

El envío inmediato al reservar sigue siendo el enlace `wa.me` a la barbería: ese enlace
solo admite texto y no adjunta archivos. No se ha añadido un envío inmediato al cliente,
porque cambiaría los destinatarios y eventos actuales. La tarjeta automática llega en
el evento de recordatorio ya existente, cuando esté habilitado el módulo WhatsApp.

## Activación pendiente en Meta / Supabase

No se enviaron mensajes reales ni se desplegaron funciones durante la implementación.
Sin las variables siguientes se sigue enviando la plantilla de texto actual.

1. Crear y obtener aprobación de **dos plantillas Utility**, en el mismo idioma que los
   recordatorios (`es` actualmente). Mantener los tres botones de respuesta rápida y su
   orden: Confirmar, Cancelar, Reprogramar.
2. La primera plantilla debe tener encabezado **IMAGE**; la segunda no debe tener
   encabezado multimedia. Ambas usan este cuerpo (nueve parámetros):

   ```text
   *{{1}}*
   *{{2}}*

   Hola, {{3}}.
   {{4}}

   *Servicio:* {{5}}
   *Profesional:* {{6}}
   *Fecha:* {{7}}
   *Hora:* {{8}}
   {{9}}
   ```

   Parámetros: negocio, título según estado, cliente, frase según estado, servicios,
   profesional, fecha completa, hora de 12 horas y cierre. El cierre incluye ubicación,
   referencia y enlace HTTPS únicamente si existen, separados por ` · `, seguido de
   «Gracias por elegirnos.». Los parámetros no contienen saltos de línea.
   Usar muestras ficticias al presentar las plantillas para aprobación.
3. Configurar secretos **solo en el servidor**:

   ```text
   WHATSAPP_PLANTILLA_TARJETA=<nombre aprobado con IMAGE>
   WHATSAPP_PLANTILLA_TARJETA_TEXTO=<nombre aprobado solo texto>
   ```

   Se reutilizan `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `CRON_SECRET` y
   `WHATSAPP_ENVIO_HABILITADO`. No cambiar las credenciales actuales.
4. Desplegar `whatsapp-enviar` empaquetando los archivos `static_files` de
   `supabase/config.toml`. Usar una versión de Supabase CLI compatible con archivos
   estáticos y el empaquetado Docker indicado por la documentación oficial. Los
   recursos WASM y la fuente están incluidos; no se descargan en cada envío.
5. Validar primero en el entorno de prueba de Meta, con números de prueba autorizados.

No hace falta aplicar migraciones, crear buckets ni publicar imágenes con datos personales.
La imagen se genera en memoria y se sube a Meta por `/media` con autenticación; el
mensaje usa el identificador del archivo, no una URL pública. Meta controla su propia
retención de archivos. El nombre de archivo no contiene datos del cliente.

## Identidad y recursos

`assets/business-identity.js` usa «Barbería Master», el nombre del título de la web.
No hay logo de imagen ni dirección configurados: se omiten. Si existe un logo oficial,
configurar ahí su ruta PNG/JPEG **del mismo sitio**, junto con la ubicación real si se
conoce. No admite SVG ni redirecciones ni imágenes mayores de 1 MiB. Un logo que falle
no impide mostrar el nombre del negocio.

El servidor toma `zona_horaria` y `url_publica` de los ajustes generales existentes.
`citas.fecha` y `citas.hora` ya son valores locales de la barbería: no se reinterpretan
como UTC. El enlace de gestión solo se incluye para una URL HTTPS sin credenciales y
un token válido. El token de gestión no aparece en el PNG; el código visible es el ID
de la cita, cuando está disponible.

PNG: ancho 1080 px, altura calculada según las líneas y servicios, fondo oscuro y azul
existentes. Fuente Inter incluida con licencia OFL. Rasterizador local
`@resvg/resvg-wasm` 2.6.2 (MPL-2.0), añadido como dependencia fijada; no es un servicio
externo ni cambia el proveedor. Su binario copiado en `card-assets` procede del mismo
paquete y debe actualizarse junto con la versión si se cambia en el futuro.

## Vista previa sin envíos

Administración → Módulos → Mensajes WhatsApp → Vista previa de tarjeta digital.
Permite elegir confirmada, pendiente, cancelada, nombre largo/varios servicios y
campos opcionales ausentes. Todos los datos de muestra están marcados como ficticios.
El botón genera y permite descargar PNG; también deja el texto seleccionable.
No hay botón de envío en la vista previa.

La gestión de una cita existente por su enlace seguro también permite visualizar y
descargar su tarjeta. Esta usa la respuesta de `consultar_cita`, no el formulario.
Cuando esa consulta no proporciona el ID de reserva se omite la referencia; no se
reutiliza el token secreto como código visible. Se debe volver a cargar la gestión
para obtener un estado actualizado después de un cambio externo.

## Fallos e idempotencia

- Generación, lectura de datos o subida fallida: conservar un único envío de texto.
  Se usa la nueva plantilla de texto si está configurada y los datos están disponibles;
  en otro caso se conserva la plantilla anterior.
- Rechazo explícito de medios (131052/131053) o HTTP 4xx distinto de 429: intentar texto una vez.
- Imagen con texto aceptada: no enviar un segundo mensaje de texto.
- Timeout o fallo de conexión tras iniciar el envío: no intentar texto ni reintentar;
  podría haber sido entregado. Los errores 5xx con tarjetas tampoco se reintentan.
- 429 explícito: la cola conserva su política de reintento.
- El cuerpo de una plantilla multimedia tiene límite de 1024 caracteres: si los datos
  lo superan, se conserva el recordatorio de texto existente, sin truncar la tarjeta
  descargable. No se envían fragmentos adicionales sin seguimiento independiente.
- La reclamación atómica y las claves de la cola evitan envíos concurrentes/por recarga.
  Un reintento manual deliberado conserva la advertencia de duplicados del panel.
- No se puede garantizar entrega exactamente una vez entre la API y PostgreSQL; ante
  incertidumbre se prioriza evitar duplicados. Ningún fallo de imagen modifica la cita.

## Pruebas

`npm run check` y `npm test`. Las pruebas nuevas usan transporte simulado, nunca Meta.
Cubren PNG real con el WASM y la fuente empaquetados, estados, fechas, horas, zona
horaria, nombres largos, varios servicios, campos opcionales, enlaces seguros,
fallo de imagen/subida y respuestas ambiguas sin reenvío. Los tests de PostgreSQL
siguen verificando disponibilidad, reservas concurrentes y anti doble reserva.

Para generar el artefacto ficticio de revisión visual, establecer `TARJETA_QA_DIR`
con un directorio temporal y ejecutar los tests de `appointment-card.test.js`.

Verificación adicional del renderizador del servidor:

```text
deno check --no-lock --node-modules-dir=none supabase/functions/whatsapp-enviar/index.ts
deno test --no-lock --allow-read --node-modules-dir=none supabase/functions/whatsapp-enviar/render-card.test.ts
```
