import { estadoSeguimiento } from './motion-utils.js';
import { escapar as esc } from './catalogue-ui.js';
export function htmlSeguimiento(datos) {
    const estado=estadoSeguimiento(datos);
    const pasos=['Solicitud guardada','Confirmacion de la barberia','Visita completada'];
    return `<div class="tracking-header" role="status">
        ${estado.confirmada ? '<div class="check-confirmacion" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M12 25l8 8 17-20"/></svg></div>' : '<div class="estado-solicitud" aria-hidden="true">&#9671;</div>'}
        <h3 tabindex="-1">${estado.titulo}</h3><p>${esc(datos.nombre)}, ${estado.etiqueta.toLocaleLowerCase('es')}.</p>
        </div>
        <div class="resumen-ticket"><div>${esc(datos.servicio)}</div><div>Profesional: ${esc(datos.barbero)}</div><div>${esc(datos.fecha)} · ${esc(datos.hora)}</div></div>
        <ol class="seguimiento-real" aria-label="Estado de la cita">${pasos.map((paso,i)=>`<li data-completo="${i<estado.paso}" ${i===Math.max(0,estado.paso-1)?'aria-current="step"':''}>${paso}</li>`).join('')}</ol>
        <div class="seguimiento-progreso" style="--progreso:${estado.paso/3}" aria-hidden="true"><span></span></div>
        <div id="contenedor-ticket-wallet">
            <div class="ticket-wallet-card"><div class="ticket-wallet-header"><span>BARBER PASS</span><span>${esc(estado.etiqueta)}</span></div>
            <div class="ticket-wallet-body"><div class="ticket-row"><div><label>CLIENTE</label><p>${esc(datos.nombre)}</p></div><div><label>SERVICIO</label><p>${esc(datos.servicio)}</p></div></div>
            <div class="ticket-row"><div><label>FECHA / HORA</label><p>${esc(datos.fecha)} · ${esc(datos.hora)}</p></div><div><label>PROFESIONAL</label><p>${esc(datos.barbero)}</p></div></div>
            <div class="ticket-row"><div><label>TOTAL ESTIMADO</label><p class="ticket-precio">${esc(datos.precio)}</p></div><div><label>ESTADO</label><p>${esc(estado.etiqueta)}</p></div></div></div>
            ${datos.guardada ? '<div class="ticket-wallet-qrcode-zone"><div id="qrcode-canvas"></div><p class="ticket-qr-instruction">Datos de tu solicitud. El estado indicado corresponde a la reserva guardada.</p></div>' : ''}</div>
        </div>
        ${(datos.avisos||[]).map(a=>`<p class="resumen-alerta">${esc(a)}</p>`).join('')}
        ${datos.token?`<a class="btn-regresar-form enlace-gestion" href="?cita=${encodeURIComponent(datos.token)}">Gestionar mi cita (confirmar, cancelar o reprogramar)</a>`:''}
        <button type="button" id="btn-regresar-formulario" class="btn-regresar-form">Volver / Nueva cita</button>`;
}
export function mostrarSeguimiento(contenedor,datos,alVolver,{enfocar=false}={}) {
    const activo=document.activeElement;
    const recuperar=contenedor.contains(activo);
    const selector=activo?.id ? `#${activo.id}` : activo?.tagName==='A' ? '.enlace-gestion' : 'h3';
    contenedor.innerHTML=htmlSeguimiento(datos);
    contenedor.querySelector('#btn-regresar-formulario').addEventListener('click',alVolver);
    if(enfocar||recuperar)(contenedor.querySelector(enfocar?'h3':selector)||contenedor.querySelector('h3')).focus({preventScroll:true});
    const qr=contenedor.querySelector('#qrcode-canvas');
    if(qr){
        if(typeof globalThis.QRCode!=='undefined'){
            try {new globalThis.QRCode(qr,{text:`${estadoSeguimiento(datos).titulo}\n${datos.nombre}\n${datos.servicio}\n${datos.barbero}\n${datos.fecha} ${datos.hora}\n${datos.precio}`,width:140,height:140,colorDark:'#0b0c0b',colorLight:'#ffffff',correctLevel:globalThis.QRCode.CorrectLevel.H});}
            catch {qr.textContent='Consulta los datos de tu solicitud arriba.';}
        } else qr.textContent='Datos de tu solicitud disponibles arriba.';
    }
}
