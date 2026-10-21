import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conCarga, progresoReserva, estadoSeguimiento } from '../../assets/motion-utils.js';
const datos=new Map();globalThis.localStorage={getItem:k=>datos.get(k)??null,setItem:(k,v)=>datos.set(k,String(v))};
const {htmlSeguimiento}=await import('../../assets/reservation-feedback.js');
function formulario(){
    const atributos=new Map();
    const boton={disabled:false,style:{minInlineSize:''},getBoundingClientRect:()=>({width:280}),setAttribute:(k,v)=>atributos.set(`b:${k}`,v),removeAttribute:k=>atributos.delete(`b:${k}`)};
    return {valores:{nombre:'Cliente',servicio:'corte-11'},boton,atributos,querySelector:()=>boton,setAttribute:(k,v)=>atributos.set(k,v),removeAttribute:k=>atributos.delete(k)};
}
test('carga: excluye doble envio, conserva tamano y valores, restaura boton al terminar',async()=>{
    const form=formulario();let terminar,envios=0;
    const operacion=conCarga(form,()=>{envios++;return new Promise(ok=>terminar=ok);});
    assert.equal(form.boton.disabled,true);assert.equal(form.boton.style.minInlineSize,'280px');
    assert.equal(form.atributos.get('aria-busy'),'true');
    await conCarga(form,()=>{envios++;});assert.equal(envios,1);
    terminar('guardada');assert.equal(await operacion,'guardada');
    assert.equal(form.boton.disabled,false);assert.equal(form.boton.style.minInlineSize,'');assert.equal(form.atributos.size,0);
    assert.deepEqual(form.valores,{nombre:'Cliente',servicio:'corte-11'});
});
test('carga: fallo libera el bloqueo y permite corregir sin perder datos',async()=>{
    const form=formulario();await assert.rejects(conCarga(form,()=>{throw new Error('fallo real');}));
    assert.equal(form.boton.disabled,false);assert.equal(form.valores.nombre,'Cliente');
    assert.equal(await conCarga(form,async()=>42),42);
});
test('progreso: solo representa datos preparados, no confirma una reserva',()=>{
    assert.equal(progresoReserva({}).fraccion,0);
    assert.equal(progresoReserva({servicio:'Corte',profesional:'Isaac'}).fraccion,.5);
    assert.equal(progresoReserva({servicio:'Corte',profesional:'Isaac',fecha:'2026-11-21',hora:'10:00',datosValidos:true}).fraccion,1);
    assert.equal(progresoReserva({profesional:'Isaac',fecha:'2026-11-21',hora:'10:00',datosValidos:true}).fraccion,0);
});
test('seguimiento: check dorado solo para confirmacion real, nunca por tiempo transcurrido',()=>{
    const base={nombre:'Cliente ficticio',servicio:'Corte',barbero:'Profesional',fecha:'21/11/2026',hora:'10:00',precio:'RD$ 450'};
    for(const datos of [{guardada:false,estado:'confirmada'},{guardada:true,estado:'pendiente'},{guardada:true,estado:'cancelada'}]){
        assert.equal(estadoSeguimiento(datos).confirmada,false);
        assert.doesNotMatch(htmlSeguimiento({...base,...datos}),/check-confirmacion/);
    }
    assert.match(htmlSeguimiento({...base,guardada:true,estado:'pendiente'}),/Pendiente de confirmación/);
    assert.match(htmlSeguimiento({...base,guardada:true,estado:'confirmada'}),/check-confirmacion/);
    assert.equal(estadoSeguimiento({guardada:true,completada:true}).paso,3);
});
