import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';
import { layoutTarjeta, svgTarjeta } from '../../../assets/appointment-card.js';

let preparado: Promise<void> | undefined;
let fuente: Uint8Array;
export async function generarPng(datos: Record<string, unknown>) {
    preparado ??= (async () => {
        const [wasm, font] = await Promise.all([
            Deno.readFile(new URL('./card-assets/resvg.wasm', import.meta.url)),
            Deno.readFile(new URL('./card-assets/Inter.ttf', import.meta.url))
        ]);
        await initWasm(wasm);
        fuente = font;
    })();
    await preparado;
    const renderer = new Resvg(svgTarjeta(layoutTarjeta(datos, typeof datos.logoData === 'string' ? datos.logoData : '')), {
        font: { fontBuffers: [fuente], defaultFontFamily: 'Inter' }
    });
    try {
        const imagen = renderer.render();
        try { return imagen.asPng().slice(); } finally { imagen.free(); }
    } finally { renderer.free(); }
}
