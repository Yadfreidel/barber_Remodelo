// ==========================================
// MODELO DE BARBEROS CON PERSISTENCIA LOCAL
// ==========================================

const STORAGE_KEY = 'barber_staff_data';

const staffPorDefecto = [
    {
        id: "barbero-1",
        nombre: "Isaac Garcia",
        especialidad: "Especialista en degradados y cortes modernos",
        imagen: "assets/imagenes/barberos/isaac-garcia.webp"
    },
    {
        id: "barbero-2",
        nombre: "Yadfreidel Victoria",
        especialidad: "Experto en cortes clásicos, tijera y arreglo de barba tradicional",
        imagen: "assets/imagenes/barberos/yadfreidel-victoria.webp"
    },
    {
        id: "barbero-3",
        nombre: "Acxel Rosario",
        especialidad: "Especialista en afeitado tradicional con navaja libre y SPA facial",
        imagen: "assets/imagenes/barberos/acxel-rosario.webp"
    }
];

// Fotos de stock anteriores: se reemplazan por las fotos propias de cada barbero
const FOTOS_ANTERIORES = /^https:\/\/images\.unsplash\.com\//;

function inicializarStaff() {
    const guardados = localStorage.getItem(STORAGE_KEY);
    if (!guardados) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(staffPorDefecto));
        return [...staffPorDefecto];
    }
    const staff = JSON.parse(guardados).map(b => {
        const original = staffPorDefecto.find(d => d.nombre === b.nombre);
        return original && FOTOS_ANTERIORES.test(b.imagen || '') ? { ...b, imagen: original.imagen } : b;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(staff));
    return staff;
}

// Barberos activos administrados en el servidor (panel). Si un barbero no tiene foto
// o especialidad en el servidor, se usan las de este navegador o las predeterminadas.
let barberosServidor = null;
export function sincronizarBarberosServidor(filas) {
    const locales = inicializarStaff();
    barberosServidor = filas.map(f => {
        const local = locales.find(l => l.nombre.toLowerCase() === f.nombre.toLowerCase())
            || staffPorDefecto.find(l => l.nombre.toLowerCase() === f.nombre.toLowerCase());
        return {
            id: `srv-${f.id}`,
            barbero_id: f.id,
            nombre: f.nombre,
            especialidad: f.especialidad || local?.especialidad || '',
            imagen: f.foto_url || local?.imagen || staffPorDefecto[0].imagen
        };
    });
}

export function obtenerBarberos() {
    if (barberosServidor) return barberosServidor;
    return inicializarStaff();
}

export function agregarBarbero(barbero) {
    const staff = obtenerBarberos();
    barbero.id = 'barb-' + Date.now();
    staff.push(barbero);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(staff));
    return staff;
}

export function actualizarBarbero(id, datosActualizados) {
    const staff = obtenerBarberos();
    const index = staff.findIndex(b => b.id === id);
    if (index !== -1) {
        staff[index] = { ...staff[index], ...datosActualizados };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(staff));
    }
    return staff;
}

export function eliminarBarbero(id) {
    let staff = obtenerBarberos();
    staff = staff.filter(b => b.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(staff));
    return staff;
}

export function resetearBarberos() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(staffPorDefecto));
    return [...staffPorDefecto];
}

// Compatibilidad con import antiguo
export const staffBarberia = obtenerBarberos();
// Datos guardados solo en este navegador (para importarlos al servidor desde el panel)
export function obtenerBarberosLocales() {
    return inicializarStaff();
}
