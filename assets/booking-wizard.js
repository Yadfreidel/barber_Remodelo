import { iniciarSelectorServicios } from './booking-service-picker.js';
import { obtenerServicios, formatoPrecioServicio } from '../models/serviceModel.js';
import { escapar } from './catalogue-ui.js';
import { rango12h, sumarMinutos } from './horario-utils.js';

// Los campos son la fuente de selección compartida con los controladores existentes.
export function inicializarPasosReserva(form) {
    const $ = id => document.getElementById(id);
    const fieldGroups = [form.querySelector('.reserva-servicio'), $('staff-seccion'), form.querySelector('.calendario-contenedor'), form.querySelector('.reserva-datos')];
    fieldGroups[3].append($('booking-notes'));
    iniciarSelectorServicios(fieldGroups[0], $('servicio-select'));
    const submit = form.querySelector('[type=submit]');
    const labels = ['Servicio', 'Barbero', 'Horario', 'Tus datos'];
    form.querySelectorAll('.pasos-reserva li').forEach((li,i)=>li.textContent=labels[i]);
    form.noValidate = true;
    let step = 0;
    function summary() {
        const service = obtenerServicios().find(s=>s.nombre===$('servicio-select').value);
        $('booking-summary').innerHTML = `<p class="editorial-eyebrow">TU PRÓXIMA VISITA</p><h3>${escapar(service?.nombre || 'Selecciona un servicio')}</h3><dl>${[['Barbero',$('barbero-seleccionado').value],['Fecha',$('fecha').value],['Hora',$('hora-seleccionada').value && rango12h($('hora-seleccionada').value, service?.duracion_minutos ? sumarMinutos($('hora-seleccionada').value, service.duracion_minutos) : null)],['Duración',service?.duracion_minutos ? `${service.duracion_minutos} min` : 'Consultar'],['Precio', service ? formatoPrecioServicio(service.precio) : '—']].map(([label,value])=>`<div><dt>${label}</dt><dd>${escapar(value || '—')}</dd></div>`).join('')}</dl>`;
    }
    function renderStep() {
        fieldGroups.forEach((group,i)=> group.hidden=i!==step);
        $('step-back').hidden=step===0;
        $('step-next').hidden=step===3;
        submit.hidden=step!==3;
        const extras=$('modulos-reserva'); if(extras) extras.hidden=step!==3;
        const waiting=form.querySelector('.bloque-lista-espera'); if(waiting) waiting.hidden=step!==2;
        form.dataset.step=step;
        form.querySelector('.form-subtitulo').textContent=`Paso ${step+1} de 4 · ${labels[step]}`;
        form.querySelectorAll('.pasos-reserva li').forEach((li,i)=>{
            li.classList.toggle('step-active',i===step);
            if(i===step)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');
        });
        summary();
    }
    const CAMPOS = [['servicio-select'],['barbero-seleccionado'],['fecha','hora-seleccionada'],['nombre','telefono']];
    const completo = i => CAMPOS[i].every(id=>$(id).value.trim() && $(id).checkValidity());
    function stepValid() {
        const ids = CAMPOS[step];
        const valid = ids.every(id=>$(id).value.trim() && $(id).checkValidity());
        $('wizard-error').textContent=valid?'':['Elige un servicio para continuar.','Selecciona tu barbero.','Elige una fecha y una hora disponible.','Completa tu nombre y un número de WhatsApp válido.'][step];
        if(!valid) ids.map($).find(el=>!el.value.trim()||!el.checkValidity())?.focus();
        return valid;
    }
    $('step-next').addEventListener('click',()=>{ if(stepValid()){step++;renderStep();form.querySelector('.form-titulo').focus({preventScroll:true});}});
    $('step-back').addEventListener('click',()=>{step=Math.max(0,step-1);$('wizard-error').textContent='';renderStep();});
    form.addEventListener('submit',event=>{
        if(step!==3 || !stepValid()) {event.preventDefault();event.stopImmediatePropagation();}
    },true);
    form.addEventListener('reset',()=>{ step=0;queueMicrotask(renderStep); });
    document.addEventListener('change',summary);
    return { render: renderStep, reiniciar() { step=0; renderStep(); },
        // Retoma un borrador en el primer paso que falta completar
        retomar() { step=[0,1,2].find(i=>!completo(i)) ?? 3; renderStep(); } };
}
