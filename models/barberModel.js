// ==========================================
// MODELO DE BARBEROS CON PERSISTENCIA LOCAL
// ==========================================

const STORAGE_KEY = 'barber_staff_data';

const staffPorDefecto = [
    {
        id: "barbero-1",
        nombre: "Isaac Garcia",
        especialidad: "Especialista en degradados y cortes modernos",
        imagen: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "barbero-2",
        nombre: "Yadfreidel Victoria",
        especialidad: "Experto en cortes clásicos, tijera y arreglo de barba tradicional",
        imagen: "https://images.unsplash.com/photo-1517832606589-7a598b389279?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: "barbero-3",
        nombre: "Acxel Rosario",
        especialidad: "Especialista en afeitado tradicional con navaja libre y SPA facial",
        imagen: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=600&auto=format&fit=crop"
    }
];

function inicializarStaff() {
    const guardados = localStorage.getItem(STORAGE_KEY);
    if (!guardados) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(staffPorDefecto));
        return [...staffPorDefecto];
    }
    return JSON.parse(guardados);
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
