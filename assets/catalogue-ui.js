// Capa editorial: reutiliza el boton de seleccion existente, sin escribir reservas.
import { formatoPrecioServicio } from '../models/serviceModel.js';
export const escapar = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const normalizarBusqueda = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
export function coincideCorte(servicio, categoria, busqueda) {
    return (categoria === 'todos' || categoria === servicio.categoria) && normalizarBusqueda(`${servicio.nombre} ${servicio.descripcion} ${servicio.categoria}`).includes(normalizarBusqueda(busqueda).trim());
}
export function fotoCorte(servicio, ampliada = false) {
    return `<div class="foto-corte ${servicio.imagen ? '' : 'foto-ausente'}">
        ${servicio.imagen ? `<img src="${escapar(servicio.imagen)}" alt="${escapar(servicio.alt || servicio.nombre)}" width="1024" height="1024" loading="${ampliada ? 'eager' : 'lazy'}" decoding="async">` : ''}
        <span class="foto-placeholder" ${servicio.imagen ? 'hidden' : ''}>Fotografía no disponible</span></div>`;
}
export function contenidoDetalle(s) {
    const filas = [['Indicaciones para el barbero',s.indicaciones_barbero],['Largo superior orientativo',s.largo_superior_orientativo],['Cuidados',s.cuidado],['Repaso orientativo',s.repaso_orientativo]];
    return `${fotoCorte(s,true)}<div class="detalle-informacion">
        <p class="editorial-eyebrow">${escapar(s.categoria)}</p>
        <h2 id="detalle-titulo">${escapar(s.nombre)}</h2>
        <p class="detalle-descripcion">${escapar(s.descripcion)}</p>
        <p class="detalle-tarifa"><strong>${escapar(formatoPrecioServicio(s.precio))}</strong>${s.duracion_minutos ? `<span>${Number(s.duracion_minutos)} minutos</span>` : ''}</p>
        <p class="detalle-nota">Solo corte. Sin barba, lavado ni extras.</p>
        <dl>${filas.filter(([,valor])=>valor).map(([label,valor])=>`<div><dt>${label}</dt><dd>${escapar(valor)}</dd></div>`).join('')}</dl>
        ${s.imagen_generada_ia ? '<p class="detalle-nota">Imagen de referencia generada con IA.</p>' : ''}
        <button type="button" class="btn-detalle-elegir">Elegir este corte <span aria-hidden="true">↗</span></button>
    </div>`;
}
export function conectarDetalles(obtenerServicios, dom = document) {
    const dialogo=dom.getElementById('detalle-corte');
    const contenido=dom.getElementById('detalle-contenido');
    let origen=null, servicioActual=null;
    dom.getElementById('grid-dinamico-servicios').addEventListener('click',evento=>{
        const boton=evento.target.closest('[data-detalle]');
        if(!boton)return;
        const servicio=obtenerServicios().find(s=>s.id===boton.dataset.detalle);
        if(!servicio)return;
        origen=boton;servicioActual=servicio;
        contenido.innerHTML=contenidoDetalle(servicio);
        dialogo.showModal();
        dom.body.classList.add('detalle-abierto');
    });
    const cerrar=()=>dialogo.close();
    dom.getElementById('detalle-cerrar').addEventListener('click',cerrar);
    dialogo.addEventListener('click',evento=>{
        if(evento.target===dialogo)cerrar();
        if(evento.target.closest('.btn-detalle-elegir')&&servicioActual){
            const nombre=servicioActual.nombre;
            cerrar();
            // Ejecuta exactamente el evento que usa la tarjeta del catalogo.
            const boton=[...dom.querySelectorAll('.btn-card-reserva')].find(b=>b.dataset.nombre===nombre);
            boton?.click();
        }
    });
    dialogo.addEventListener('close',()=>{
        dom.body.classList.remove('detalle-abierto');
        origen?.focus({preventScroll:true});
        servicioActual=null;
    });
    // Escape y contencion del foco los proporciona el dialogo nativo.
    dom.addEventListener('error',evento=>{
        const imagen=evento.target;
        const marco=imagen.closest?.('.foto-corte');
        if(!marco)return;
        imagen.hidden=true;marco.classList.add('foto-ausente');
        marco.querySelector('.foto-placeholder').hidden=false;
    },true);
}
