// Configuración de Supabase para barbería.
// Barbería vive en el esquema "barberia" de un proyecto de Supabase COMPARTIDO (dominó usa public).
//
// PRODUCCIÓN (web publicada): Project URL y clave PÚBLICA (anon / publishable) del proyecto compartido,
// en Supabase > Project Settings > API. NUNCA la service_role ni ninguna clave secreta: este archivo
// se descarga en el navegador de cualquier visitante.
const PRODUCCION = {
    url: "https://gopuiuzvfysrkvaoppkh.supabase.co",
    clavePublica: "sb_publishable_-yPnWZsoIlJtdTViA9QrLg_EReDSdam"
};

// LOCAL (npm run local): PostgreSQL + PostgREST en esta PC, también accesible desde un celular en la
// misma red Wi-Fi. Esta clave solo sirve para el entorno local.
const HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const ES_RED_LOCAL = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(HOST);
const LOCAL = {
    url: `http://${HOST}:54321`,
    clavePublica: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJiYXJiZXJpYS1sb2NhbCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzYwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.vuwU45tVTi7OQG-d0qw_S9NG0X12-niCtg8vMeCo-O8"
};

export const SUPABASE_URL = ES_RED_LOCAL ? LOCAL.url : PRODUCCION.url;
export const SUPABASE_ANON_KEY = ES_RED_LOCAL ? LOCAL.clavePublica : PRODUCCION.clavePublica;
export const SUPABASE_SCHEMA = 'barberia';
