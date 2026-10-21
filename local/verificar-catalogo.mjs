import {SUPABASE_URL,SUPABASE_ANON_KEY} from '../assets/config.js';
if (!['localhost','127.0.0.1'].includes(new URL(SUPABASE_URL).hostname)) throw new Error('Esta verificacion es solo para el backend local');
const fecha=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const headers={apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`,'Content-Type':'application/json'};
async function api(ruta,body){const r=await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw new Error(`${r.status}: ${d.message}`);return d;}
const cortes=await api('servicios?catalogo_id=not.is.null&select=id,catalogo_id,precio,duracion_minutos&order=catalogo_id');
if(cortes.length!==25)throw new Error('Cantidad incorrecta');
const barberos=await api('barberos?activo=eq.true&select=nombre&limit=1');
const resultados=[];
for(const id of ['corte-11','corte-17','corte-11']){
 const s=cortes.find(c=>c.catalogo_id===id);
 const q=await api('rpc/cotizar_cita',{p_servicio:String(s.id),p_barbero:barberos[0].nombre,p_fecha:fecha,p_hora:'12:00'});
 resultados.push({id,precio:Number(q.precio_final),minutos:q.duracion_minutos});
}
console.log('API local:',cortes.length,'cortes. Cotizaciones sin crear citas:',JSON.stringify(resultados));
