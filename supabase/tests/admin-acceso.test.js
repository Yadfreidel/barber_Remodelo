import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBase, rpc, fechaLocal } from './helpers.js';

test('administración: historial privado, cambios solo con rol y reserva pública sin correo', async () => {
    const db = await iniciarBase(54336);
    try {
        await db.migrar();
        const adminId='11111111-1111-1111-1111-111111111111';
        const usuarioId='22222222-2222-2222-2222-222222222222';
        await db.admin.query('insert into auth.users values ($1),($2)',[adminId,usuarioId]);
        await db.admin.query('insert into admin_usuarios values ($1)',[adminId]);
        const anon=await db.conexion('anon');
        const usuario=await db.conexion('authenticated',usuarioId);
        const admin=await db.conexion('authenticated',adminId);
        assert.equal(await rpc(anon,'es_admin'),false);
        assert.equal(await rpc(usuario,'es_admin'),false);
        assert.equal(await rpc(admin,'es_admin'),true);
        const fecha=await fechaLocal(db.admin,12);
        const cita=await rpc(anon,'reservar_cita','Prueba permisos',null,'8095550187','Degradado bajo rizado','Isaac Garcia',fecha,'09:00');
        assert.ok(cita.token);
        assert.equal((await anon.query('select * from citas')).rowCount,0);
        assert.equal((await usuario.query('select * from citas')).rowCount,0);
        assert.equal((await admin.query('select * from citas')).rowCount,1);
        await assert.rejects(anon.query("update citas set estado='confirmada'"),e=>e.code==='42501');
        assert.equal((await usuario.query("update citas set estado='confirmada'")).rowCount,0);
        assert.equal((await rpc(anon,'consultar_cita',cita.token)).estado,'pendiente');
        assert.equal((await admin.query("update citas set estado='confirmada'")).rowCount,1);
        assert.equal((await rpc(anon,'consultar_cita',cita.token)).estado,'confirmada');
        await assert.rejects(rpc(usuario,'admin_guardar_modulo','general',true,'{}'),/no_autorizado/);
        await assert.rejects(rpc(usuario,'admin_actualizar_corte','corte-01',999,30),/no_autorizado/);
        await assert.rejects(rpc(usuario,'admin_guardar_ubicacion','Nombre','Direccion','',18.4,-69.9),/no_autorizado/);
        assert.ok((await rpc(anon,'horarios_disponibles','Degradado bajo rizado','Isaac Garcia',fecha)).length);
        await rpc(anon,'cancelar_cita',cita.token);
    } finally { await db.cerrar(); }
});
