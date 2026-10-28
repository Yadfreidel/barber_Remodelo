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
        const politicas=$('politicas-reserva'); if(politicas) politicas.dataset.paso=String(step===3);
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
    // Mensaje propio de cada campo visible, asociado con aria-describedby (los ocultos usan el aviso general)
    const ERRORES = {
        nombre: el => !el.value.trim() ? 'Escribe tu nombre.' : 'Tu nombre debe tener al menos 3 caracteres.',
        telefono: el => !el.value.trim() ? 'Escribe tu número de WhatsApp.' : 'Revisa el número: usa de 7 a 20 caracteres entre dígitos, espacios, +, guiones o paréntesis.',
        fecha: () => 'Elige una fecha.'
    };
    function errorCampo(el, texto) {
        if (!ERRORES[el.id]) return;
        let nota = document.getElementById(`${el.id}-error`);
        if (!nota && texto) {
            nota = document.createElement('p');
            nota.id = `${el.id}-error`;
            nota.className = 'campo-error';
            (el.closest('.form-group') || el).after(nota);
        }
        if (nota) nota.textContent = texto;
        if (texto) { el.setAttribute('aria-invalid', 'true'); el.setAttribute('aria-describedby', nota.id); }
        else { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); }
    }
    form.addEventListener('input', e => { if (ERRORES[e.target.id] && e.target.checkValidity() && e.target.value.trim()) errorCampo(e.target, ''); });
    form.addEventListener('change', e => { if (e.target.id === 'fecha' && e.target.value) errorCampo(e.target, ''); });
    function stepValid() {
        const ids = CAMPOS[step];
        const invalidos = ids.map($).filter(el=>!el.value.trim()||!el.checkValidity());
        const valid = !invalidos.length;
        ids.map($).forEach(el => errorCampo(el, invalidos.includes(el) ? ERRORES[el.id]?.(el) : ''));
        $('wizard-error').textContent=valid?'':['Elige un servicio para continuar.','Selecciona tu barbero.','Elige una fecha y una hora disponible.','Completa tu nombre y un número de WhatsApp válido.'][step];
        if(!valid) {
            // Un campo oculto no recibe foco: se lleva al control que lo rellena
            const primero = invalidos[0];
            const destino = primero.type !== 'hidden' ? primero
                : primero.id === 'hora-seleccionada' ? form.querySelector('#contenedor-horas .pildora-hora:not(.deshabilitada)') || $('fecha')
                : primero.id === 'barbero-seleccionado' ? form.querySelector('.btn-seleccionar-barbero') : null;
            destino?.focus();
        }
        return valid;
    }
    window.addEventListener('ir-paso-reserva', e => { step = Math.max(0, Math.min(3, Number(e.detail) || 0)); $('wizard-error').textContent = ''; renderStep(); });
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
