/** Conservative request-size classifier. It only raises the need to plan/decompose; it never rejects lawful tasks. */
export function verificar_complexidade_pedido(value) {
  const text=String(value||'').toLocaleLowerCase('pt').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const markers=[/\b(tipo|estilo|igual|como|parecido com)\s+(canva|youtube|instagram|tiktok|uber|airbnb|shopify|lovable)\b/,/\b(microsaas|micro saas|saas|plataforma completa|app completo|sistema completo|marketplace)\b/,/\b(backend|back-end|base de dados|banco de dados|autenticacao|login|pagamento|stripe|upload|permissoes)\b/];
  const productClone=markers[0].test(text), broadPlatform=markers[1].test(text), infraWords=markers[2].test(text);
  const distinctReqs=(text.match(/\b(e|tambem|alem disso|mais|com|inclui|incluindo|integrar|login|pagamento|upload|dashboard|admin|relatorio|notificacao|api|banco|dados)\b/g)||[]).length;
  const isComplex=productClone||broadPlatform||infraWords&&distinctReqs>=2||distinctReqs>=7||text.length>950;
  return {isComplex,reason:productClone?'referência a produto/plataforma ampla':broadPlatform?'pedido de produto ou plataforma completa':infraWords&&distinctReqs>=2?'múltiplas necessidades de infraestrutura':distinctReqs>=7?'múltiplos requisitos explícitos':text.length>950?'pedido muito extenso':'escopo aparentemente limitado'};
}
export const PLAN_FAILURE_TEXT='Não consegui estruturar este pedido complexo. Vamos dividi-lo em partes. Qual é a primeira funcionalidade que queres?';
export function validateStages(input) {
  if(!Array.isArray(input))return [];
  return input.filter(x=>typeof x==='string'&&x.trim()).slice(0,5).map(x=>x.trim().slice(0,300));
}

export function validatePlanHandoff({ plan, complexity, stages, databaseSpecValid = true }) {
  const normalizedStages=validateStages(stages);
  if(!plan||!databaseSpecValid)return {ok:false,clarification:PLAN_FAILURE_TEXT,stages:[]};
  if(complexity?.isComplex&&(normalizedStages.length<3||normalizedStages.length>4))return {ok:false,clarification:PLAN_FAILURE_TEXT,stages:[]};
  return {ok:true,stages:normalizedStages,clarification:''};
}
