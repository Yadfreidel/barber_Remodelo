import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CATALOGO_25 } from '../../models/catalogo25.js';
import { iniciarBase, rpc, fechaLocal } from './helpers.js';

const archivo = fs.readdirSync(new URL('../migrations/', import.meta.url)).find(n => n.endsWith('_catalogo_25_cortes.sql'));
const sql = fs.readFileSync(new URL(`../migrations/${archivo}`, import.meta.url), 'utf8');
const ADMIN = '11111111-1111-1111-1111-111111111111';

test('catalogo 25: importacion repetible, tarifas numericas, agenda real, edicion y citas anteriores intactas', async () => {
    const db = await iniciarBase(54333);
    try {
        // Imita los permisos reales de la base, sin la politica permisiva del fixture.
        await db.admin.query('drop policy acceso_publico on servicios');
        await db.migrar();
        await db.admin.query(`insert into auth.users values ($1);`, [ADMIN]);
        await db.admin.query('insert into admin_usuarios values ($1)', [ADMIN]);
        const anon = await db.conexion('anon');
        const admin = await db.conexion('authenticated', ADMIN);
        const usuario = await db.conexion('authenticated', '22222222-2222-2222-2222-222222222222');
        const fecha = await fechaLocal(db.admin, 5);
        await db.admin.query(`insert into servicios(nombre,precio,duracion_minutos) values('Servicio anterior no tocar',432,75)`);
        const antiguo = (await db.admin.query(`select * from servicios where nombre='Servicio anterior no tocar'`)).rows[0];
        const anterior = await rpc(anon,'reservar_cita','Cliente previo','p@x.com','8095550199','Servicio anterior no tocar','Isaac Garcia',fecha,'09:00');
        const citaAnterior = (await db.admin.query('select * from citas where id::text=$1',[anterior.cita_id])).rows[0];
        await db.admin.query(sql);
        await db.admin.query(sql);
        const filas = (await anon.query('select * from servicios where catalogo_id is not null order by catalogo_id')).rows;
        assert.equal(filas.length,25);
        for (const [i,s] of filas.entries()) {
            assert.equal(s.catalogo_id,CATALOGO_25[i].id);
            assert.equal(Number(s.precio),CATALOGO_25[i].precio);
            assert.equal(s.duracion_minutos,CATALOGO_25[i].duracion_minutos);
        }
        assert.deepEqual((await db.admin.query('select * from servicios where id=$1',[antiguo.id])).rows[0],antiguo);
        assert.deepEqual((await db.admin.query('select * from citas where id::text=$1',[anterior.cita_id])).rows[0],citaAnterior);
        // Intervalo de 5 min solo en esta prueba; el sistema conserva su configuracion real.
        await db.admin.query(`update modulos_config set ajustes=ajustes||'{"intervalo_minutos":5}'::jsonb where modulo='general'`);
        const corto=filas.find(s=>s.catalogo_id==='corte-11');
        const largo=filas.find(s=>s.catalogo_id==='corte-17');
        const cita=await rpc(anon,'reservar_cita','Cliente de prueba','p@x.com','8095550101',String(corto.id),'Acxel Rosario',fecha,'10:00');
        assert.equal(Number(cita.precio_final),450);
        const guardada=(await db.admin.query('select * from citas where id::text=$1',[cita.cita_id])).rows[0];
        assert.equal(guardada.duracion_reservada,30);
        const horas=await rpc(anon,'horarios_disponibles',String(largo.id),'Acxel Rosario',fecha);
        assert.ok(!horas.includes('09:35'),'un corte de 60 minutos no cabe antes de las 10');
        assert.ok(!horas.includes('10:15'),'no debe solapar con la cita 10:00-10:30');
        assert.ok(horas.includes('10:30'));
        const precios=[];
        for (const servicio of [corto,largo,corto]) {
            const q=await rpc(anon,'cotizar_cita',String(servicio.id),'Acxel Rosario',fecha,'12:00');
            precios.push(Number(q.precio_final));
            assert.equal(q.duracion_minutos,servicio.duracion_minutos);
        }
        assert.deepEqual(precios,[450,800,450],'cambiar de estilo no acumula cargos');
        await assert.rejects(rpc(anon,'reservar_cita','Otro','p@x.com','8095550102',String(largo.id),'Acxel Rosario',fecha,'10:15'),/horario_no_disponible/);
        await assert.rejects(rpc(usuario,'admin_actualizar_corte','corte-11',900,60),/no_autorizado/);
        await assert.rejects(rpc(anon,'admin_actualizar_corte','corte-11',900,60),/permission denied/);
        await rpc(admin,'admin_actualizar_corte','corte-11',475,45);
        await db.admin.query(sql);
        const nuevaTarifa=await rpc(anon,'cotizar_cita',String(corto.id),'Acxel Rosario',fecha,'12:00');
        assert.equal(Number(nuevaTarifa.precio_final),475);
        assert.equal(nuevaTarifa.duracion_minutos,45);
        const despues=(await db.admin.query('select * from citas where id::text=$1',[cita.cita_id])).rows[0];
        assert.deepEqual(despues,guardada,'editar servicio e importar no cambia precio ni duracion de cita guardada');
        assert.ok((await rpc(anon,'horarios_disponibles',String(largo.id),'Acxel Rosario',fecha)).includes('10:30'));
        await assert.rejects(rpc(admin,'admin_actualizar_corte','corte-11',-1,0),/tarifa_invalida/);
        // Dos clientes compiten por espacios solapados, no solo por la misma hora.
        const otro=await db.conexion('anon');
        const resultados=await Promise.allSettled([
            rpc(anon,'reservar_cita','Uno','u@x.com','8095550111',String(largo.id),'Yadfreidel Victoria',fecha,'14:00'),
            rpc(otro,'reservar_cita','Dos','d@x.com','8095550112',String(largo.id),'Yadfreidel Victoria',fecha,'14:30')
        ]);
        assert.equal(resultados.filter(r=>r.status==='fulfilled').length,1);
    } finally { await db.cerrar(); }
});
