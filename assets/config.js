// Configuración de credenciales de Supabase
// Entorno LOCAL (npm run local): PostgreSQL + PostgREST en esta máquina.
// Para producción, coloca aquí el Project URL y la anon key de tu proyecto de Supabase.
// La base local solo existe en esta PC: se usa al abrir la web desde la PC o desde un
// celular en la misma red Wi-Fi. En la web publicada (p. ej. GitHub Pages) no hay base de
// datos y las citas se envían como solicitud por WhatsApp.
const HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const ES_RED_LOCAL = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(HOST);
export const SUPABASE_URL = ES_RED_LOCAL ? `http://${HOST}:54321` : "https://tu-proyecto.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJiYXJiZXJpYS1sb2NhbCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzYwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.vuwU45tVTi7OQG-d0qw_S9NG0X12-niCtg8vMeCo-O8";
