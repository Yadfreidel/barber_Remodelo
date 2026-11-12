# Consulta de estilo, Atención unificada y pantalla de turnos: orden de publicación

El frontend depende de la migración `20261107000000_estilo_atencion_pantalla.sql`. **Primero va el SQL y después la web.** Si la web sale antes:

- la reserva sigue funcionando, pero la foto o la nota no se guardan (aparece «Reintentar»);
- «Atención» no carga.

## 1. Base de datos — APLICADA (12/11/2026)

La migración ya está en el proyecto compartido (verificado en solo lectura: `fila_pantalla` responde y las funciones del panel exigen sesión). `INSTALADO_HASTA` apunta a ella.

## 2. Web (GitHub Pages)

Sube `main` a `remodelo` (el sitio publicado) y a `origin`. Comprueba que el despliegue de Pages termine en «success» y que `/barber_Remodelo/pantalla-turnos.html` responda 200.

Los archivos del asistente de IA siguen sin subir. Comparten cambios con `index.html`, `package.json`, `local/generar-base-completa.mjs` y los SQL generados.

## 3. Puesta en marcha

1. En Panel › Fila virtual › **Ajustes**, asigna la silla de cada barbero. Si un barbero no tiene silla, la TV muestra «Pasa a recepción».
2. En la TV, abre Panel › Fila virtual o Atención › **Abrir pantalla de turnos**. Después toca **Activar sonido** y **Pantalla completa**.
