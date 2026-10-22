import { progresoReserva } from './motion-utils.js';
const preferencia=window.matchMedia('(prefers-reduced-motion: reduce)');
const vistos=new WeakSet();
const tiempo=(nombre,respaldo)=>parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue(nombre))||respaldo;
let observador;
const entrada=(elemento,demora=0)=>{
    if(vistos.has(elemento))return;
    vistos.add(elemento);
    if(preferencia.matches||!elemento.animate)return;
    try { elemento.animate([{opacity:.45,translate:'0 12px'},{opacity:1,translate:'0 0'}],{duration:tiempo('--motion-enter',340),delay:demora,easing:'cubic-bezier(.22,.61,.36,1)'}); } catch { /* Visible y utilizable sin animacion. */ }
};
const candidatos='.card-servicio,.card-barbero,.seccion-titulo,.seccion-subtitulo,.formulario-citas,.tracking-contenedor:not(.ocultar-tracking),.admin-tab-contenido,.admin-form,.login-admin-caja,.panel-gestion,.catalogo-estado:not([hidden]),.resumen-alerta,.resumen-ok';
function observar(raiz=document) {
    const nodos=[...(raiz.matches?.(candidatos)?[raiz]:[]),...raiz.querySelectorAll(candidatos)];
    for(const nodo of nodos){if(!vistos.has(nodo)){if(observador)observador.observe(nodo);else entrada(nodo);}}
}
function actualizarProgreso(){
    const barra=document.getElementById('progreso-reserva');
    if(!barra)return;
    const valor=id=>document.getElementById(id)?.value.trim()||'';
    const datosValidos=['nombre','telefono'].every(id=>{const campo=document.getElementById(id);return campo?.value.trim()&&campo.validity.valid;});
    const progreso=progresoReserva({servicio:valor('servicio-select'),profesional:valor('barbero-seleccionado'),fecha:valor('fecha'),hora:valor('hora-seleccionada'),datosValidos});
    barra.setAttribute('aria-valuenow',String(progreso.completos));
    barra.setAttribute('aria-valuetext',`${progreso.completos} de 4 pasos preparados`);
    barra.style.setProperty('--progreso',progreso.fraccion);
    if (document.getElementById('form-reservas')?.dataset.step !== undefined) return;
    document.querySelectorAll('.pasos-reserva li').forEach((paso,i)=>{
        paso.dataset.completo=String(progreso.pasos[i]);
        if(i===progreso.completos)paso.setAttribute('aria-current','step');else paso.removeAttribute('aria-current');
    });
}
function indicadores(){
    document.querySelectorAll('.filtros-contenedor,.admin-tabs,.admin-filtros-mini').forEach(grupo=>{
        const activo=grupo.querySelector('.activo,.tab-activa');
        if(!activo)return;
        const marco=grupo.getBoundingClientRect(),rect=activo.getBoundingClientRect();
        grupo.dataset.indicador='';
        grupo.style.setProperty('--indicador-x',`${rect.left-marco.left}px`);
        grupo.style.setProperty('--indicador-y',`${rect.bottom-marco.top+2}px`);
        grupo.style.setProperty('--indicador-ancho',String(rect.width));
    });
}
function iniciar(){
    if('IntersectionObserver' in window){
        observador=new IntersectionObserver(entradas=>{for(const e of entradas){if(e.isIntersecting){const hermanos=[...e.target.parentElement.children];entrada(e.target,e.target.matches('.card-servicio,.card-barbero')?(hermanos.indexOf(e.target)%4)*35:0);observador.unobserve(e.target);}}},{threshold:.1});
    }
    observar();actualizarProgreso();indicadores();
    window.addEventListener('resize',indicadores,{passive:true});
    document.fonts?.ready.then(indicadores);
    new MutationObserver(registros=>{
        for(const r of registros){
            if(r.type==='childList')for(const n of r.addedNodes)if(n.nodeType===1)observar(n);
            if(r.type==='attributes'&&r.attributeName==='class'&&r.target.matches('.tracking-contenedor:not(.ocultar-tracking),.admin-tab-contenido'))observar(r.target);
        }
        indicadores();
    }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    for(const tipo of ['input','change','click','reset'])document.addEventListener(tipo,()=>queueMicrotask(()=>{actualizarProgreso();indicadores();}));
    document.addEventListener('invalid',evento=>{
        const campo=evento.target;campo.classList.add('campo-invalido');

    },true);
    document.addEventListener('input',evento=>{if(evento.target.validity?.valid)evento.target.classList.remove('campo-invalido');});
    preferencia.addEventListener('change',()=>{if(preferencia.matches)document.getAnimations?.().forEach(a=>a.cancel());});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciar,{once:true});else iniciar();
