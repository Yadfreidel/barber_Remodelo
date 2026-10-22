import { inicializarPasosReserva } from './booking-wizard.js';
import { obtenerServicios } from '../models/serviceModel.js';
import { escapar } from './catalogue-ui.js';
import { obtenerConfigModulos } from '../controllers/modulosController.js';

const $ = id => document.getElementById(id);
const form = $('form-reservas');
const hero = $('inicio');
const header = document.createElement('header');
header.className = 'app-header';
header.append(hero.querySelector('.navbar'));
document.body.prepend(header);
const more = document.createElement('section');
more.id = 'mas';
more.innerHTML = `<p class="editorial-eyebrow">BARBERÍA MASTER</p><h1>Un poco más cerca</h1><p class="more-intro">Todo lo que necesitas para tu próxima visita.</p><a class="more-link" href="#contacto"><i class="fas fa-calendar-check"></i><span>Mi cita<small>Consulta tu reserva y su seguimiento</small></span><span>↗</span></a><div id="more-location"></div><div id="more-hours" class="more-panel"></div><div class="more-panel"><h2>Hablemos</h2><a class="more-link" href="https://wa.me/18292466177" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp · (829) 246-6177</a><a class="more-link" href="tel:+18292466177"><i class="fas fa-phone"></i> Llamar a la barbería</a></div><div class="more-panel"><h2>Preguntas frecuentes</h2><details><summary>¿Cómo reservo?</summary><p>Elige tu servicio, profesional y una hora disponible. Completa tus datos y confirma para guardar tu cita.</p></details><details><summary>¿Cómo gestiono mi cita?</summary><p>Conserva el enlace seguro de tu reserva. Desde allí puedes consultar el estado y las opciones disponibles para modificarla.</p></details></div>`;
document.querySelector('main').append(more);
more.querySelector('#more-location').append($('ubicacion-seccion'));
const admin = $('btn-flotante-admin');
admin.classList.add('more-link');
admin.innerHTML = '<i class="fas fa-user-shield"></i> Acceso administrativo';
more.append(admin);
const nav = document.createElement('nav');
nav.className = 'bottom-nav'; nav.setAttribute('aria-label', 'Navegación principal');
nav.innerHTML = [['inicio','house','Inicio'],['catalogo-seccion','scissors','Catálogo'],['contacto','calendar-days','Reservar'],['mas','ellipsis','Más']].map(([id,icon,label]) => `<a href="#${id}" data-view="${id}"><i class="fas fa-${icon}" aria-hidden="true"></i><span>${label}</span></a>`).join('');
document.body.append(nav);
const views = [hero, $('catalogo-seccion'), $('contacto'), more];
const wizard = inicializarPasosReserva(form);
function activeRoute() {
    const hash = location.hash.slice(1);
    return hash === 'staff-seccion' ? 'contacto' : views.some(v=>v.id===hash) ? hash : 'inicio';
}
function showRoute() {
    const route = activeRoute();
    views.forEach(view=>view.hidden=view.id!==route);
    document.body.dataset.view = route;
    nav.querySelectorAll('a').forEach(a=>{
        if(a.dataset.view===route) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
    });
    $('nav-links').classList.remove('nav-abierto');
    $('menu-toggle').classList.remove('menu-activo');
    $('menu-toggle').setAttribute('aria-expanded','false');
    window.scrollTo({top:0,behavior:'instant'});
    wizard.render();
}
function go(route) { if(location.hash===`#${route}`) showRoute(); else location.hash=route; }
window.addEventListener('hashchange',showRoute);
$('nav-links').addEventListener('click', event=>{if(event.target.closest('a')){ $('nav-links').classList.remove('nav-abierto'); $('menu-toggle').classList.remove('menu-activo'); $('menu-toggle').setAttribute('aria-expanded','false'); }});
window.addEventListener('reservar-servicio',()=>{wizard.reiniciar();go('contacto');});
const category = document.createElement('label');
category.className='category-picker';
category.innerHTML='<span>Categoría</span><select id="category-select"><option value="todos">Todos los estilos</option></select>';
document.querySelector('.catalogo-herramientas').before(category);
function categories() {
    const previous=$('category-select').value;
    $('category-select').innerHTML='<option value="todos">Todos los estilos</option>' + [...new Set(obtenerServicios().map(s=>s.categoria))].filter(Boolean).map(c=>`<option value="${escapar(c)}">${escapar(c)}</option>`).join('');
    if([...$('category-select').options].some(o=>o.value===previous))$('category-select').value=previous;
    updateHours();wizard.render();
}
function updateHours() {
    const general=obtenerConfigModulos().general;
    let text='Horario no disponible. Consulta con la barbería.';
    if(general?.hora_apertura && general?.hora_cierre){
        const now=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Santo_Domingo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
        const open=now>=general.hora_apertura && now<general.hora_cierre;
        text=`${open?'Abierto ahora':'Cerrado ahora'} · ${general.hora_apertura.slice(0,5)} – ${general.hora_cierre.slice(0,5)}`;
        $('business-status').dataset.open=String(open);
    }
    $('business-status').textContent=text;
    $('more-hours').innerHTML=`<h2>Horario del negocio</h2><p>${escapar(text)}</p>`;
}
window.addEventListener('catalogo-listo',categories);
setInterval(updateHours,60000);
showRoute();
if(new URLSearchParams(location.search).has('cita')||new URLSearchParams(location.search).has('oferta')||new URLSearchParams(location.search).has('espera'))go('contacto');
