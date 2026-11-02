const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_MAX_TOOL_FAILURES = 2;

function safeSummary(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.replace(/(?:postgres(?:ql)?:\/\/[^\s"']+|(?:api[_-]?key|secret|password|token)\s*[:=]\s*[^\s,;]+)/gi, '[redacted]').slice(0, 700);
}

/**
 * Single-tool-per-turn agent loop. It has no filesystem, network, shell or DB access:
 * all effects must be supplied by the host's explicit executeTool capability.
 */
export async function runAgentLoop({
  task,
  observe = async () => ({}),
  decide,
  executeTool,
  verify = async () => ({ passed: false, mode: 'unavailable', reason: 'Build verification tool is not configured.' }),
  requireBuild = true,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  maxToolFailures = DEFAULT_MAX_TOOL_FAILURES,
  tokenBudget = 5000,
  signal,
  clock = () => new Date().toISOString(),
}) {
  if (typeof task !== 'string' || task.trim().length < 2) throw new TypeError('task must be a non-empty string');
  if (typeof decide !== 'function' || typeof executeTool !== 'function') throw new TypeError('decide and executeTool callbacks are required');
  const limit = Math.max(1, Math.min(50, Number.isInteger(maxIterations) ? maxIterations : DEFAULT_MAX_ITERATIONS));
  const budget = Math.max(1, Math.min(50_000, Number.isFinite(tokenBudget) ? tokenBudget : 5000));
  const audit = [];
  const results = [];
  const failures = new Map();
  let tokens = 0;
  let buildVerified = false;
  let excludedTool = '';

  const event = (kind, payload = {}) => {
    const item = { at: clock(), iteration: audit.length ? audit[audit.length - 1].iteration : 0, kind, ...payload };
    audit.push(item);
    return item;
  };

  for (let iteration = 1; iteration <= limit; iteration++) {
    if (signal?.aborted) return { status: 'cancelled', completed: false, reason: 'aborted', iterations: iteration - 1, tokenEstimate: tokens, buildVerified, audit, results };
    const state = await observe({ task, iteration, previousResults: results.slice(-6), buildVerified });
    event('observed', { iteration, summary: safeSummary(state) });

    if (tokens >= budget) return { status: 'paused', completed: false, reason: 'token_budget', iterations: iteration - 1, tokenEstimate: tokens, buildVerified, audit, results, summary: 'Orçamento de análise atingido; o projecto foi preservado.' };

    let choice;
    try {
      choice = await decide({ task, state, iteration, maxIterations: limit, tokenBudget: budget, tokensUsed: tokens, previousResults: results.slice(-6), excludedTool });
    } catch (error) {
      event('decision-error', { iteration, error: safeSummary(error?.message || 'decision failed') });
      return { status: 'failed', completed: false, reason: 'decision_error', iterations: iteration, tokenEstimate: tokens, buildVerified, audit, results };
    }
    const estimate = Number.isFinite(choice?.tokenEstimate) ? Math.max(0, Math.ceil(choice.tokenEstimate)) : 0;
    tokens += estimate;
    event('decision', { iteration, action: choice?.action || '', tool: choice?.tool || '', reason: safeSummary(choice?.reason || '') });

    if (choice?.action === 'ask_user') {
      const question = typeof choice.question === 'string' ? choice.question.trim().slice(0, 600) : '';
      if (!question) return { status: 'failed', completed: false, reason: 'empty_question', iterations: iteration, tokenEstimate: tokens, buildVerified, audit, results };
      event('paused-for-user', { iteration, question });
      return { status: 'paused', completed: false, reason: 'awaiting_user', question, iterations: iteration, tokenEstimate: tokens, buildVerified, audit, results };
    }

    if (choice?.action === 'complete') {
      if (requireBuild && !buildVerified) {
        event('completion-blocked', { iteration, reason: 'build_not_verified' });
        return { status: 'blocked', completed: false, reason: 'build_not_verified', iterations: iteration, tokenEstimate: tokens, buildVerified, audit, results, summary: 'O agente tentou concluir sem um build realmente executado e aprovado.' };
      }
      const finalCheck = await verify({ task, state, results, buildVerified, requireBuild });
      event('final-verification', { iteration, passed: finalCheck?.passed === true, mode: safeSummary(finalCheck?.mode || 'unknown') });
      if (finalCheck?.passed !== true || requireBuild && finalCheck?.mode !== 'executed-build') {
        return { status: 'blocked', completed: false, reason: 'verification_failed', iterations: iteration, tokenEstimate: tokens, buildVerified, audit, results, summary: safeSummary(finalCheck?.reason || 'Verificação não confirmou um build executado.') };
      }
      return { status: 'completed', completed: true, reason: 'verified', iterations: iteration, tokenEstimate: tokens, buildVerified, audit, results, summary: safeSummary(choice.summary || 'Tarefa verificada.') };
    }

    if (choice?.action !== 'tool' || typeof choice.tool !== 'string' || !choice.tool.trim()) {
      event('invalid-decision', { iteration });
      return { status: 'failed', completed: false, reason: 'invalid_decision', iterations: iteration, tokenEstimate: tokens, buildVerified, audit, results };
    }
    if (excludedTool && choice.tool === excludedTool) {
      event('strategy-stalled', { iteration, tool: choice.tool });
      return { status: 'blocked', completed: false, reason: 'no_alternative_tool', iterations: iteration, tokenEstimate: tokens, buildVerified, audit, results };
    }

    const args = choice.arguments && typeof choice.arguments === 'object' ? choice.arguments : {};
    event('tool-started', { iteration, tool: choice.tool, inputSummary: safeSummary(args) });
    let result;
    try {
      result = await executeTool(choice.tool, args, { task, iteration, state, signal });
      if (!result || typeof result !== 'object' || result.ok !== true) throw new Error(result?.error || 'Tool did not report success');
      results.push({ tool: choice.tool, ok: true, output: result.output, executionMode: result.executionMode || 'tool' });
      event('tool-completed', { iteration, tool: choice.tool, outputSummary: safeSummary(result.summary || result.output || 'ok') });
      failures.set(choice.tool, 0);
      if (choice.tool === 'correr_build' && result.executionMode === 'executed-build' && result.buildPassed === true) buildVerified = true;
      excludedTool = '';
      if (result.pauseForUser === true) return { status: 'paused', completed: false, reason: 'awaiting_user', question: String(result.question || result.output || ''), iterations: iteration, tokenEstimate: tokens, buildVerified, audit, results };
    } catch (error) {
      results.push({ tool: choice.tool, ok: false, error: safeSummary(error?.message || 'tool failed') });
      const count = (failures.get(choice.tool) || 0) + 1;
      failures.set(choice.tool, count);
      event('tool-failed', { iteration, tool: choice.tool, failures: count, error: safeSummary(error?.message || 'tool failed') });
      if (count >= maxToolFailures) {
        excludedTool = choice.tool;
        event('strategy-change-required', { iteration, excludedTool, reason: 'same tool failed repeatedly' });
      }
    }
  }
  event('iteration-limit', { iteration: limit });
  return { status: 'paused', completed: false, reason: 'iteration_limit', iterations: limit, tokenEstimate: tokens, buildVerified, audit, results, summary: 'Limite de iterações atingido; nenhum sucesso foi declarado.' };
}
