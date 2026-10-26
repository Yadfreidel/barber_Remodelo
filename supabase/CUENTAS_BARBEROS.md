# Cuentas de barberos

La opción está en **Configuración → Barberos**. Permite crear un perfil con cuenta, habilitar acceso a un perfil existente, vincular una cuenta existente con confirmación, cambiar su correo de acceso y desactivar/reactivar el acceso conservando el historial.

## En esta PC

Ejecuta `npm run local`. Instala las actualizaciones locales e inicia también la función de cuentas si no está disponible. Abre http://localhost:8080 y recarga la página después de actualizar el código.

La creación usa el proveedor local de autenticación, que emula Supabase. El envío de restablecimientos por correo requiere Supabase y un servicio de correo; no está disponible en local.

## Web publicada

El proyecto configurado en `assets/config.js` es `gopuiuzvfysrkvaoppkh`. No aplicar los cambios a otro proyecto.

1. Comprobar que ese proyecto tiene instalada la base de barbería hasta la migración `20261028000000_cuentas_permisos_notificaciones.sql`. Si no la tiene, revisar su esquema antes de elegir la actualización: el archivo incremental presupone esa versión.
2. Ejecutar `supabase/barberia_actualizacion.sql` en su SQL Editor. Usa el esquema `barberia` y conserva los datos.
3. Desplegar la función con una sesión de Supabase CLI autorizada:

   ```powershell
   npx supabase functions deploy barbero-cuenta --project-ref gopuiuzvfysrkvaoppkh
   ```

   La función necesita `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` en el servidor. No copiar claves privilegiadas al frontend. La función valida al administrador y la base vuelve a comprobar su autorización.
4. Publicar los cambios del frontend en el repositorio que sirve la web y recargarla. La URL pública configurada actualmente es `https://yadfreidel.github.io/barberia-master/`.
5. Para restablecimientos: configurar el correo de Auth y añadir la URL de la barbería a las Redirect URLs, conservando las URLs de las otras aplicaciones del proyecto compartido.
6. Ejecutar `barberia_verificacion.sql` para comprobar los objetos instalados. Esto no acredita el despliegue de la Edge Function ni el envío de correo.

## Comprobaciones aisladas

```powershell
npm run check
node --test --test-concurrency=1 supabase/tests/cuentas_notificaciones.test.js supabase/tests/base_completa.test.js supabase/tests/panel.test.js
node local/verificar-cuentas.mjs
```

La última prueba arranca una base y un Auth locales temporales en puertos independientes. Comprueba creación por HTTP, login, rol, conservación de permisos, cambio de contraseña, desactivación/reactivación y rechazo de un usuario sin autorización administrativa. No utiliza cuentas ni datos de la instalación habitual ni envía correos.
