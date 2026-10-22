import { inicializarInicioInmersivo } from './home-view.js';
import { crearVistaMas } from './more-view.js';
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
const more = crearVistaMas();
document.querySelector('main').append(more);
const nav = document.createElement('nav');
nav.className = 'bottom-nav'; nav.setAttribute('aria-label', 'Navegación principal');
nav.innerHTML = [['inicio','house','Inicio'],['catalogo-seccion','scissors','Catálogo'],['contacto','calendar-days','Reservar'],['mas','ellipsis','Más']].map(([id,icon,label]) => `<a href="#${id}" data-view="${id}"><i class="fas fa-${icon}" aria-hidden="true"></i><span>${label}</span></a>`).join('');
document.body.append(nav);
inicializarInicioInmersivo(hero, header);
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
    const horarioInicio = $('home-hours');
    if (horarioInicio) {
        horarioInicio.textContent = general?.hora_apertura && general?.hora_cierre
            ? `Hoy: ${general.hora_apertura.slice(0,5)} – ${general.hora_cierre.slice(0,5)}`
            : 'Horario no disponible';
        $('home-open-state').textContent = $('business-status').dataset.open === 'true'
            ? 'Estamos abiertos' : general?.hora_apertura ? 'Estamos cerrados' : 'Consulta con la barbería';
    } else $('business-status').textContent = text;
    $('more-hours').innerHTML=`<h2 id="more-hours-title"><i class="fas fa-clock" aria-hidden="true"></i> Horarios</h2><p>${escapar(text)}</p><small>Hora local de la barbería</small>`;
}
window.addEventListener('catalogo-listo',categories);
setInterval(updateHours,60000);
showRoute();
if(new URLSearchParams(location.search).has('cita')||new URLSearchParams(location.search).has('oferta')||new URLSearchParams(location.search).has('espera'))go('contacto');
