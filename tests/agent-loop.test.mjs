import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop } from '../agent-loop.mjs';

const tick = (() => { let n=0; return () => `2026-11-02T00:00:${String(n++).padStart(2,'0')}Z`; })();

test('executa uma ferramenta de cada vez e só conclui após build executado e verificação final', async () => {
  let active=0,maxActive=0;const calls=[];let turn=0;
  const result=await runAgentLoop({task:'criar uma app',clock:tick,decide:async()=>++turn===1?{action:'tool',tool:'correr_build',arguments:{},tokenEstimate:10}:{action:'complete',summary:'Feito',tokenEstimate:5},executeTool:async name=>{active++;maxActive=Math.max(maxActive,active);calls.push(name);await Promise.resolve();active--;return{ok:true,executionMode:'executed-build',buildPassed:true}},verify:async()=>({passed:true,mode:'executed-build'})});
  assert.equal(maxActive,1);assert.deepEqual(calls,['correr_build']);assert.equal(result.status,'completed');assert.equal(result.buildVerified,true);assert(result.audit.some(x=>x.kind==='tool-started'));assert(result.audit.some(x=>x.kind==='final-verification'&&x.passed));
});

test('bloqueia conclusão sem build genuinamente executado', async()=>{
  const result=await runAgentLoop({task:'criar aplicação',clock:tick,decide:async()=>({action:'complete',summary:'diz que está pronto'}),executeTool:async()=>({ok:true}),verify:async()=>({passed:true,mode:'static-check'})});
  assert.equal(result.status,'blocked');assert.equal(result.completed,false);assert.equal(result.reason,'build_not_verified');
});

test('duas falhas da mesma ferramenta forçam a mudar a estratégia', async()=>{
  let i=0;const excluded=[];const result=await runAgentLoop({task:'resolver bug',clock:tick,maxIterations:5,decide:async c=>{excluded.push(c.excludedTool);if(i++<2)return{action:'tool',tool:'ler_ficheiro',arguments:{path:'app.js'}};return{action:'tool',tool:'listar_ficheiros',arguments:{}}},executeTool:async name=>{if(name==='ler_ficheiro')throw Error('not found');return{ok:true,output:['app.js']}},requireBuild:false,verify:async()=>({passed:true,mode:'plan-only'})});
  assert.equal(excluded[2],'ler_ficheiro');assert(result.audit.some(x=>x.kind==='strategy-change-required'));assert.equal(result.status,'paused');
});

test('pergunta ao utilizador pausa sem inventar pressupostos', async()=>{
  const result=await runAgentLoop({task:'ligar pagamento',clock:tick,decide:async()=>({action:'ask_user',question:'Qual conta autorizada devo usar?'}),executeTool:async()=>{throw Error('not called')}});
  assert.equal(result.status,'paused');assert.equal(result.reason,'awaiting_user');assert.equal(result.question,'Qual conta autorizada devo usar?');
});

test('a ferramenta de pergunta pausa imediatamente e regista a resposta pendente',async()=>{
  let decisions=0;const result=await runAgentLoop({task:'falta escolher conta',clock:tick,decide:async()=>{decisions++;return{action:'tool',tool:'perguntar_utilizador',arguments:{question:'Qual conta autorizada devo usar?'}}},executeTool:async()=>({ok:true,pauseForUser:true,question:'Qual conta autorizada devo usar?',output:'Qual conta autorizada devo usar?'}),verify:async()=>({passed:false,mode:'unavailable'})});
  assert.equal(decisions,1);assert.equal(result.status,'paused');assert.equal(result.reason,'awaiting_user');assert.equal(result.question,'Qual conta autorizada devo usar?');
});

test('limites de iterações e orçamento param sem declarar sucesso',async()=>{
  let calls=0;const r=await runAgentLoop({task:'inspeccionar',clock:tick,maxIterations:2,tokenBudget:1,decide:async()=>{calls++;return{action:'tool',tool:'listar_ficheiros',arguments:{},tokenEstimate:0}},executeTool:async()=>({ok:true,output:[]}),requireBuild:false,verify:async()=>({passed:true,mode:'plan-only'})});
  assert.equal(r.status,'paused');assert.equal(r.completed,false);assert.equal(calls,2);assert.equal(r.reason,'iteration_limit');
});
