import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { datosTarjeta, textoTarjeta, layoutTarjeta, svgTarjeta, enlaceGestionSeguro, anchoTextoTarjeta } from '../../../assets/appointment-card.js';
import { enviarConTarjeta, plantillaTarjeta } from './appointment-notification.js';

const cita = { id: 'CITA-123', nombre: 'Cliente ficticio', servicio: 'Corte de prueba', barbero: 'Profesional ficticio', fecha: '2026-11-21', hora: '14:30:00', estado: 'confirmada' };
const opciones = { plantillaImagen: 'cita_con_imagen', plantillaTexto: 'cita_solo_texto' };
const mensaje = { tipo: 'recordatorio', telefono: '8295550100', plantilla: 'recordatorio_cita', parametros: ['Cliente'], botones: ['CONFIRMAR:token'] };
const datos = datosTarjeta(cita);
const solicitudes = [];
function caso(cambios = {}) {
    solicitudes.length = 0;
    return { mensaje, opciones, cargarDatos: async () => datos, generarPng: async () => new Uint8Array([137]), subirMedia: async () => 'media-1', enviar: async cuerpo => { solicitudes.push(cuerpo); return { ok: true }; }, ...cambios };
}

test('tarjeta: fecha escrita, horas de 12 h, estados y opcionales reales', () => {
    assert.match(datos.fecha, /21 de noviembre de 2026/);
    assert.equal(datos.hora, '2:30 p. m.');
    assert.equal(datos.etiqueta, 'Confirmada');
    assert.match(textoTarjeta(datos), /Confirmación de cita/);
    for (const hora of ['00:00', '12:00', '23:59']) {
        const valor = datosTarjeta({ ...cita, hora }).hora;
        assert.equal(valor, { '00:00': '12:00 a. m.', '12:00': '12:00 p. m.', '23:59': '11:59 p. m.' }[hora]);
    }
    for (const estado of ['pendiente', null, 'desconocido']) {
        const d = datosTarjeta({ ...cita, estado, id: null });
        assert.equal(d.titulo, 'Solicitud recibida');
        assert.doesNotMatch(textoTarjeta(d), /está confirmada|undefined|null|Ubicación:|Referencia:/);
    }
    assert.equal(datosTarjeta({ ...cita, estado: 'cancelada' }).etiqueta, 'Cancelada');
    assert.equal(datosTarjeta({ ...cita, completada: true }).etiqueta, 'Completada');
    assert.throws(() => datosTarjeta({ ...cita, fecha: '2026-02-31' }));
    assert.throws(() => datosTarjeta({ ...cita, hora: '25:00' }));
});

test('tarjeta: zona configurada, fecha/hora locales independientes de la zona del servidor', () => {
    const d = datosTarjeta({ ...cita, instante: '2026-11-22T02:30:00Z' }, { zonaHoraria: 'America/Santo_Domingo' });
    assert.match(d.fecha, /21 de noviembre/);
    assert.equal(d.hora, '10:30 p. m.');
    const local = datosTarjeta(cita, { zonaHoraria: 'Pacific/Auckland' });
    assert.equal(local.hora, datos.hora);
    assert.equal(local.fecha, datos.fecha);
    assert.throws(() => datosTarjeta(cita, { zonaHoraria: 'No/Existe' }));
});

test('tarjeta: enlaces HTTPS sin credenciales y sin tokens en la imagen', () => {
    const token = '12345678-1234-1234-1234-123456789abc';
    const d = datosTarjeta(cita, { urlPublica: 'https://barberia.example/reservas?otro=1#contacto', token });
    assert.equal(d.enlace, `https://barberia.example/reservas?cita=${token}`);
    assert.equal(enlaceGestionSeguro('http://barberia.example', token), '');
    assert.equal(enlaceGestionSeguro('https://user:pass@barberia.example', token), '');
    assert.doesNotMatch(svgTarjeta(layoutTarjeta(d)), new RegExp(token));
});

test('tarjeta: PNG real, altura adaptable, varios servicios y nombre muy largo sin truncar', async () => {
    await initWasm(await fs.readFile(new URL('../../../node_modules/@resvg/resvg-wasm/index_bg.wasm', import.meta.url)));
    const font = await fs.readFile(new URL('../../../assets/fonts/Inter.ttf', import.meta.url));
    const largo = datosTarjeta({ ...cita, nombre: 'María Alejandra de los Ángeles Fernández Rodríguez '.repeat(3), servicios: ['Corte de demostración', 'Arreglo de barba de demostración', 'Tratamiento facial de demostración'] }, { ficticia: true });
    assert.ok(layoutTarjeta(largo).height > layoutTarjeta(datos).height);
    const layout = layoutTarjeta(largo);
    for (const e of layout.elementos.filter(e => e.tipo === 'texto')) {
        assert.ok(e.y < layout.height - 30);
        assert.ok(anchoTextoTarjeta(e.texto, e.size) <= 936);
    }
    const svg = svgTarjeta(layout);
    assert.match(svg, /DATOS FICTICIOS/);
    assert.doesNotMatch(svg, /<image/);
    const renderer = new Resvg(svg, { font: { fontBuffers: [font], defaultFontFamily: 'Inter' } });
    try {
        const image = renderer.render();
        try {
            const png = image.asPng();
            assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
            assert.equal(image.width, 1080);
            assert.equal(image.height, layout.height);
            // Solo datos ficticios, artefactos locales para inspección visual.
            if (process.env.TARJETA_QA_DIR) {
                await fs.mkdir(process.env.TARJETA_QA_DIR, { recursive: true });
                await fs.writeFile(`${process.env.TARJETA_QA_DIR}/tarjeta-larga.png`, png);
                await fs.writeFile(`${process.env.TARJETA_QA_DIR}/tarjeta-larga.svg`, svg);
            }
        } finally { image.free(); }
    } finally { renderer.free(); }
    const malicioso = datosTarjeta({ ...cita, nombre: '<script>alert(1)</script>' });
    assert.doesNotMatch(svgTarjeta(layoutTarjeta(malicioso)), /<script>/);
});

test('notificación: una sola llamada con imagen, texto y botones, mismo destinatario', async () => {
    await enviarConTarjeta(caso());
    assert.equal(solicitudes.length, 1);
    const payload = solicitudes[0];
    assert.equal(payload.to, '18295550100');
    assert.equal(payload.template.components[0].parameters[0].image.id, 'media-1');
    assert.equal(payload.template.components[1].parameters[0].text, datos.negocio);
    assert.equal(payload.template.components[2].parameters[0].payload, 'CONFIRMAR:token');
});

test('notificación: fallos de generación y subida conservan texto sin doble envío', async () => {
    for (const fase of ['generarPng', 'subirMedia', 'cargarDatos']) {
        await enviarConTarjeta(caso({ [fase]: async () => { throw new Error('fallo simulado'); } }));
        assert.equal(solicitudes.length, 1);
        assert.notEqual(solicitudes[0].template.name, opciones.plantillaImagen);
    }
});

test('notificación: solo el rechazo explícito de medios permite texto; timeout y 5xx no duplican', async () => {
    let llamadas = 0;
    await enviarConTarjeta(caso({ enviar: async () => { llamadas++; return llamadas === 1 ? { ok: false, codigo: 131053 } : { ok: true }; } }));
    assert.equal(llamadas, 2);
    llamadas = 0;
    await assert.rejects(enviarConTarjeta(caso({ enviar: async () => { llamadas++; throw new Error('timeout ambiguo'); } })));
    assert.equal(llamadas, 1);
    llamadas = 0;
    await enviarConTarjeta(caso({ enviar: async () => { llamadas++; return { ok: false, status: 500 }; } }));
    assert.equal(llamadas, 1);
});

test('notificación: configuración ausente preserva plantilla actual; cita cancelada no se envía', async () => {
    await enviarConTarjeta(caso({ opciones: {}, cargarDatos: () => { throw new Error('No debe leerse'); } }));
    assert.equal(solicitudes.length, 1);
    assert.equal(solicitudes[0].template.name, mensaje.plantilla);
    const resultado = await enviarConTarjeta(caso({ cargarDatos: async () => ({ cancelada: true }) }));
    assert.equal(resultado.omitido, true);
    assert.equal(solicitudes.length, 0);
    assert.equal(plantillaTarjeta(mensaje, { ...datos, nombre: 'x'.repeat(2000) }, opciones, 'media'), null);
});
import { cargarLogoTarjeta } from '../../../assets/card-logo.js';

test('logo: ausente o fuera del sitio se omite; PNG local se incluye sin credenciales', async () => {
    let solicitudesLogo = 0;
    const fetchLogo = async (_url, init) => {
        solicitudesLogo++;
        assert.equal(init.credentials, 'omit');
        assert.equal(init.redirect, 'error');
        return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { status: 200 });
    };
    assert.equal(await cargarLogoTarjeta('', 'https://barberia.example', fetchLogo), '');
    assert.equal(await cargarLogoTarjeta('https://otro.example/logo.png', 'https://barberia.example', fetchLogo), '');
    assert.equal(solicitudesLogo, 0);
    assert.match(await cargarLogoTarjeta('/logo.png', 'https://barberia.example', fetchLogo), /^data:image\/png;base64,/);
    assert.equal(await cargarLogoTarjeta('/logo.svg', 'https://barberia.example', async () => new Response('<svg/>')), '');
    assert.equal(await cargarLogoTarjeta('/logo.png', 'https://barberia.example', async () => { throw new Error('sin logo'); }), '');
});

test('notificación: rechazo HTTP 400 intenta texto una vez; 429 conserva la cola', async () => {
    let llamadas = 0;
    await enviarConTarjeta(caso({ enviar: async () => { llamadas++; return llamadas === 1 ? { ok: false, status: 400 } : { ok: true }; } }));
    assert.equal(llamadas, 2);
    llamadas = 0;
    const respuesta = await enviarConTarjeta(caso({ enviar: async () => { llamadas++; return { ok: false, status: 429 }; } }));
    assert.equal(llamadas, 1);
    assert.equal(respuesta.status, 429);
});
