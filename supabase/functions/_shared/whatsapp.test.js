import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verificarFirma, construirPlantilla, extraerEventos, telefonoInternacional, esErrorReintentable } from './whatsapp.js';

test('verifica la firma HMAC del webhook de Meta', async () => {
    const cuerpo = '{"entry":[]}';
    const firma = 'sha256=' + crypto.createHmac('sha256', 'secreto').update(cuerpo).digest('hex');
    assert.equal(await verificarFirma(cuerpo, firma, 'secreto'), true);
    assert.equal(await verificarFirma(cuerpo + ' ', firma, 'secreto'), false, 'cuerpo alterado');
    assert.equal(await verificarFirma(cuerpo, firma, 'otro'), false, 'secreto incorrecto');
    assert.equal(await verificarFirma(cuerpo, null, 'secreto'), false);
    assert.equal(await verificarFirma(cuerpo, firma, ''), false, 'sin secreto configurado se rechaza');
});

test('construye plantilla con parámetros y botones de respuesta rápida', () => {
    const cuerpo = construirPlantilla({ telefono: '829-246-6177', plantilla: 'recordatorio_cita', parametros: ['Ana', 'Corte'], botones: ['CONFIRMAR:t', 'CANCELAR:t'] });
    assert.equal(cuerpo.to, '18292466177');
    assert.equal(cuerpo.template.name, 'recordatorio_cita');
    assert.deepEqual(cuerpo.template.components[0].parameters.map(p => p.text), ['Ana', 'Corte']);
    assert.deepEqual(cuerpo.template.components.slice(1).map(c => [c.index, c.parameters[0].payload]), [['0', 'CONFIRMAR:t'], ['1', 'CANCELAR:t']]);
    assert.equal(telefonoInternacional('18292466177'), '18292466177');
});

test('extrae eventos de botón, interactivo y texto', () => {
    const cuerpo = { entry: [{ changes: [{ value: { messages: [
        { id: 'w1', from: '1809', type: 'button', button: { payload: 'CONFIRMAR:abc' } },
        { id: 'w2', from: '1809', type: 'interactive', interactive: { button_reply: { id: 'ACEPTAR:x' } } },
        { id: 'w3', from: '1809', type: 'text', text: { body: ' baja ' } },
        { id: 'w4', from: '1809', type: 'image' }
    ], statuses: [{ id: 's1' }] } }] }] };
    assert.deepEqual(extraerEventos(cuerpo).map(e => [e.id, e.payload]), [['w1', 'CONFIRMAR:abc'], ['w2', 'ACEPTAR:x'], ['w3', 'BAJA']]);
    assert.deepEqual(extraerEventos({}), []);
});

test('solo reintenta errores temporales', () => {
    assert.equal(esErrorReintentable(429), true);
    assert.equal(esErrorReintentable(503), true);
    assert.equal(esErrorReintentable(400), false);
});
