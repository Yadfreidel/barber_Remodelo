// Chat privado contra PostgreSQL real con 1 administrador, 2 clientes y 2 barberos: aislamiento entre clientes
// (mensajes y adjuntos), bandeja y asignación, pérdida de acceso al reasignar, idempotencia de reintentos,
// validación de fotos/audios, referencias para la cita, tarjetas de cita con estado actual y avisos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { iniciarBase, rpc, errorDe, fechaLocal } from './helpers.js';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const CLI1 = '22222222-2222-2222-2222-222222222222';
const CLI2 = '33333333-3333-3333-3333-333333333333';
const BETO = '55555555-5555-5555-5555-555555555555';
const CARO = '77777777-7777-7777-7777-777777777777';
// Archivos mínimos con cabeceras reales
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP////////8=';
const WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
const WEBM = 'data:audio/webm;codecs=opus;base64,' + Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 0, 0, 0, 0, 0, 0, 0x1f, 0x42, 0x86, 0x81, 1]).toString('base64');
const MP4 = 'data:audio/mp4;base64,' + Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0]).toString('base64');
let db, A, admin, cli1, cli2, beto, caro, ids, cita1, cita2;

const j = o => JSON.stringify(o);
const enviar = (cli, conv, tipo, texto = null, adjunto = null, cita = null, clave = randomUUID()) =>
    rpc(cli, 'chat_enviar', conv, clave, tipo, texto, adjunto ? j(adjunto) : null, cita);
const noAutorizado = async promesa => assert.match(await errorDe(promesa) || '', /no_autorizado/);

before(async () => {
    db = await iniciarBase(54350);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Beto'), ('Caro')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte 30', 500, 30)`);
    await db.migrar();
    await A.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'luis@x.com'), ($3, 'marta@x.com'), ($4, 'beto@x.com'), ($5, 'caro@x.com')`,
        [ADMIN, CLI1, CLI2, BETO, CARO]);
    await A.query('insert into admin_usuarios values ($1)', [ADMIN]);
    admin = await db.conexion('authenticated', ADMIN);
    cli1 = await db.conexion('authenticated', CLI1);
    cli2 = await db.conexion('authenticated', CLI2);
    beto = await db.conexion('authenticated', BETO);
    caro = await db.conexion('authenticated', CARO);
    ids = (await A.query(`select (select id::text from barberos where nombre = 'Beto') beto, (select id::text from barberos where nombre = 'Caro') caro`)).rows[0];
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.beto, 'beto@x.com');
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.caro, 'caro@x.com');
    // Cada cliente reserva una cita (sin cuenta, con su token); el chat la vincula a su cuenta al compartirla
    const anon = await db.conexion('anon');
    const f = await fechaLocal(A, 3);
    cita1 = await rpc(anon, 'reservar_cita', 'Luis Pérez', null, '8095550101', 'Corte 30', 'Beto', f, '10:00', '[]', null, false, null, randomUUID());
    cita2 = await rpc(anon, 'reservar_cita', 'Marta Gil', null, '8095550102', 'Corte 30', 'Caro', f, '11:00', '[]', null, false, null, randomUUID());
});

after(() => db?.cerrar());

let conv1, conv2;

test('el cliente inicia su conversación; nadie más la ve y el reintento no duplica', async () => {
    assert.deepEqual(await rpc(cli1, 'chat_mi_conversacion'), { conversacion: null, no_leidos: 0 });
    const clave = randomUUID();
    const m1 = await enviar(cli1, null, 'texto', 'Hola, quiero un fade', null, null, clave);
    assert.equal(m1.propio, true);
    assert.equal(m1.clave, clave);
    assert.equal(m1.autor, 'luis', 'sin citas en su cuenta: nombre del correo');
    // Reintento (p. ej. se cortó la conexión tras guardarse): mismo mensaje, sin duplicado
    const otra = await enviar(cli1, null, 'texto', 'Hola, quiero un fade', null, null, clave);
    assert.equal(otra.id, m1.id);
    conv1 = (await rpc(cli1, 'chat_mi_conversacion')).conversacion;
    assert.equal((await A.query('select count(*)::int n from chat_mensajes where conversacion_id = $1', [conv1])).rows[0].n, 1);
    await enviar(cli2, null, 'texto', 'Buenas, ¿tienen turno hoy?');
    conv2 = (await rpc(cli2, 'chat_mi_conversacion')).conversacion;
    assert.notEqual(conv1, conv2);
    // Un cliente no abre, no lee ni escribe en la conversación de otro
    await noAutorizado(rpc(cli2, 'chat_mensajes', conv1, null, 30));
    await noAutorizado(rpc(cli2, 'chat_novedades', conv1, 0));
    await noAutorizado(enviar(cli2, conv1, 'texto', 'intruso'));
    await noAutorizado(rpc(cli2, 'chat_leer', conv1, 999));
    // Ni con la clave de un mensaje ajeno
    await noAutorizado(enviar(cli2, conv1, 'texto', 'Hola, quiero un fade', null, null, clave));
    // Las tablas no se leen directamente
    for (const tabla of ['chat_conversaciones', 'chat_mensajes', 'chat_adjuntos', 'chat_lecturas', 'chat_respuestas_rapidas']) {
        assert.match(await errorDe(cli1.query(`select * from ${tabla}`)), /permission denied/);
    }
    const anon = await db.conexion('anon');
    assert.match(await errorDe(rpc(anon, 'chat_mi_conversacion')), /permission denied/);
});

test('fotos y audios: validación real, adjuntos privados entre clientes', async () => {
    const foto = await enviar(cli1, null, 'foto', 'Así lo quiero', { datos: JPEG, miniatura: WEBP, ancho: 1200, alto: 1600 });
    assert.equal(foto.adjunto.tipo, 'foto');
    assert.equal(foto.adjunto.miniatura, WEBP, 'la miniatura viaja con el mensaje');
    assert.ok(!JSON.stringify(foto).includes(JPEG), 'la foto completa no viaja en la lista');
    const audio = await enviar(cli1, null, 'audio', null, { datos: WEBM, duracion_ms: 4200 });
    assert.equal(audio.adjunto.mime, 'audio/webm;codecs=opus');
    assert.equal(audio.adjunto.duracion_ms, 4200);
    const audioSafari = await enviar(cli2, null, 'audio', null, { datos: MP4, duracion_ms: 1500 });
    assert.equal(audioSafari.adjunto.mime, 'audio/mp4');
    // El dueño descarga; el otro cliente no
    assert.equal((await rpc(cli1, 'chat_adjunto', foto.adjunto.id, 'completa')).datos, JPEG);
    assert.equal((await rpc(cli1, 'chat_adjunto', audio.adjunto.id, 'completa')).datos, WEBM);
    await noAutorizado(rpc(cli2, 'chat_adjunto', foto.adjunto.id, 'completa'));
    await noAutorizado(rpc(cli2, 'chat_adjunto', audio.adjunto.id, 'completa'));
    await noAutorizado(rpc(cli1, 'chat_adjunto', audioSafari.adjunto.id, 'completa'));
    // Tipo declarado que no coincide con el contenido, formatos no admitidos, tamaño y duración
    const invalido = async (tipo, adjunto) => assert.match(await errorDe(enviar(cli1, null, tipo, null, adjunto)), /adjunto_invalido/);
    await invalido('foto', { datos: JPEG.replace('image/jpeg', 'image/png') });
    await invalido('foto', { datos: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
    await invalido('foto', { datos: 'data:image/jpeg;base64,' + 'A'.repeat(1600000) });
    await invalido('audio', { datos: WEBM.replace('audio/webm', 'audio/ogg'), duracion_ms: 3000 });
    await invalido('audio', { datos: 'data:text/html;base64,PGh0bWw+', duracion_ms: 3000 });
    await invalido('audio', { datos: WEBM, duracion_ms: 200000 });
    assert.match(await errorDe(enviar(cli1, null, 'texto', '   ')), /mensaje_invalido/);
    assert.match(await errorDe(enviar(cli1, null, 'texto', 'x'.repeat(2001))), /mensaje_invalido/);
    assert.match(await errorDe(enviar(cli1, null, 'html', 'x')), /mensaje_invalido/);
});

test('bandeja del administrador: búsqueda, «Sin responder», asignación y respuesta', async () => {
    const todas = await rpc(admin, 'panel_chat_bandeja', 'todas', null, 30, null);
    assert.equal(todas.items.length, 2);
    const luis = todas.items.find(i => i.id === conv1);
    assert.equal(luis.correo, 'luis@x.com');
    assert.equal(luis.ultimo_autor, 'cliente');
    assert.ok(luis.no_leidos >= 3);
    assert.equal(luis.vista_previa, 'Nota de voz');
    assert.deepEqual((await rpc(admin, 'panel_chat_bandeja', 'todas', 'marta', 30, null)).items.map(i => i.id), [conv2], 'busca por correo');
    assert.deepEqual((await rpc(admin, 'panel_chat_bandeja', 'todas', '%', 30, null)).items, [], 'los comodines se buscan literalmente');
    assert.equal((await rpc(admin, 'panel_chat_bandeja', 'sin_responder', null, 30, null)).items.length, 2);
    assert.equal((await rpc(admin, 'panel_chat_bandeja', 'asignadas', null, 30, null)).items.length, 0);
    assert.equal(await rpc(admin, 'panel_chat_no_leidos'), 2);
    // Los barberos no ven nada sin asignación; tampoco pueden asignarse
    assert.deepEqual((await rpc(beto, 'panel_chat_bandeja', 'todas', null, 30, null)).items, []);
    await noAutorizado(rpc(beto, 'chat_mensajes', conv1, null, 30));
    await noAutorizado(rpc(beto, 'panel_chat_asignar', conv1, ids.beto));
    // Avisos internos: uno por ráfaga de mensajes, no uno por mensaje
    const avisos = (await A.query(`select count(*)::int n from notificaciones where user_id = $1 and tipo = 'chat_mensaje' and datos ->> 'conversacion' = $2`, [ADMIN, conv1])).rows[0].n;
    assert.equal(avisos, 1);
    // El administrador responde y asigna a Beto
    const resp = await enviar(admin, conv1, 'texto', '¿Puedes enviarme una foto del corte que buscas?');
    assert.equal(resp.autor, 'La barbería');
    const asignada = await rpc(admin, 'panel_chat_asignar', conv1, ids.beto);
    assert.equal(asignada.barbero, 'Beto');
    assert.equal((await rpc(admin, 'panel_chat_bandeja', 'asignadas', null, 30, null)).items[0].barbero, 'Beto');
    assert.deepEqual((await rpc(admin, 'panel_chat_bandeja', 'sin_responder', null, 30, null)).items.map(i => i.id), [conv2]);
    // Beto recibe el aviso y ve solo la conversación asignada
    assert.equal((await A.query(`select count(*)::int n from notificaciones where user_id = $1 and tipo = 'chat_asignada'`, [BETO])).rows[0].n, 1);
    assert.deepEqual((await rpc(beto, 'panel_chat_bandeja', 'todas', null, 30, null)).items.map(i => i.id), [conv1]);
    assert.equal((await rpc(beto, 'panel_chat_bandeja', 'todas', null, 30, null)).items[0].correo, null, 'el barbero no ve el correo del cliente');
    await noAutorizado(rpc(beto, 'chat_mensajes', conv2, null, 30));
    await noAutorizado(rpc(caro, 'chat_mensajes', conv1, null, 30));
    const pagina = await rpc(beto, 'chat_mensajes', conv1, null, 30);
    assert.equal(pagina.rol, 'barbero');
    assert.equal(pagina.mensajes.at(-1).tipo, 'asignacion');
    const deBeto = await enviar(beto, conv1, 'texto', 'Hola Luis, soy Beto');
    assert.equal(deBeto.autor, 'Beto');
    // El cliente lo ve, con el contador de no leídos
    const mia = await rpc(cli1, 'chat_mi_conversacion');
    assert.equal(mia.asignado, 'Beto');
    assert.equal(mia.no_leidos, 3, 'respuesta del admin, asignación y mensaje de Beto');
    const nuevos = await rpc(cli1, 'chat_novedades', conv1, resp.id - 1);
    assert.deepEqual(nuevos.mensajes.map(m => m.tipo), ['texto', 'asignacion', 'texto']);
    assert.equal(nuevos.mensajes[0].clave, null, 'la clave de envío solo la ve su autor');
    assert.equal((await rpc(cli1, 'chat_leer', conv1, deBeto.id)).no_leidos, 0);
    assert.equal((await rpc(beto, 'chat_novedades', conv1, deBeto.id)).leido_por_otro, deBeto.id, 'Beto ve que el cliente leyó');
});

test('paginación del historial', async () => {
    for (let i = 0; i < 6; i++) await enviar(cli2, null, 'texto', `Mensaje ${i}`);
    const p1 = await rpc(admin, 'chat_mensajes', conv2, null, 4);
    assert.equal(p1.mensajes.length, 4);
    assert.equal(p1.hay_mas, true);
    assert.ok(p1.mensajes[0].id < p1.mensajes[3].id, 'orden cronológico');
    const p2 = await rpc(admin, 'chat_mensajes', conv2, p1.mensajes[0].id, 50);
    assert.equal(p2.hay_mas, false);
    assert.equal(p2.mensajes.length, 4, '2 iniciales + 2 primeros de la ráfaga');
    assert.ok(p2.mensajes.at(-1).id < p1.mensajes[0].id);
});

test('tarjeta de cita y referencia para el corte: solo citas propias, el barbero de la cita la abre y el estado se actualiza', async () => {
    // El cliente comparte su cita (con su token): queda vinculada a su cuenta
    const tarjeta = await enviar(cli1, null, 'cita', null, null, cita1.token);
    assert.equal(tarjeta.cita.disponible, true);
    assert.equal(tarjeta.cita.token, cita1.token, 'el cliente recibe el token para «Ver cita»');
    assert.equal(tarjeta.cita.servicio, 'Corte 30');
    assert.equal(tarjeta.cita.barbero, 'Beto');
    assert.equal(tarjeta.cita.estado, 'pendiente');
    // Nadie comparte ni referencia citas ajenas (cada token secreto queda en la cuenta que lo usó primero)
    await enviar(cli2, null, 'cita', null, null, cita2.token);
    assert.match(await errorDe(enviar(cli1, null, 'cita', null, null, cita2.token)), /cita_no_encontrada/);
    assert.match(await errorDe(enviar(cli1, null, 'cita', null, null, randomUUID())), /cita_no_encontrada/);
    assert.match(await errorDe(enviar(cli1, null, 'cita', null, null, "1' or '1'='1")), /cita_no_encontrada/);
    assert.match(await errorDe(enviar(cli2, null, 'cita', null, null, cita1.token)), /cita_no_encontrada/, 'ya es de la cuenta de Luis');
    const vistaAdmin = (await rpc(admin, 'chat_novedades', conv1, tarjeta.id - 1)).mensajes[0];
    assert.equal(vistaAdmin.cita.token, undefined, 'el personal no recibe el token');
    assert.equal(vistaAdmin.cita.id, String(cita1.cita.id ?? (await A.query(`select cita_id from cita_tokens where token = $1`, [cita1.token])).rows[0].cita_id));
    const idCita1 = vistaAdmin.cita.id;
    const idCita2 = (await A.query(`select cita_id from cita_tokens where token = $1`, [cita2.token])).rows[0].cita_id;
    assert.match(await errorDe(enviar(admin, conv1, 'cita', null, null, idCita2)), /cita_no_encontrada/, 'el personal tampoco mezcla clientes');
    const delPersonal = await enviar(beto, conv1, 'cita', 'Te espero', null, idCita1);
    assert.equal(delPersonal.cita.propia, true);

    // Foto marcada como «Referencia para mi corte» al enviarla
    const ref = await enviar(cli1, null, 'foto', 'Referencia', { datos: JPEG, miniatura: WEBP, ancho: 800, alto: 1000 }, cita1.token);
    assert.equal(ref.adjunto.referencia.servicio, 'Corte 30');
    assert.match(await errorDe(enviar(cli1, null, 'foto', null, { datos: JPEG }, cita2.token)), /cita_no_encontrada/);
    assert.match(await errorDe(enviar(admin, conv1, 'foto', null, { datos: JPEG }, idCita1)), /mensaje_invalido/, 'solo el cliente marca referencias');
    // Beto (barbero de la cita) recibe aviso, la ve en el detalle de la cita y la abre
    assert.equal((await A.query(`select count(*)::int n from notificaciones where user_id = $1 and tipo = 'chat_referencia'`, [BETO])).rows[0].n, 1);
    const refs = await rpc(beto, 'panel_cita_chat_referencias', idCita1);
    assert.deepEqual(refs.map(r => r.id), [ref.adjunto.id]);
    assert.equal(refs[0].miniatura, WEBP);
    assert.equal((await rpc(beto, 'chat_adjunto', ref.adjunto.id, 'completa')).datos, JPEG);
    await noAutorizado(rpc(caro, 'panel_cita_chat_referencias', idCita1));
    await noAutorizado(rpc(caro, 'chat_adjunto', ref.adjunto.id, 'completa'));
    await noAutorizado(rpc(cli2, 'chat_adjunto', ref.adjunto.id, 'completa'));

    // Una foto anterior se vincula después; quitarla también funciona y solo la puede el autor
    const anterior = (await rpc(cli1, 'chat_mensajes', conv1, null, 50)).mensajes.find(m => m.tipo === 'foto' && !m.adjunto.referencia);
    assert.equal((await rpc(cli1, 'chat_referencia', anterior.adjunto.id, cita1.token)).referencia.estado, 'pendiente');
    assert.equal((await rpc(beto, 'panel_cita_chat_referencias', idCita1)).length, 2);
    await noAutorizado(rpc(cli2, 'chat_referencia', anterior.adjunto.id, cita2.token));
    assert.equal((await rpc(cli1, 'chat_referencia', anterior.adjunto.id, null)).referencia, null);
    assert.equal((await rpc(beto, 'panel_cita_chat_referencias', idCita1)).length, 1);

    // La barbería confirma la cita: la tarjeta ya mostrada refleja el estado actual
    await A.query(`update citas set estado = 'confirmada' where id::text = $1`, [idCita1]);
    const nov = await rpc(cli1, 'chat_novedades', conv1, ref.id);
    assert.equal(nov.tarjetas.find(t => t.id === tarjeta.id).cita.estado, 'confirmada');
    assert.equal(nov.tarjetas.find(t => t.id === ref.id).referencia.estado, 'confirmada');

    // Solicitud de cambio registrada en el chat
    const sol = await enviar(cli1, null, 'solicitud_cambio', '¿Puedo pasarla a las 4 pm?', null, cita1.token);
    assert.equal(sol.tipo, 'solicitud_cambio');
    assert.equal(sol.cita.estado, 'confirmada');
    assert.match(await errorDe(enviar(beto, conv1, 'solicitud_cambio', 'x cambio', null, idCita1)), /mensaje_invalido/);
    // Una cita cancelada ya no admite referencias
    await A.query(`update citas set estado = 'cancelada' where id::text = $1`, [idCita1]);
    assert.match(await errorDe(rpc(cli1, 'chat_referencia', anterior.adjunto.id, cita1.token)), /cita_no_proxima/);
    await A.query(`update citas set estado = 'confirmada' where id::text = $1`, [idCita1]);
});

test('al reasignar, el barbero anterior pierde el acceso (mensajes, adjuntos y avisos)', async () => {
    const foto = (await rpc(beto, 'chat_mensajes', conv1, null, 50)).mensajes.find(m => m.tipo === 'foto' && !m.adjunto.referencia);
    assert.ok((await rpc(beto, 'chat_adjunto', foto.adjunto.id, 'completa')).datos);
    await enviar(cli1, null, 'texto', '¿Sigues ahí?');
    assert.ok((await A.query(`select count(*)::int n from notificaciones where user_id = $1 and datos ->> 'conversacion' = $2`, [BETO, conv1])).rows[0].n >= 1);
    await rpc(admin, 'panel_chat_asignar', conv1, ids.caro);
    await noAutorizado(rpc(beto, 'chat_mensajes', conv1, null, 30));
    await noAutorizado(rpc(beto, 'chat_novedades', conv1, 0));
    await noAutorizado(enviar(beto, conv1, 'texto', 'Hola de nuevo'));
    await noAutorizado(rpc(beto, 'chat_adjunto', foto.adjunto.id, 'completa'));
    assert.deepEqual((await rpc(beto, 'panel_chat_bandeja', 'todas', null, 30, null)).items, []);
    assert.equal((await A.query(`select count(*)::int n from notificaciones where user_id = $1 and datos ->> 'conversacion' = $2`, [BETO, conv1])).rows[0].n, 0,
        'sus avisos de esta conversación dejan de enlazarla');
    // Sigue viendo la referencia de SU cita desde la agenda (no la conversación)
    const idCita1 = (await A.query(`select cita_id from cita_tokens where token = $1`, [cita1.token])).rows[0].cita_id;
    assert.equal((await rpc(beto, 'panel_cita_chat_referencias', idCita1)).length, 1);
    // Caro entra con el historial completo
    assert.ok((await rpc(caro, 'chat_mensajes', conv1, null, 50)).mensajes.length > 5);
    // Un barbero con contraseña temporal pendiente no opera
    await A.query('update barbero_usuarios set debe_cambiar_clave = true where user_id = $1', [CARO]);
    assert.match(await errorDe(rpc(caro, 'chat_mensajes', conv1, null, 30)), /cambio_clave_requerido|no_autorizado/);
    await A.query('update barbero_usuarios set debe_cambiar_clave = false where user_id = $1', [CARO]);
    // Al abrir la conversación, sus avisos quedan leídos
    await rpc(caro, 'chat_leer', conv1, 1e9);
    assert.equal((await A.query(`select count(*)::int n from notificaciones where user_id = $1 and tipo = 'chat_mensaje' and leida_en is null`, [CARO])).rows[0].n, 0);
});

test('respuestas rápidas: el personal las usa, solo la administración las edita', async () => {
    const lista = await rpc(beto, 'panel_chat_respuestas');
    assert.ok(lista.some(r => r.texto === '¿Puedes enviarme una foto del corte que buscas?'));
    await noAutorizado(rpc(beto, 'panel_chat_respuestas_guardar', ['x']));
    await noAutorizado(rpc(cli1, 'panel_chat_respuestas'));
    const nueva = await rpc(admin, 'panel_chat_respuestas_guardar', ['  Hola  ', '', '¿Qué estilo buscas?']);
    assert.deepEqual(nueva.map(r => r.texto), ['Hola', '¿Qué estilo buscas?']);
    assert.match(await errorDe(rpc(admin, 'panel_chat_respuestas_guardar', Array(21).fill('x'))), /respuestas_invalidas/);
});

test('límite de envíos por minuto', async () => {
    const c = await db.conexion('authenticated', CLI2);
    let error = null;
    for (let i = 0; i < 25 && !error; i++) error = await errorDe(enviar(c, null, 'texto', `spam ${i}`));
    assert.match(error || '', /demasiados_mensajes/);
});
