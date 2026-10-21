import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { CATALOGO_25 } from '../../models/catalogo25.js';

const precios = [600,600,600,550,600,700,650,650,600,500,450,500,600,700,750,750,800,750,650,650,700,700,650,700,750];
const minutos = [40,40,40,35,40,45,45,45,40,30,30,30,40,50,50,50,60,50,45,45,45,45,45,50,50];
test('cliente: 25 tarifas exactas, persistencia sin duplicados y resumen que reemplaza precio/duracion', async () => {
    const memoria = new Map();
    const anterior = { id:'anterior', nombre:'Servicio previo', precio:'RD$ 123', categoria:'cortes' };
    memoria.set('barber_servicios_data',JSON.stringify([anterior]));
    globalThis.localStorage = { getItem: k=>memoria.get(k)??null, setItem:(k,v)=>memoria.set(k,String(v)) };
    const elementos = Object.fromEntries(['servicio-select','barbero-seleccionado','fecha','hora-seleccionada','resumen-precio'].map(k=>[k,{value:'',innerHTML:''}]));
    globalThis.document = { getElementById:k=>elementos[k]??null, querySelectorAll:()=>[] };
    const filas = CATALOGO_25.map((s,i)=>({id:1000+i,catalogo_id:s.id,nombre:s.nombre,precio:String(s.precio),duracion_minutos:s.duracion_minutos}));
    const cliente = { rpc: async (fn,p) => {
        if(fn==='config_publica')return{data:{instalado:true,modulos:{}},error:null};
        const servicio = filas.find(s=>String(s.id)===p.p_servicio);
        assert.ok(servicio,'la cotizacion debe usar la referencia del registro importado');
        if(fn==='cotizar_cita')return{data:{precio_base:Number(servicio.precio),precio_final:Number(servicio.precio),descuento:0,duracion_minutos:servicio.duracion_minutos,disponible:true},error:null};
        return{data:[],error:null};
    }};
    globalThis.window = {supabase:{createClient:()=>cliente}};
    const modelo = await import('../../models/serviceModel.js');
    const modulo = await import('../../controllers/modulosController.js');
    for(let vuelta=0;vuelta<2;vuelta++) {
        const servicios = modelo.obtenerServicios();assert.equal(servicios.length,25);
        for(const [i,s] of servicios.entries()) { assert.equal(s.precio,precios[i]);assert.equal(s.duracion_minutos,minutos[i]); }
        assert.deepEqual(modelo.obtenerServicios({incluirAnteriores:true}).find(s=>s.id==='anterior'),anterior);
    }
    modelo.sincronizarCatalogoServidor(filas);
    await modulo.cargarConfigModulos();
    assert.equal(modulo.usarReservaServidor(),true,'la duracion se valida aunque no haya extras activos');
    for(const indice of [10,16,10]) {
        elementos['servicio-select'].value=CATALOGO_25[indice].nombre;
        elementos['barbero-seleccionado'].value='';
        await modulo.actualizarResumen();
        assert.ok(elementos['resumen-precio'].innerHTML.includes(`RD$ ${precios[indice]}`));
        assert.ok(elementos['resumen-precio'].innerHTML.includes(`${minutos[indice]} min`));
        elementos['barbero-seleccionado'].value='Isaac Garcia';elementos.fecha.value='2026-11-21';elementos['hora-seleccionada'].value='10:00';
        await modulo.actualizarResumen();
        assert.ok(elementos['resumen-precio'].innerHTML.includes(`RD$ ${precios[indice]}`));
        assert.ok(elementos['resumen-precio'].innerHTML.includes(`${minutos[indice]} min`));
        assert.ok(!elementos['resumen-precio'].innerHTML.includes('1,250'));
    }
});

test('imagenes: un archivo por ID, con trazabilidad al catalogo original', () => {
    const manifiesto=JSON.parse(fs.readFileSync(new URL('../../assets/catalogo/imagenes-origen.json',import.meta.url),'utf8'));
    assert.equal(manifiesto.length,25);
    for(const corte of CATALOGO_25) {
        assert.equal(corte.imagen,`assets/imagenes/catalogo/${corte.id}.webp`);
        const imagen=fs.readFileSync(new URL(`../../${corte.imagen}`,import.meta.url));
        const entrada=manifiesto.find(m=>m.id===corte.id);
        assert.equal(entrada.original,`imagenes/${corte.id}.png`);
        assert.equal(crypto.createHash('sha256').update(imagen).digest('hex'),entrada.sha256_webp);
    }
});
