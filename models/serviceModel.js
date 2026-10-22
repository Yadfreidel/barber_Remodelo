import { CATALOGO_25 } from './catalogo25.js';
// ==========================================
// MODELO DE SERVICIOS CON PERSISTENCIA LOCAL
// ==========================================

const STORAGE_KEY = 'barber_servicios_data';

const serviciosPorDefecto = [
    // CORTES (10)
    {
        id: "corte-signature",
        nombre: "Corte Signature Master",
        descripcion: "Corte premium adaptado a tu visajismo facial. Incluye asesoría de estilo, lavado capilar y peinado con pomada.",
        precio: "RD$ 700",
        categoria: "cortes",
        imagen: "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "corte-skin-fade",
        nombre: "High / Mid / Low Skin Fade",
        descripcion: "Desvanecido impecable desde el cero absoluto (shaver) pulido al detalle con transiciones perfectas y nítidas.",
        precio: "RD$ 750",
        categoria: "cortes",
        imagen: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "corte-taper-fade",
        nombre: "Blowout / Taper Fade Moderno",
        descripcion: "Desvanecido sutil únicamente en las patillas y la nuca, manteniendo el peso y volumen superior con textura.",
        precio: "RD$ 700",
        categoria: "cortes",
        imagen: "https://images.unsplash.com/photo-1512864084360-7c0c4d0a0845?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "corte-buzz",
        nombre: "Buzz Cut con Line Up",
        descripcion: "Corte militar uniforme con texturizado superior ligero y una definición milimétrica de los cerquillos a navaja.",
        precio: "RD$ 550",
        categoria: "cortes",
        imagen: "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "corte-pompadour",
        nombre: "Pompadour Clásico Ejecutivo",
        descripcion: "Estilo tradicional de alto volumen superior, esculpido a tijera para caballeros que buscan elegancia formal.",
        precio: "RD$ 800",
        categoria: "cortes",
        imagen: "https://images.unsplash.com/photo-1605497746444-ac9da5848af7?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "corte-mullet",
        nombre: "Modern Mullet Texturizado",
        descripcion: "Tendencia urbana vanguardista con laterales desvanecidos y caída fluida de cabello texturizado en la nuca.",
        precio: "RD$ 750",
        categoria: "cortes",
        imagen: "https://images.unsplash.com/photo-1593702295094-aea22597af65?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "corte-french-crop",
        nombre: "French Crop con Textura",
        descripcion: "Flequillo corto y recto en la frente combinado con una textura pesada arriba y un desvanecido alto y limpio.",
        precio: "RD$ 700",
        categoria: "cortes",
        imagen: "https://images.unsplash.com/photo-1517832606589-7a598b647192?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "corte-tijera",
        nombre: "Corte Clásico a Tijera",
        descripcion: "Estructura tradicional trabajada al 100% con tijeras para un crecimiento orgánico, natural y de bajo mantenimiento.",
        precio: "RD$ 850",
        categoria: "cortes",
        imagen: "https://images.unsplash.com/photo-1501612780327-4504d6187fbc?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "corte-cejas",
        nombre: "Corte Elite & Diseño de Cejas",
        descripcion: "Tu corte de preferencia combinado con depilación, limpieza y diseño estricto de cejas masculinas a navaja.",
        precio: "RD$ 850",
        categoria: "cortes",
        imagen: "https://images.unsplash.com/photo-1519014816548-bf5fe059798b?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "corte-kids",
        nombre: "Corte Kids (Menores de 12)",
        descripcion: "Estilo moderno, paciencia especializada y acabados adaptados para los pequeños de la casa. Incluye cera suave.",
        precio: "RD$ 500",
        categoria: "cortes",
        imagen: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?q=80&w=600&auto=format&fit=crop"
    },

    // BARBA & SPA (10)
    {
        id: "barba-hot-towel",
        nombre: "Ritual de Barba Toalla Caliente",
        descripcion: "Afeitado tradicional con navaja, tratamiento de vapor, aceites pre-shave, toallas calientes y bálsamo.",
        precio: "RD$ 500",
        categoria: "barba",
        imagen: "https://images.unsplash.com/photo-1621605816345-98f3ff4efee6?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "barba-perfilado",
        nombre: "Perfilado de Barba y Cerquillo",
        descripcion: "Limpieza express y definición estricta de las líneas de la mejilla y cuello utilizando gel de afeitar transparente.",
        precio: "RD$ 350",
        categoria: "barba",
        imagen: "https://images.unsplash.com/photo-1542332606-b2d1c6385e4a?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "barba-degrade",
        nombre: "Barba con Degradado (Beard Fade)",
        descripcion: "Conexión perfecta de las patillas con la barba, disminuyendo el volumen de arriba hacia abajo de forma simétrica.",
        precio: "RD$ 450",
        categoria: "barba",
        imagen: "https://images.unsplash.com/photo-1536700503338-e349a21bfaa2?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "barba-larga",
        nombre: "Esculpido de Barba Larga",
        descripcion: "Reducción de volumen rebelde, emparejado con máquina sobre peine y cuadratura angular para barbas densas.",
        precio: "RD$ 550",
        categoria: "barba",
        imagen: "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "barba-camuflaje",
        nombre: "Camuflaje de Barba Elite",
        descripcion: "Aplicación experta de pigmentación semipermanente para cubrir canas, rellenar parches y acentuar densidad.",
        precio: "RD$ 650",
        categoria: "barba",
        imagen: "https://images.unsplash.com/photo-1513694203232-719a280e022f?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "barba-hidra",
        nombre: "Hidratación Profunda de Barba",
        descripcion: "Lavado con champú especial para vello facial, aplicación de acondicionador de alta hidratación y ozonoterapia.",
        precio: "RD$ 400",
        categoria: "barba",
        imagen: "https://images.unsplash.com/photo-1608248597481-496100c8c836?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "spa-blackmask",
        nombre: "Limpieza con Mascarilla Negra",
        descripcion: "Extracción completa de impurezas y puntos negros en la zona de la nariz y pómulos, dejando el rostro renovado.",
        precio: "RD$ 600",
        categoria: "barba",
        imagen: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "spa-facial-gold",
        nombre: "Facial Premium de Oro 24K",
        descripcion: "Exfoliación profunda seguida de una mascarilla de colágeno y micropartículas de oro para revitalizar la piel seca.",
        precio: "RD$ 900",
        categoria: "barba",
        imagen: "https://images.unsplash.com/photo-1556228720-195a672e8a03?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "barba-candado",
        nombre: "Diseño de Perilla / Candado",
        descripcion: "Estilizado preciso aislando los bigotes y la afirmación de la barbilla con un afeitado impecable y simétrico.",
        precio: "RD$ 400",
        categoria: "barba",
        imagen: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "spa-alaciado",
        nombre: "Alaciado de Barba Rebelde",
        descripcion: "Tratamiento termoactivo suavizante y progresivo para reducir las ondas rígidas del vello facial, facilitando el peinado.",
        precio: "RD$ 800",
        categoria: "barba",
        imagen: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?q=80&w=600&auto=format&fit=crop"
    },

    // COMBOS VIP (8)
    {
        id: "combo-ejecutivo",
        nombre: "Combo Ejecutivo Real",
        descripcion: "Corte Signature + Lavado Capilar Relajante + Peinado Estilizado. El mantenimiento semanal perfecto.",
        precio: "RD$ 900",
        categoria: "combos",
        imagen: "https://images.unsplash.com/photo-1504593811423-6dd665756598?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "combo-master",
        nombre: "Combo Master Absoluto",
        descripcion: "Corte de tu preferencia + Ritual de Barba con Toalla Caliente. Sincronía y nitidez en todo tu rostro.",
        precio: "RD$ 1,100",
        categoria: "combos",
        imagen: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "combo-padrino",
        nombre: "Combo El Padrino VIP",
        descripcion: "Corte + Ritual de Barba + Mascarilla Negra Facial + Diseño de Cejas + Bebida Premium de cortesía.",
        precio: "RD$ 1,600",
        categoria: "combos",
        imagen: "https://images.unsplash.com/photo-1480429370139-e0132c086e2a?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "combo-gold-spa",
        nombre: "Combo Oro Inmortal",
        descripcion: "Corte Desvanecido + Degradado de Barba + Mascarilla de Oro 24K + Tratamiento de Ozonoterapia Capilar.",
        precio: "RD$ 1,950",
        categoria: "combos",
        imagen: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "combo-urbano",
        nombre: "Combo Urbano Black",
        descripcion: "Skin Fade + Camuflaje / Pigmentación Completa en Barba + Diseño de líneas o rayas sutiles en las cejas.",
        precio: "RD$ 1,350",
        categoria: "combos",
        imagen: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "combo-padre-hijo",
        nombre: "Combo Herencia (Padre e Hijo)",
        descripcion: "Un corte premium para adulto y un corte infantil para el niño en estaciones simultáneas. Incluye sodas para ambos.",
        precio: "RD$ 1,100",
        categoria: "combos",
        imagen: "https://images.unsplash.com/photo-1548142813-c348350df52b?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "combo-business-groom",
        nombre: "Combo Fresh & Clean Business",
        descripcion: "Corte Clásico + Afeitado Completo de Rostro Liso + Exfoliación Facial Express Anti-fatiga. Estilo corporativo total.",
        precio: "RD$ 1,200",
        categoria: "combos",
        imagen: "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "combo-boda-vip",
        nombre: "Combo Groom / Novio & Celebridades",
        descripcion: "Corte Premium + Barba Completa + Mascarilla Black + Diseño de Cejas + Peinado de Larga Duración + Parches de Ojeras.",
        precio: "RD$ 2,500",
        categoria: "combos",
        imagen: "https://images.unsplash.com/photo-1560250097-0b93528c311a?q=80&w=600&auto=format&fit=crop"
    }
];

const VERSION_CATALOGO = 'barber_catalogo25_v1';
const idsCatalogo = new Set(CATALOGO_25.map(s => s.id));
export function esCorteCatalogo(nombre) {
    return obtenerServicios().some(s => s.nombre === nombre && idsCatalogo.has(s.id));
}
export function formatoPrecioServicio(precio) {
    return typeof precio === 'number' ? `RD$ ${precio.toLocaleString('es-DO')}` : precio;
}
function inicializarServicios() {
    const guardados = localStorage.getItem(STORAGE_KEY);
    let servicios = guardados ? JSON.parse(guardados) : [];
    if (!localStorage.getItem(VERSION_CATALOGO)) {
        // Los servicios anteriores permanecen guardados, sin cambios ni borrados.
        const ids = new Set(servicios.map(s => s.id));
        servicios = [...servicios, ...CATALOGO_25.filter(s => !ids.has(s.id)).map(s => ({ ...s }))];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(servicios));
        localStorage.setItem(VERSION_CATALOGO, '1');
    }
    return servicios;
}
// Catálogo administrado en el servidor (panel): cuando está disponible es la fuente de verdad.
// Los 25 cortes originales conservan foto y textos estáticos mientras no se editen.
let catalogoPublico = null;
export function sincronizarCatalogoPublico(filas) {
    catalogoPublico = filas.map((fila, i) => {
        const base = fila.catalogo_id ? CATALOGO_25.find(s => s.id === fila.catalogo_id) : null;
        return {
            ...(base || {}),
            id: base?.id || `srv-${fila.id}`,
            servicio_id: String(fila.id),
            nombre: fila.nombre,
            descripcion: fila.descripcion ?? base?.descripcion ?? '',
            categoria: fila.categoria ?? base?.categoria ?? 'otros',
            imagen: fila.imagen_url || base?.imagen || '',
            alt: base?.alt || fila.nombre,
            precio: Number(fila.precio),
            duracion_minutos: Number(fila.duracion_minutos),
            destacado: Boolean(fila.destacado),
            activo: true,
            orden: fila.orden ?? base?.orden ?? i + 1,
            barberos: fila.barberos || null,
            catalogo_personalizado: !base
        };
    });
}

export function obtenerServicios({ incluirAnteriores = false } = {}) {
    if (catalogoPublico && !incluirAnteriores) return catalogoPublico;
    const servicios = inicializarServicios();
    return incluirAnteriores ? servicios : servicios.filter(s => idsCatalogo.has(s.id) || s.catalogo_personalizado);
}
export function sincronizarCatalogoServidor(filas) {
    const servicios = inicializarServicios();
    for (const fila of filas) {
        const servicio = servicios.find(s => s.id === fila.catalogo_id);
        if (servicio) Object.assign(servicio, { servicio_id: String(fila.id), precio: Number(fila.precio), duracion_minutos: Number(fila.duracion_minutos) });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servicios));
}

export function agregarServicio(servicio) {
    const servicios = inicializarServicios();
    servicio.catalogo_personalizado = true;
    servicio.id = 'srv-' + Date.now();
    servicios.push(servicio);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servicios));
    return servicios;
}

export function actualizarServicio(id, datosActualizados) {
    const servicios = inicializarServicios();
    const index = servicios.findIndex(s => s.id === id);
    if (index !== -1) {
        servicios[index] = { ...servicios[index], ...datosActualizados };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(servicios));
    }
    return servicios;
}

export function eliminarServicio(id) {
    let servicios = inicializarServicios();
    servicios = servicios.filter(s => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servicios));
    return servicios;
}

export function resetearServicios() {
    const anteriores = inicializarServicios().filter(s => !idsCatalogo.has(s.id) && !s.catalogo_personalizado);
    const nuevos = CATALOGO_25.map(s => ({ ...s }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...anteriores, ...nuevos]));
    return nuevos;
}

// Compatibilidad con import antiguo
export const serviciosBarberia = obtenerServicios();