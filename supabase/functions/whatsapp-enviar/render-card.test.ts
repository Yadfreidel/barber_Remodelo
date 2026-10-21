import { generarPng } from './render-card.ts';
import { datosTarjeta, layoutTarjeta } from '../../../assets/appointment-card.js';

Deno.test('renderizador Edge: PNG real con WASM y fuente empaquetados, inicialización reutilizable', async () => {
    for (const estado of ['pendiente', 'confirmada']) {
        const datos = datosTarjeta({ nombre: 'Cliente ficticio', servicio: 'Servicio ficticio', barbero: 'Profesional ficticio', fecha: '2026-11-21', hora: '14:30', estado }, { ficticia: true });
        const png = await generarPng(datos);
        const cabecera = [...png.slice(0, 8)].join(',');
        if (cabecera !== '137,80,78,71,13,10,26,10') throw new Error('PNG inválido');
        const vista = new DataView(png.buffer, png.byteOffset, png.byteLength);
        if (vista.getUint32(16) !== 1080 || vista.getUint32(20) !== layoutTarjeta(datos).height) throw new Error('Dimensiones incorrectas');
        if (png.length < 10000) throw new Error('PNG sin contenido suficiente');
    }
});
