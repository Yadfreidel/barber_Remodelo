// «Estilos de la casa» contra PostgreSQL real: publicaciones con varias fotos, permisos por rol,
// borradores/pendientes/originales privados, revisiones de lo publicado, moderación, publicación directa y destacados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBase, rpc, errorDe } from './helpers.js';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const BARBERO = '55555555-5555-5555-5555-555555555555';
const OTRO = '77777777-7777-7777-7777-777777777777';
const IMG = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
const ORIGINAL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP////////8=';
let db, A, anon, admin, barbero, otro, ids;

const j = o => JSON.stringify(o);
const foto = (extra = {}) => j({ original: ORIGINAL, imagen: IMG, tarjeta: IMG, miniatura: IMG, ancho: 1200, alto: 1500, foco_x: 40, foco_y: 30,
    ajustes: { brillo: 10, giro: 90 }, ...extra });
const estilo = (cli, datos = {}, id = null) => rpc(cli, 'panel_estilo_guardar', id, j({ titulo: 'Taper con textura', texto_alternativo: 'Corte taper visto de lado',
    muestra_persona: false, ...datos }));

before(async () => {
    db = await iniciarBase(54346);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Beto'), ('Caro')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte 30', 500, 30)`);
    await db.migrar();
    await A.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'beto@x.com'), ($3, 'caro@x.com')`, [ADMIN, BARBERO, OTRO]);
    await A.query('insert into admin_usuarios values ($1)', [ADMIN]);
    anon = await db.conexion('anon');
    admin = await db.conexion('authenticated', ADMIN);
    barbero = await db.conexion('authenticated', BARBERO);
    otro = await db.conexion('authenticated', OTRO);
    ids = (await A.query(`select (select id::text from barberos where nombre = 'Beto') beto, (select id::text from barberos where nombre = 'Caro') caro,
        (select id::text from servicios where nombre = 'Corte 30') s30`)).rows[0];
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.beto, 'beto@x.com');
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.caro, 'caro@x.com');
});

after(() => db?.cerrar());

test('borrador con varias fotos: autor desde la sesión, permisos, validación y nada público hasta publicar', async () => {
    // El barbero no elige el autor: aunque envíe otro barbero_id, el trabajo es suyo
    const t = await estilo(barbero, { barbero_id: ids.caro, servicio_id: ids.s30 });
    assert.equal(t.barbero_id, ids.beto);
    assert.equal(t.estado, 'borrador');
    const f1 = await rpc(barbero, 'panel_estilo_foto_guardar', t.id, null, foto());
    const f2 = await rpc(barbero, 'panel_estilo_foto_guardar', t.id, null, foto({ foco_x: 70 }));
    assert.equal(await errorDe(rpc(otro, 'panel_estilo_foto_guardar', t.id, null, foto())), 'no_autorizado', 'otro barbero no añade fotos');
    assert.equal(await errorDe(rpc(otro, 'panel_estilo_foto_original', f1.id)), 'no_autorizado', 'ni ve el original');
    assert.equal(await errorDe(rpc(barbero, 'panel_estilo_foto_guardar', t.id, null, foto({ imagen: 'data:image/svg+xml;base64,PHN2Zz4=' }))), 'imagen_invalida');
    assert.equal(await errorDe(rpc(barbero, 'panel_estilo_foto_guardar', t.id, null, foto({ original: null }))), 'imagen_invalida', 'sin original no se crea');
    assert.equal(await errorDe(rpc(barbero, 'panel_estilo_foto_guardar', t.id, null, foto({ ancho: 99999 }))), 'imagen_invalida');
    // Orden y portada
    const ordenado = await rpc(barbero, 'panel_estilo_fotos_ordenar', t.id, [f2.id, f1.id], f2.id);
    assert.deepEqual(ordenado.fotos.map(f => [f.id, f.portada]), [[f2.id, true], [f1.id, false]]);
    // Editar una foto no cambia su original
    await rpc(barbero, 'panel_estilo_foto_guardar', t.id, f1.id, j({ imagen: IMG, tarjeta: IMG, miniatura: IMG, ancho: 1000, alto: 1000, ajustes: { contraste: 5 } }));
    assert.equal(await rpc(barbero, 'panel_estilo_foto_original', f1.id), ORIGINAL);
    // Nada es público todavía y las tablas no se leen directamente
    assert.equal((await rpc(anon, 'estilos_publicos', null, 8, 0)).total, 0);
    assert.equal(await rpc(anon, 'estilo_publico', t.id), null);
    assert.equal(await rpc(anon, 'estilo_foto', f1.id, 'tarjeta'), null, 'la foto de un borrador no es pública');
    for (const tabla of ['portafolio_fotos', 'galeria_config']) assert.match(await errorDe(anon.query(`select * from ${tabla}`)), /permission denied/);
    assert.match(await errorDe(rpc(anon, 'panel_estilo_foto_original', f1.id)), /permission denied/);
    // Con moderación (valor inicial) enviar deja el trabajo pendiente; publicar es del administrador
    assert.equal((await rpc(barbero, 'panel_portafolio_estado', t.id, 'enviar_revision', null)).estado, 'pendiente');
    assert.equal(await errorDe(rpc(barbero, 'panel_portafolio_estado', t.id, 'publicar', null)), 'no_autorizado');
    assert.equal((await rpc(anon, 'estilos_publicos', null, 8, 0)).total, 0, 'lo pendiente no es público');
    const publicado = await rpc(admin, 'panel_portafolio_estado', t.id, 'publicar', null);
    assert.equal(publicado.estado, 'publicado');
    const lista = await rpc(anon, 'estilos_publicos', null, 8, 0);
    assert.equal(lista.total, 1);
    assert.equal(lista.trabajos[0].portada.id, f2.id, 'la portada elegida');
    assert.equal(lista.trabajos[0].fotos, 2);
    const detalle = await rpc(anon, 'estilo_publico', t.id);
    assert.equal(detalle.servicio.nombre, 'Corte 30');
    assert.equal(detalle.barbero, 'Beto');
    assert.ok(!JSON.stringify(detalle).includes('base64'), 'el detalle no incluye imágenes ni originales');
    assert.equal(await rpc(anon, 'estilo_foto', f2.id, 'tarjeta'), IMG);
    assert.equal(await rpc(anon, 'estilo_foto', f2.id, 'original'), IMG, 'pedir «original» devuelve la versión de tarjeta, nunca el original');
    // El servicio dado de baja ya no se muestra como relacionado
    await A.query(`update servicios set activo = false where id::text = $1`, [ids.s30]);
    assert.equal((await rpc(anon, 'estilo_publico', t.id)).servicio, null);
    await A.query(`update servicios set activo = true where id::text = $1`, [ids.s30]);
});

test('sin fotos o sin confirmar la autorización no se envía; la confirmación registra quién y cuándo', async () => {
    const vacio = await estilo(barbero, { titulo: 'Sin fotos' });
    assert.equal(await errorDe(rpc(barbero, 'panel_portafolio_estado', vacio.id, 'enviar_revision', null)), 'sin_fotos');
    const persona = await estilo(barbero, { titulo: 'Con cliente', muestra_persona: true });
    await rpc(barbero, 'panel_estilo_foto_guardar', persona.id, null, foto());
    assert.equal(await errorDe(rpc(barbero, 'panel_portafolio_estado', persona.id, 'enviar_revision', null)), 'confirmacion_requerida');
    const confirmado = await estilo(barbero, { titulo: 'Con cliente', muestra_persona: true, autorizacion_confirmada: true }, persona.id);
    assert.equal(confirmado.autorizacion_confirmada_por, 'beto@x.com');
    assert.ok(confirmado.autorizacion_confirmada_en);
    await rpc(barbero, 'panel_portafolio_estado', persona.id, 'enviar_revision', null);
    // La confirmación del barbero no sustituye la autorización registrada: el administrador no puede publicar sin ella
    assert.equal(await errorDe(rpc(admin, 'panel_portafolio_estado', persona.id, 'publicar', null)), 'autorizacion_requerida');
    // Rechazo con motivo: vuelve a borrador con el motivo visible para el barbero
    assert.equal(await errorDe(rpc(admin, 'panel_portafolio_estado', persona.id, 'devolver', '')), 'motivo_requerido');
    const devuelto = await rpc(admin, 'panel_portafolio_estado', persona.id, 'devolver', 'Falta la autorización firmada');
    assert.equal(devuelto.estado, 'borrador');
    assert.equal(devuelto.motivo_estado, 'Falta la autorización firmada');
});

test('editar lo publicado crea una versión: la publicada sigue visible hasta aprobarla; sin duplicar fotos al aplicar', async () => {
    const t = await estilo(admin, { barbero_id: ids.beto, titulo: 'Mullet moderno' });
    const f = await rpc(admin, 'panel_estilo_foto_guardar', t.id, null, foto());
    await rpc(admin, 'panel_portafolio_estado', t.id, 'publicar', null);
    // El barbero no modifica directamente lo publicado
    assert.equal(await errorDe(rpc(barbero, 'panel_estilo_foto_guardar', t.id, null, foto())), 'usar_revision');
    const version = await estilo(barbero, { titulo: 'Mullet moderno (nueva versión)' }, t.id);
    assert.notEqual(version.id, t.id);
    assert.equal(version.revision_de, t.id);
    assert.equal(version.fotos.length, 1, 'la versión parte de las fotos publicadas');
    const nueva = await rpc(barbero, 'panel_estilo_foto_guardar', version.id, null, foto({ foco_y: 80 }));
    // Volver a editar reutiliza la misma versión
    assert.equal((await estilo(barbero, { titulo: 'Mullet moderno v2' }, t.id)).id, version.id);
    assert.equal((await rpc(anon, 'estilo_publico', t.id)).titulo, 'Mullet moderno', 'lo visible no cambia');
    assert.equal(await rpc(anon, 'estilo_foto', nueva.id, 'tarjeta'), null, 'las fotos de la versión no son públicas');
    assert.equal((await rpc(barbero, 'panel_portafolio_estado', version.id, 'enviar_revision', null)).estado, 'pendiente');
    const lista = await rpc(barbero, 'panel_portafolio', null, null);
    assert.ok(!lista.trabajos.some(x => x.id === version.id), 'la versión no aparece suelta');
    assert.equal(lista.trabajos.find(x => x.id === t.id).revision.estado, 'pendiente');
    assert.ok((await rpc(admin, 'panel_galeria')).pendientes.some(x => x.id === version.id && x.original_titulo === 'Mullet moderno'));
    // Aprobar: el trabajo original toma los datos y las fotos de la versión
    const aplicado = await rpc(admin, 'panel_portafolio_estado', version.id, 'publicar', null);
    assert.equal(aplicado.id, t.id);
    assert.equal(aplicado.titulo, 'Mullet moderno v2');
    const publico = await rpc(anon, 'estilo_publico', t.id);
    assert.equal(publico.fotos.length, 2);
    assert.equal(await rpc(anon, 'estilo_foto', nueva.id, 'tarjeta'), IMG);
    const fotos = (await A.query('select trabajo_id, count(*)::int n from portafolio_fotos where trabajo_id in ($1, $2) group by 1', [t.id, version.id])).rows;
    assert.deepEqual(fotos, [{ trabajo_id: t.id, n: 2 }], 'sin copias: la versión ya no conserva fotos');
    assert.equal(await rpc(anon, 'estilo_foto', f.id, 'tarjeta'), null, 'la foto sustituida ya no se sirve');
    assert.equal((await A.query('select estado from portafolio_trabajos where id = $1', [version.id])).rows[0].estado, 'archivado');
    // Retirar lo publicado lo quita de la web
    await rpc(barbero, 'panel_portafolio_estado', t.id, 'archivar', 'Ya no lo ofrezco');
    assert.equal(await rpc(anon, 'estilo_publico', t.id), null);
});

test('publicación directa, destacados en orden y configuración solo del administrador', async () => {
    assert.equal(await errorDe(rpc(barbero, 'panel_galeria_config', j({ publicacion_directa: true }))), 'no_autorizado');
    assert.equal(await errorDe(rpc(barbero, 'panel_galeria')), 'no_autorizado');
    assert.equal((await rpc(admin, 'panel_galeria')).publicacion_directa, false, 'valor inicial: con aprobación');
    await rpc(admin, 'panel_galeria_config', j({ publicacion_directa: true }));
    const d = await estilo(barbero, { titulo: 'Directo' });
    await rpc(barbero, 'panel_estilo_foto_guardar', d.id, null, foto());
    assert.equal((await rpc(barbero, 'panel_portafolio_estado', d.id, 'enviar_revision', null)).estado, 'publicado');
    // Con persona identificable y sin autorización registrada sigue yendo a revisión
    const p = await estilo(barbero, { titulo: 'Directo con cliente', muestra_persona: true, autorizacion_confirmada: true });
    await rpc(barbero, 'panel_estilo_foto_guardar', p.id, null, foto());
    assert.equal((await rpc(barbero, 'panel_portafolio_estado', p.id, 'enviar_revision', null)).estado, 'pendiente');
    // En modo directo el barbero edita lo publicado sin versión
    assert.equal((await estilo(barbero, { titulo: 'Directo editado' }, d.id)).id, d.id);
    await rpc(admin, 'panel_galeria_config', j({ publicacion_directa: false }));

    const otroT = await estilo(admin, { barbero_id: ids.caro, titulo: 'Diseño lineal' });
    await rpc(admin, 'panel_estilo_foto_guardar', otroT.id, null, foto());
    await rpc(admin, 'panel_portafolio_estado', otroT.id, 'publicar', null);
    assert.equal(await errorDe(rpc(admin, 'panel_galeria_destacados', [p.id])), 'trabajo_invalido', 'solo lo publicado se destaca');
    await rpc(admin, 'panel_galeria_destacados', [otroT.id, d.id]);
    const lista = await rpc(anon, 'estilos_publicos', null, 8, 0);
    assert.deepEqual(lista.trabajos.slice(0, 2).map(x => x.titulo), ['Diseño lineal', 'Directo editado'], 'destacados primero y en su orden');
    const filtrado = await rpc(anon, 'estilos_publicos', ids.caro, 8, 0);
    assert.deepEqual(filtrado.trabajos.map(x => x.barbero), ['Caro'], 'filtro por barbero');
    assert.equal((await rpc(anon, 'estilos_publicos', null, 1, 1)).trabajos.length, 1, 'paginado');
    // Barbero desactivado: sus trabajos dejan de verse
    await A.query(`update barberos set activo = false where id::text = $1`, [ids.caro]);
    assert.ok(!(await rpc(anon, 'estilos_publicos', null, 8, 0)).trabajos.some(x => x.barbero === 'Caro'));
    await A.query(`update barberos set activo = true where id::text = $1`, [ids.caro]);
});

test('trabajos anteriores de una imagen siguen visibles y pasan a fotos al editarlos', async () => {
    const legado = await rpc(admin, 'panel_portafolio_guardar', null, j({ barbero_id: ids.beto, titulo: 'Clásico', texto_alternativo: 'Corte clásico',
        imagen: IMG, miniatura: IMG, muestra_persona: false }));
    await rpc(admin, 'panel_portafolio_estado', legado.id, 'publicar', null);
    const visto = (await rpc(anon, 'estilos_publicos', ids.beto, 24, 0)).trabajos.find(x => x.id === legado.id);
    assert.equal(visto.portada.id, legado.id);
    assert.equal(await rpc(anon, 'estilo_foto', legado.id, 'tarjeta'), IMG);
    assert.equal((await rpc(anon, 'portafolio_publico', ids.beto, 24, 0)).trabajos.find(x => x.id === legado.id).miniatura, IMG, 'perfil intacto');
    await rpc(admin, 'panel_estilo_foto_guardar', legado.id, null, foto());
    const despues = await rpc(admin, 'panel_estilo', legado.id);
    assert.equal(despues.fotos.length, 2, 'la imagen anterior se conserva como primera foto');
    assert.equal(despues.legado, false);
});
