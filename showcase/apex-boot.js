(function () {
  const base = new URL('.', document.currentScript.src);
  const api = (action, x02 = '', x03 = '', extra = {}) => new Promise((resolve, reject) => {
    apex.server.process('GENESIS_DATA', {x01: action, x02, x03, ...extra}, {
      dataType: 'json',
      success: data => data.error ? reject(new Error(data.error + ' (' + data.code + ')')) : resolve(data),
      error: xhr => reject(new Error(xhr.responseJSON?.code === -20026
        ? 'Invalid configuration. Check numeric limits, elites below population size, and fitness weights summing to one.'
        : xhr.responseJSON?.code === -20060 ? 'Genesis operator authorization is required.' : 'Laboratory request failed'))
    });
  });
  const el = (tag, text) => {
    const e = document.createElement(tag);
    if (tag === 'button') e.type = 'button';
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const inputNumber = id => Number(document.querySelector('#' + id).value);
  apex.jQuery(async function () {
    const embedded = document.querySelector('[data-genesis-embedded]');
    if (embedded) {
      window.genesisDataProvider = async () => {
        const index = await api('INDEX');
        return {manifest: {kind: 'recorded-oracle-experiment'}, index,
          generation: (run, generation) => api('GENERATION', run, String(generation))};
      };
      await import(new URL('lab.mjs', base));
      const target = embedded.dataset.initialView;
      if (target && target !== 'arena') document.querySelector('[data-view="' + target + '"]')?.click();
      const preferences = el('section'); preferences.className = 'analytics-card';
      preferences.append(el('h3', 'Optional human comparison'),
        el('p', 'Compare the two current Arena organisms. Authenticated preferences are stored separately and never change technical fitness.'));
      const note = el('p'); note.setAttribute('role', 'status');
      for (const [side, label] of [[0, 'Prefer left organism'], [1, 'Prefer right organism']]) {
        const button = el('button', label);
        button.onclick = async () => {
          try {
            const state = window.genesisState;
            if (!state || state.view !== 'arena' || state.compareOrigin) throw new Error('Open the competition Arena to compare its current organisms.');
            const parts = await Promise.all(state.runIds.map(id => api('GENERATION', id, String(state.generation))));
            const winners = parts.map(p => p.organisms.toSorted((a, b) => b.eligible - a.eligible || b.fitness - a.fitness || a.ordinal - b.ordinal)[0]);
            if (winners.length !== 2) throw new Error('Two evaluated organisms are required.');
            await api('VOTE', String(winners[side].id), String(winners[1 - side].id));
            note.textContent = 'Preference recorded for generation ' + state.generation + '. Technical scores are unchanged.';
          } catch (error) { note.textContent = error.message; }
        };
        preferences.append(button);
      }
      preferences.append(note); embedded.append(preferences);
    }
    const control = document.querySelector('#genesis-control');
    if (control) {
      const statusText = document.querySelector('#control-heartbeat');
      let refreshing = false, requestedSelection;
      async function refresh() {
        if (refreshing || document.hidden) return;
        refreshing = true;
        try {
          const status = await api('STATUS'), select = document.querySelector('#control-run'), selected = requestedSelection || select.value;
          requestedSelection = undefined;
          select.replaceChildren();
          for (const run of status.runs) { const o = el('option', run.label + ' / ' + run.state); o.value = run.id; select.append(o); }
          if ([...select.options].some(o => o.value === selected)) select.value = selected;
          const run = status.runs.find(r => r.id === select.value), metrics = document.querySelector('#control-metrics');
          metrics.replaceChildren();
          for (const [name, value] of [
            ['STATUS', run?.state || 'No runs'], ['GENERATION', run ? run.generation + ' / ' + run.target : '—'],
            ['BEST FITNESS', run?.best ?? 'Awaiting evaluation'], ['MEAN FITNESS', run?.mean ?? 'Awaiting evaluation'],
            ['DIVERSITY', run?.diversity ?? 'Awaiting evaluation'], ['UNEVALUATED CANDIDATES', run?.pending ?? 0],
            ['MUTATION RATE', run?.mutationRate ?? '—'], ['AI REQUESTS', run?.aiRequests ?? 0],
            ['INPUT / OUTPUT TOKENS', (run?.inputTokens ?? 0) + ' / ' + (run?.outputTokens ?? 0)],
            ['USAGE-BASED COST / USD', run?.usageBasedCostUsd ?? 0], ['UNCERTAIN RESERVATION / USD', run?.uncertainReservedUsd ?? 0],
            ['ELAPSED / SECONDS', run?.elapsedSeconds ?? 0], ['AI PROVIDER', status.provider.enabled ? 'Enabled by owner' : 'Disabled']
          ]) { const cell = el('div'); cell.append(el('span', name), el('strong', String(value))); metrics.append(cell); }
          const events = document.querySelector('#control-events'); events.replaceChildren();
          for (const e of status.events.filter(e => e.runId === run?.id)) {
            const li = el('li'); li.append(el('strong', 'G' + e.generation + ' / ' + e.type), el('span', ' ' + e.details)); events.append(li);
          }
          statusText.textContent = 'Database heartbeat: ' + (run?.heartbeat || 'Unavailable') + ' · Refresh every 5 seconds';
        } catch (error) { statusText.textContent = error.message; }
        finally { refreshing = false; }
      }
      document.querySelector('#control-run').onchange = refresh;
      for (const button of document.querySelectorAll('[data-control]')) button.onclick = async () => {
        try {
          const action = button.dataset.control, run = document.querySelector('#control-run').value;let actionNote='';
          if (action === 'RUN_N') await api('RUN_N', run, String(inputNumber('run-count')));
          else if (action === 'STEP' || action === 'STOP_AI') await api(action, run);
          else if (action === 'CHECKPOINT') {
            const result = await api('CHECKPOINT', run, String(inputNumber('checkpoint-generation')));
            requestedSelection=result.runId;actionNote='Checkpoint duplicated into '+result.runId+'; original history preserved. ';
          } else if (action === 'EXPORT') {
            const index = await api('INDEX'), metadata = index.runs.find(r => r.id === run);
            if (!metadata) throw new Error('Complete at least one generation before exporting.');
            statusText.textContent = 'Exporting ' + metadata.generations.length + ' completed generations…';
            const generations = [];
            for (const g of metadata.generations) generations.push(await api('GENERATION', run, String(g.generation)));
            const link = el('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify({kind: 'private-oracle-run-download', run: metadata, generations})], {type: 'application/json'}));
            link.download = 'genesis-' + run + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
          } else await api('CONTROL', run, action);
          await refresh();if(actionNote)statusText.textContent=actionNote+statusText.textContent;
        } catch (error) { statusText.textContent = error.message; }
      };
      await refresh(); setInterval(refresh, 5000);
    }
    const operations = document.querySelector('#genesis-operations');
    if (operations) {
      // Autonomous Operations (page 9). Reads need READER, commands need OPERATOR;
      // both are enforced by apxgen_web/apxgen_autonomy, not by this script.
      const note = document.querySelector('#ops-status');
      const ago = seconds => seconds == null ? '' : ' (' + (seconds < 120 ? seconds + ' s' : Math.round(seconds / 60) + ' min') + ' ago)';
      let busy = false;
      async function refreshOps() {
        if (busy || document.hidden) return;
        busy = true;
        try {
          const [s, log, publications] = await Promise.all([api('OPS_STATUS'), api('OPS_LOG', '60'), api('OPS_PUBLICATION', '20')]);
          const a = s.activeRun, sv = s.supervisor, c = s.config, b = s.budgets, p = s.publication;
          const metrics = document.querySelector('#ops-metrics'); metrics.replaceChildren();
          for (const [name, value] of [
            ['SUPERVISOR', sv.state + (sv.leaseHeld ? ' · lease held' : '')], ['HEARTBEAT', (sv.heartbeat || 'Never') + ago(sv.heartbeatAgeSeconds)],
            ['AUTONOMY', (c.enabled ? 'Enabled' : 'Disabled') + ' · desired ' + c.desiredState], ['POPULATION MODE', c.populationMode + (c.paidAi ? ' · paid AI on' : ' · paid AI off')],
            ['ACTIVE RUN', a ? '#' + a.sequence + ' · ' + a.policy + ' · seed ' + a.seed : 'None'], ['GENERATION', a ? a.generation + ' / ' + a.target : '—'],
            ['BEST SO FAR', a?.bestSoFar ?? '—'], ['LAST CHECKPOINT', a ? 'G' + a.lastCheckpointGeneration + ' · ' + a.lastCheckpointAt : '—'],
            ['TODAY', b.generationsToday + ' / ' + b.dailyCap + ' generations'], ['ADMISSION', b.admission + ': ' + b.admissionDetail],
            ['STORAGE', Math.round(b.storageBytes / 1048576) + ' MiB of ' + Math.round(b.storageBudgetBytes / 1048576) + ' MiB'],
            ['RUNS', b.autonomousRuns + ' autonomous · ' + b.finishedRuns + ' finished · ' + b.failedRuns + ' failed'],
            ['AUTONOMOUS AI REQUESTS', s.ai.autonomousInvocations], ['PUBLICATION', (c.publishEnabled ? 'Enabled' : 'Disabled') + (p.lastLive ? ' · last ' + p.lastLive.completedAt : ' · never published')],
            ['SCHEDULER JOB', s.scheduler.state], ['PENDING COMMANDS', s.pendingCommands]
          ]) { const cell = el('div'); cell.append(el('span', name), el('strong', String(value))); metrics.append(cell); }
          const warnings = document.querySelector('#ops-warnings'); warnings.replaceChildren();
          for (const w of s.warnings) warnings.append(el('li', w));
          if (p.lastError) warnings.append(el('li', 'Last publication error ' + p.lastError.createdAt + ': ' + p.lastError.error));
          const rows = document.querySelector('#ops-publications'); rows.replaceChildren();
          for (const x of publications) {
            const tr = el('tr');
            for (const v of [x.id, x.state, x.kind, x.generation ?? '—', x.target, (x.sha256 || '').slice(0, 12), x.completedAt || x.error || '—']) tr.append(el('td', String(v)));
            rows.append(tr);
          }
          const list = document.querySelector('#ops-log'); list.replaceChildren();
          for (const x of log) { const li = el('li'); li.append(el('strong', x.at + ' · ' + x.level + ' · ' + x.source), el('span', ' ' + x.message)); list.append(li); }
          if (!note.dataset.sticky) note.textContent = 'Supervisor: ' + (sv.detail || sv.state) + ' · Refresh every 10 seconds';
        } catch (error) { note.textContent = error.message; }
        finally { busy = false; }
      }
      for (const button of document.querySelectorAll('[data-ops]')) button.onclick = async () => {
        if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;
        try {
          const result = await api('OPS_COMMAND', button.dataset.ops);
          note.dataset.sticky = '1';
          note.textContent = button.dataset.ops + ' queued as command #' + result.commandId + '. The supervisor applies it within a few seconds while it holds the lease.';
          setTimeout(() => { delete note.dataset.sticky; }, 15000);
          await refreshOps();
        } catch (error) { note.textContent = error.message; }
      };
      await refreshOps(); setInterval(refreshOps, 10000);
    }
    const create = document.querySelector('#create-experiment');
    if (create) create.onclick = async () => {
      const status = document.querySelector('#create-status');
      try {
        const settings = {};
        for (const [key, id] of Object.entries({mutationRate: 'new-mutation', crossoverRate: 'new-crossover', eliteCount: 'new-elites', tournamentSize: 'new-tournament', diversityThreshold: 'new-diversity', stagnationLimit: 'new-stagnation', generationTimeout: 'new-generation-timeout', totalTimeout: 'new-total-timeout'})) settings[key] = inputNumber(id);
        settings.fitnessWeights = Object.fromEntries(['accessibility', 'hierarchy', 'responsiveness', 'performance'].map(k => [k, inputNumber('weight-' + k)]));
        const result = await api('CREATE', document.querySelector('#new-label').value, document.querySelector('#new-mode').value,
          {x04: String(inputNumber('new-seed')), x05: String(inputNumber('new-size')), x06: String(inputNumber('new-generations')), x07: JSON.stringify(settings)});
        status.textContent = 'Created ' + result.runId + '. Oracle scheduler is active. Start the documented browser evaluation worker to supply observations.';
      } catch (error) { status.textContent = error.message; }
    };
  });
})();
