import test from 'node:test';
import assert from 'node:assert/strict';
import { verificar_complexidade_pedido, PLAN_FAILURE_TEXT, validatePlanHandoff } from './complexity.mjs';
import { readFile } from 'node:fs/promises';

test('marca clones de produto e SaaS amplo para decomposição',()=>{
 assert.equal(verificar_complexidade_pedido('um micro-saas de edição tipo Canva').isComplex,true);
 assert.equal(verificar_complexidade_pedido('plataforma completa para vender online').isComplex,true);
 assert.equal(verificar_complexidade_pedido('website simples para uma padaria').isComplex,false);
});
test('plano ausente/inválido sempre devolve exactamente a pergunta de divisão',()=>{
 assert.deepEqual(validatePlanHandoff({plan:null,complexity:{isComplex:true},stages:[]}),{ok:false,clarification:PLAN_FAILURE_TEXT,stages:[]});
 assert.deepEqual(validatePlanHandoff({plan:{problem:'ok'},complexity:{isComplex:true},stages:['a','b'] }),{ok:false,clarification:PLAN_FAILURE_TEXT,stages:[]});
});
test('aprova somente decomposição em 3 ou 4 etapas para pedido complexo',()=>{
 assert.equal(validatePlanHandoff({plan:{problem:'ok'},complexity:{isComplex:true},stages:['a','b','c']}).ok,true);
 assert.equal(validatePlanHandoff({plan:{problem:'ok'},complexity:{isComplex:true},stages:['a','b','c','d','e']}).ok,false);
});
test('servidor exige plano emitido, aprovação de etapa complexa e encaminha só a etapa 1',async()=>{
 const server=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
 assert.match(server,/const ticket=planApprovals\.get\(String\(body\.planId\|\|''\)\)/);
 assert.match(server,/ticket\.complex&&\(ticket\.approvedStage!==0/);
 assert.match(server,/generationTask=ticket\.complex\?`Implementa somente a Etapa 1 aprovada/);
 assert.match(server,/STRICT STAGE SCOPE/);
});
