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
