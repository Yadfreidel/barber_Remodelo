// Configuración de credenciales de Supabase
// Entorno LOCAL (npm run local): PostgreSQL + PostgREST en esta máquina.
// Para producción, coloca aquí el Project URL y la anon key de tu proyecto de Supabase.
// Usa el mismo equipo desde el que se abrió la web (PC o celular en la misma red Wi-Fi)
export const SUPABASE_URL = `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:54321`;
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJiYXJiZXJpYS1sb2NhbCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzYwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.vuwU45tVTi7OQG-d0qw_S9NG0X12-niCtg8vMeCo-O8";
