<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { FlagDto, FlagStateDto, ScheduledChangeDto } from '@flagken/api-client';
import { CLAUSE_OPS, validateEnvironmentState } from '@flagken/shared';
import type { Clause, ClauseValue, FlagEnvironmentState, JsonValue, Rule } from '@flagken/shared';
import { api, errorMessage, failureOf } from '../api';
import { useLive } from '../stores/live';
import type { FlagChanged } from '../stores/live';
import { useProjects } from '../stores/projects';
import { useSession } from '../stores/session';
import ServeEditor from '../components/ServeEditor.vue';
import { formatValue, splitList } from '../components/variations';

const props = defineProps<{ flagKey: string }>();
const flagKey = computed(() => props.flagKey);
const projects = useProjects();
const session = useSession();
const live = useLive();
const canEdit = computed(() => session.can('editor'));

const flag = ref<FlagDto | null>(null);
const state = ref<FlagStateDto | null>(null);
const etag = ref('');
const draft = ref<FlagEnvironmentState | null>(null);
const targetText = ref<string[]>([]);
const message = ref('');
const error = ref('');
const conflict = ref(false);
const remoteChange = ref('');
const saving = ref(false);
const schedules = ref<ScheduledChangeDto[]>([]);
const scheduleAt = ref('');
const scheduleOn = ref('true');

const variationNames = computed(() => (flag.value?.variations ?? []).map((v, i) => v.name ?? `${i}: ${formatValue(v.value as JsonValue)}`));

function snapshot(s: FlagStateDto): FlagEnvironmentState {
  return JSON.parse(
    JSON.stringify({
      on: s.on,
      killed: s.killed,
      offVariation: s.offVariation,
      fallthrough: s.fallthrough,
      targets: s.targets,
      rules: s.rules,
    }),
  );
}

const dirty = computed(() => {
  if (!state.value || !draft.value) return false;
  return JSON.stringify(withTargets()) !== JSON.stringify(snapshot(state.value));
});

/** The draft with the target text boxes folded in. */
function withTargets(): FlagEnvironmentState {
  const base = draft.value!;
  const targets = targetText.value.map((text, variation) => ({ variation, values: splitList(text) })).filter((t) => t.values.length > 0);
  return { ...base, targets };
}

const problems = computed(() => (draft.value && flag.value ? validateEnvironmentState(withTargets(), flag.value.variations.length) : []));

async function load() {
  error.value = '';
  conflict.value = false;
  remoteChange.value = '';
  const project = projects.projectKey;
  const environment = projects.environmentKey;
  const [flagResult, stateResult, scheduleResult] = await Promise.all([
    api.GET('/api/v1/projects/{project}/flags/{flag}', { params: { path: { project, flag: flagKey.value } } }),
    api.GET('/api/v1/projects/{project}/flags/{flag}/environments/{environment}', {
      params: { path: { project, flag: flagKey.value, environment } },
    }),
    api.GET('/api/v1/projects/{project}/flags/{flag}/environments/{environment}/schedules', {
      params: { path: { project, flag: flagKey.value, environment } },
    }),
  ]);
  if (flagResult.error || stateResult.error || !flagResult.data || !stateResult.data) {
    error.value = errorMessage(flagResult.error ?? stateResult.error, 'could not load the flag');
    return;
  }
  flag.value = flagResult.data;
  state.value = stateResult.data;
  etag.value = stateResult.response.headers.get('etag') ?? '';
  draft.value = snapshot(stateResult.data);
  targetText.value = flagResult.data.variations.map((_, i) =>
    (stateResult.data.targets.find((t) => t.variation === i)?.values ?? []).join(', '),
  );
  schedules.value = scheduleResult.data ?? [];
}

watch(() => [flagKey.value, projects.projectKey, projects.environmentKey], load, { immediate: true });

const off = live.on((event, data) => {
  if (event !== 'flag.changed') return;
  const change = data as FlagChanged;
  if (change.projectKey !== projects.projectKey || change.flagKey !== flagKey.value) return;
  if (change.environmentKey !== null && change.environmentKey !== projects.environmentKey) return;
  if (saving.value) return;
  if (dirty.value) {
    remoteChange.value = `Someone else changed this flag (${change.summary}) while you were editing.`;
  } else {
    void load().then(() => (message.value = `Updated live: ${change.summary}.`));
  }
});
onBeforeUnmount(off);

async function save() {
  if (!draft.value || problems.value.length) return;
  saving.value = true;
  message.value = '';
  error.value = '';
  const body = withTargets();
  const result = await api.PUT('/api/v1/projects/{project}/flags/{flag}/environments/{environment}', {
    params: {
      path: { project: projects.projectKey, flag: flagKey.value, environment: projects.environmentKey },
      header: { 'If-Match': etag.value },
    },
    body: { on: body.on, offVariation: body.offVariation, fallthrough: body.fallthrough, targets: body.targets, rules: body.rules },
  });
  saving.value = false;
  if (result.response.status === 412) {
    conflict.value = true;
    return;
  }
  if (result.error || !result.data) {
    error.value = errorMessage(result.error);
    return;
  }
  state.value = result.data;
  etag.value = result.response.headers.get('etag') ?? '';
  draft.value = snapshot(result.data);
  remoteChange.value = '';
  message.value = `Saved. ${projects.environmentKey} now runs version ${result.data.version}.`;
}

async function setKilled(killed: boolean) {
  const result = await api.PUT('/api/v1/projects/{project}/flags/{flag}/environments/{environment}/kill', {
    params: { path: { project: projects.projectKey, flag: flagKey.value, environment: projects.environmentKey } },
    body: { killed },
  });
  const failure = failureOf(result);
  if (failure) {
    error.value = failure;
    return;
  }
  await load();
  message.value = killed ? 'Kill switch on: every user gets the off variation.' : 'Kill switch off: targeting applies again.';
}

function addRule() {
  draft.value!.rules.push({
    id: `rule-${Date.now().toString(36)}`,
    clauses: [{ attribute: 'country', op: 'in', values: [] }],
    serve: { variation: 0 },
  });
}

function moveRule(index: number, by: number) {
  const rules = draft.value!.rules;
  const [rule] = rules.splice(index, 1);
  rules.splice(index + by, 0, rule!);
}

function clauseText(clause: Clause): string {
  return clause.values.map(String).join(', ');
}

/** Numbers stay numbers for the comparison operators, the rest are strings. */
function setClauseValues(clause: Clause, text: string) {
  const numeric = ['lt', 'lte', 'gt', 'gte'].includes(clause.op);
  clause.values = splitList(text).map((v): ClauseValue => (numeric && v !== '' && Number.isFinite(Number(v)) ? Number(v) : v));
}

function ruleLabel(rule: Rule, index: number): string {
  return rule.description || `Rule ${index + 1}`;
}

async function addSchedule() {
  const result = await api.POST('/api/v1/projects/{project}/flags/{flag}/environments/{environment}/schedules', {
    params: { path: { project: projects.projectKey, flag: flagKey.value, environment: projects.environmentKey } },
    body: { runAt: new Date(scheduleAt.value).toISOString(), change: { on: scheduleOn.value === 'true' } },
  });
  const failure = failureOf(result);
  if (failure) {
    error.value = failure;
    return;
  }
  scheduleAt.value = '';
  message.value = 'Change scheduled.';
  await load();
}

async function cancelSchedule(id: string) {
  await api.DELETE('/api/v1/projects/{project}/flags/{flag}/environments/{environment}/schedules/{id}', {
    params: { path: { project: projects.projectKey, flag: flagKey.value, environment: projects.environmentKey, id } },
  });
  await load();
}
</script>

<template>
  <div v-if="flag && state && draft">
    <div class="page-head">
      <div>
        <h1>{{ flag.name }}</h1>
        <p class="mono muted small">{{ flag.key }} · {{ flag.kind }} · {{ projects.environmentKey }} · version {{ state.version }}</p>
      </div>
      <RouterLink to="/flags">Back to flags</RouterLink>
    </div>
    <p v-if="flag.description">{{ flag.description }}</p>

    <div role="status" aria-live="polite">
      <p v-if="message" class="notice ok">{{ message }}</p>
    </div>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <div v-if="conflict" class="notice warn" role="alert">
      Someone saved this flag after you opened it, so your save was refused (412). Re-load to see their change, then edit again.
      <button type="button" @click="load">Re-load</button>
    </div>
    <div v-if="remoteChange && !conflict" class="notice warn" role="alert">
      {{ remoteChange }}
      <button type="button" @click="load">Re-load and drop my edits</button>
    </div>

    <section class="card kill-switch" aria-labelledby="kill-title">
      <div>
        <h2 id="kill-title">Kill switch</h2>
        <p class="small" style="margin: 0">
          <span class="badge" :class="state.killed ? 'killed' : 'on'">{{ state.killed ? 'Killed' : 'Not killed' }}</span>
          Serves the off variation to everyone at once and keeps the rules as they are.
        </p>
      </div>
      <button
        v-if="canEdit"
        type="button"
        :class="state.killed ? '' : 'danger'"
        :aria-pressed="state.killed"
        @click="setKilled(!state.killed)"
      >
        {{ state.killed ? 'Turn kill switch off' : 'Kill this flag' }}
      </button>
    </section>

    <form class="stack" @submit.prevent="save">
      <section class="card" aria-labelledby="targeting-title">
        <h2 id="targeting-title">Targeting in {{ projects.environmentKey }}</h2>
        <label class="inline-check field">
          <input v-model="draft.on" type="checkbox" :disabled="!canEdit" />
          Targeting on
        </label>
        <div class="field">
          <label for="off-variation">When targeting is off, serve</label>
          <select id="off-variation" v-model.number="draft.offVariation" :disabled="!canEdit">
            <option v-for="(name, index) in variationNames" :key="index" :value="index">{{ name }}</option>
          </select>
        </div>
      </section>

      <section class="card" aria-labelledby="targets-title">
        <h2 id="targets-title">Individual targets</h2>
        <p class="muted small">Context keys, comma separated. They win over every rule.</p>
        <div v-for="(name, index) in variationNames" :key="index" class="field">
          <label :for="`targets-${index}`">Serve {{ name }} to</label>
          <input :id="`targets-${index}`" v-model="targetText[index]" type="text" :disabled="!canEdit" />
        </div>
      </section>

      <section class="card" aria-labelledby="rules-title">
        <h2 id="rules-title">Rules</h2>
        <p class="muted small">Checked top to bottom. The first rule whose conditions all match decides.</p>
        <div v-for="(rule, index) in draft.rules" :key="rule.id" class="rule" :aria-label="ruleLabel(rule, index)" role="group">
          <div class="row field">
            <h3 style="margin: 0">{{ ruleLabel(rule, index) }}</h3>
            <span class="row" style="margin-left: auto">
              <button type="button" class="link" :disabled="index === 0 || !canEdit" @click="moveRule(index, -1)">
                Up<span class="visually-hidden"> {{ ruleLabel(rule, index) }}</span>
              </button>
              <button type="button" class="link" :disabled="index === draft.rules.length - 1 || !canEdit" @click="moveRule(index, 1)">
                Down<span class="visually-hidden"> {{ ruleLabel(rule, index) }}</span>
              </button>
              <button type="button" class="link" :disabled="!canEdit" @click="draft.rules.splice(index, 1)">
                Remove<span class="visually-hidden"> {{ ruleLabel(rule, index) }}</span>
              </button>
            </span>
          </div>
          <div class="field">
            <label :for="`rule-${index}-description`">Description</label>
            <input :id="`rule-${index}-description`" v-model="rule.description" type="text" :disabled="!canEdit" />
          </div>
          <div v-for="(clause, c) in rule.clauses" :key="c" class="clause">
            <div>
              <label :for="`rule-${index}-clause-${c}-attribute`">Attribute</label>
              <input :id="`rule-${index}-clause-${c}-attribute`" v-model="clause.attribute" type="text" :disabled="!canEdit" />
            </div>
            <div>
              <label :for="`rule-${index}-clause-${c}-op`">Operator</label>
              <select :id="`rule-${index}-clause-${c}-op`" v-model="clause.op" :disabled="!canEdit">
                <option v-for="op in CLAUSE_OPS" :key="op" :value="op">{{ op }}</option>
              </select>
            </div>
            <div class="clause-values">
              <label :for="`rule-${index}-clause-${c}-values`">Values (comma separated)</label>
              <input
                :id="`rule-${index}-clause-${c}-values`"
                type="text"
                :value="clauseText(clause)"
                :disabled="!canEdit"
                @change="setClauseValues(clause, ($event.target as HTMLInputElement).value)"
              />
            </div>
            <label class="inline-check"><input v-model="clause.negate" type="checkbox" :disabled="!canEdit" /> Not</label>
            <button type="button" class="link" :disabled="rule.clauses.length === 1 || !canEdit" @click="rule.clauses.splice(c, 1)">
              Remove<span class="visually-hidden"> condition {{ c + 1 }}</span>
            </button>
          </div>
          <button type="button" :disabled="!canEdit" @click="rule.clauses.push({ attribute: '', op: 'in', values: [] })">
            Add condition
          </button>
          <ServeEditor v-model="rule.serve" :variation-names="variationNames" :id-prefix="`rule-${index}-serve`" legend="Then serve" />
        </div>
        <button type="button" :disabled="!canEdit" @click="addRule">Add rule</button>
      </section>

      <section class="card" aria-labelledby="default-title">
        <h2 id="default-title">Default rule</h2>
        <ServeEditor v-model="draft.fallthrough" :variation-names="variationNames" id-prefix="fallthrough" legend="Everyone else gets" />
      </section>

      <div v-if="problems.length" class="notice error" role="alert">
        <p style="margin: 0">Fix before saving:</p>
        <ul>
          <li v-for="p in problems" :key="p">{{ p }}</li>
        </ul>
      </div>
      <div v-if="canEdit" class="row">
        <button class="primary" type="submit" :disabled="!dirty || saving || problems.length > 0">Save changes</button>
        <button type="button" :disabled="!dirty" @click="load">Discard</button>
        <span v-if="dirty" class="muted small">Unsaved changes</span>
      </div>
    </form>

    <section class="card" aria-labelledby="schedule-title" style="margin-top: 1rem">
      <h2 id="schedule-title">Scheduled changes</h2>
      <ul v-if="schedules.length" class="list">
        <li v-for="s in schedules" :key="s.id" class="row">
          <span>{{ new Date(s.runAt).toLocaleString() }}: turn {{ s.change.on ? 'on' : 'off' }}</span>
          <span class="badge" :class="s.status === 'done' ? 'on' : s.status === 'failed' ? 'killed' : 'off'">{{ s.status }}</span>
          <button v-if="s.status === 'pending' && canEdit" type="button" class="link" @click="cancelSchedule(s.id)">
            Cancel<span class="visually-hidden"> change at {{ new Date(s.runAt).toLocaleString() }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="muted">None.</p>
      <form v-if="canEdit" class="row" @submit.prevent="addSchedule">
        <div class="field">
          <label for="schedule-at">At</label>
          <input id="schedule-at" v-model="scheduleAt" type="datetime-local" required />
        </div>
        <div class="field">
          <label for="schedule-action">Change</label>
          <select id="schedule-action" v-model="scheduleOn">
            <option value="true">Turn targeting on</option>
            <option value="false">Turn targeting off</option>
          </select>
        </div>
        <button type="submit">Schedule</button>
      </form>
    </section>
  </div>
  <p v-else-if="error" class="notice error" role="alert">{{ error }}</p>
  <p v-else class="muted" role="status">Loading flag.</p>
</template>
