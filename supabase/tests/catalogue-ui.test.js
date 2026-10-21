import { test } from 'node:test';
import assert from 'node:assert/strict';
const memoria=new Map();
globalThis.localStorage={getItem:k=>memoria.get(k)??null,setItem:(k,v)=>memoria.set(k,String(v))};
const {coincideCorte,contenidoDetalle,conectarDetalles,fotoCorte}=await import('../../assets/catalogue-ui.js');
const {CATALOGO_25}=await import('../../models/catalogo25.js');

test('catalogo editorial: busqueda sin acentos y filtros combinados, sin modificar servicios',()=>{
    const antes=JSON.stringify(CATALOGO_25);
    assert.ok(coincideCorte(CATALOGO_25[9],'todos','CESAR'));
    assert.ok(!coincideCorte(CATALOGO_25[9],'degradados','cesar'));
    assert.equal(CATALOGO_25.filter(s=>coincideCorte(s,'tapers','')).length,2);
    assert.equal(CATALOGO_25.filter(s=>coincideCorte(s,'todos','inexistente')).length,0);
    assert.equal(JSON.stringify(CATALOGO_25),antes);
});
test('detalles: datos reales completos, imagen sin reemplazos ficticios y texto escapado',()=>{
    const html=contenidoDetalle(CATALOGO_25[16]);
    assert.match(html,/Mullet rizado suave/);assert.match(html,/RD\$ 800/);assert.match(html,/60 minutos/);
    assert.ok(html.includes(CATALOGO_25[16].cuidado));
    assert.match(fotoCorte({...CATALOGO_25[0],imagen:''}),/Fotografía no disponible/);
    assert.doesNotMatch(contenidoDetalle({...CATALOGO_25[0],nombre:'<script>malicioso</script>'}),/<script>/);
});
test('panel: abrir y cerrar conserva seleccion; elegir invoca una sola vez el evento actual',()=>{
    class Nodo {
        constructor(){this.handlers={};this.clases=new Set();this.classList={add:x=>this.clases.add(x),remove:x=>this.clases.delete(x)};}
        addEventListener(tipo,fn){this.handlers[tipo]=fn;}
        emitir(tipo,evento={}){this.handlers[tipo]?.(evento);}
    }
    const grid=new Nodo(),dialogo=new Nodo(),contenido=new Nodo(),cerrar=new Nodo(),body=new Nodo();
    let seleccion='otra seleccion',clics=0,foco=0;
    dialogo.showModal=()=>dialogo.abierto=true;
    dialogo.close=()=>{dialogo.abierto=false;dialogo.emitir('close');};
    const origen={dataset:{detalle:'corte-01'},closest:s=>s==='[data-detalle]'?origen:null,focus:()=>foco++};
    const eleccion={closest:s=>s==='.btn-detalle-elegir'?eleccion:null};
    const boton={dataset:{nombre:CATALOGO_25[0].nombre},click:()=>{clics++;seleccion=boton.dataset.nombre;}};
    const nodos={'grid-dinamico-servicios':grid,'detalle-corte':dialogo,'detalle-contenido':contenido,'detalle-cerrar':cerrar};
    const dom={body,getElementById:id=>nodos[id],querySelectorAll:()=>[boton],addEventListener:()=>{}};
    conectarDetalles(()=>CATALOGO_25,dom);
    grid.emitir('click',{target:origen});assert.ok(dialogo.abierto);assert.equal(seleccion,'otra seleccion');
    cerrar.emitir('click');assert.equal(seleccion,'otra seleccion');assert.equal(clics,0);assert.equal(foco,1);
    grid.emitir('click',{target:origen});dialogo.emitir('click',{target:eleccion});
    assert.equal(clics,1);assert.equal(seleccion,CATALOGO_25[0].nombre);assert.ok(!dialogo.abierto);assert.equal(body.clases.size,0);
});
