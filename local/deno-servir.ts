// Ejecuta una Edge Function (que llama a Deno.serve(handler)) en el puerto local indicado.
const original = Deno.serve;
const port = Number(Deno.env.get('PUERTO_FUNCION'));
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (a: any, b?: any) => typeof a === 'function' ? original({ port }, a) : original({ ...a, port }, b);
await import(Deno.env.get('FUNCION_URL')!);
