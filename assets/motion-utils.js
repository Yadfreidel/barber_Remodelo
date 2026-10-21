// Utilidades visuales. Nunca crean reservas ni asignan estados de negocio.
const pendientes=new WeakSet();
export async function conCarga(formulario,accion) {
    if(pendientes.has(formulario))return;
    pendientes.add(formulario);
    const boton=formulario.querySelector('button[type="submit"]');
    const deshabilitado=boton?.disabled;
    const minAnterior=boton?.style.minInlineSize || '';
    try {
        formulario.setAttribute('aria-busy','true');
        if(boton){
            const ancho=boton.getBoundingClientRect?.().width;
            if(ancho)boton.style.minInlineSize=`${ancho}px`;
            boton.disabled=true;boton.setAttribute('aria-busy','true');
        }
        return await accion();
    } finally {
        pendientes.delete(formulario);
        formulario.removeAttribute('aria-busy');
        if(boton){boton.disabled=deshabilitado;boton.removeAttribute('aria-busy');boton.style.minInlineSize=minAnterior;}
    }
}
export function progresoReserva(campos) {
    const pasos=[Boolean(campos.servicio),Boolean(campos.profesional),Boolean(campos.fecha&&campos.hora),Boolean(campos.datosValidos)];
    let completos=0;for(const listo of pasos){if(!listo)break;completos++;}
    return {pasos,completos,fraccion:completos/4};
}
export function estadoSeguimiento(datos) {
    if(!datos.guardada)return {titulo:'Solicitud preparada',etiqueta:'Sin confirmación de guardado',paso:0,confirmada:false};
    if(datos.estado==='cancelada')return {titulo:'Cita cancelada',etiqueta:'Cancelada',paso:0,confirmada:false};
    if(datos.completada)return {titulo:'Visita completada',etiqueta:'Completada',paso:3,confirmada:true};
    if(datos.estado==='confirmada')return {titulo:'Cita confirmada',etiqueta:'Confirmada por la barbería',paso:2,confirmada:true};
    return {titulo:'Solicitud registrada',etiqueta:'Pendiente de confirmación',paso:1,confirmada:false};
}
