<script setup lang="ts">
import { ref, watch } from 'vue';
import type { AuditEntryDto } from '@flagken/api-client';
import type { JsonValue } from '@flagken/shared';
import { api, errorMessage } from '../api';
import { useLive } from '../stores/live';
import { useProjects } from '../stores/projects';
import DiffView from '../components/DiffView.vue';

const projects = useProjects();
const live = useLive();
const entries = ref<AuditEntryDto[]>([]);
const environment = ref('');
const flag = ref('');
const error = ref('');
const more = ref(false);
const PAGE = 25;

async function load(append = false) {
  if (!projects.projectKey) return;
  const before = append ? entries.value.at(-1)?.id : undefined;
  const { data, error: failure } = await api.GET('/api/v1/projects/{project}/audit', {
    params: {
      path: { project: projects.projectKey },
      query: {
        limit: PAGE,
        ...(environment.value ? { environment: environment.value } : {}),
        ...(flag.value ? { flag: flag.value } : {}),
        ...(before ? { before } : {}),
      },
    },
  });
  error.value = failure ? errorMessage(failure) : '';
  const page = data ?? [];
  entries.value = append ? [...entries.value, ...page] : page;
  more.value = page.length === PAGE;
}
watch(
  () => [projects.projectKey, environment.value],
  () => load(),
  { immediate: true },
);
watch(
  () => live.lastAudit,
  () => load(),
);
</script>

<template>
  <div class="page-head">
    <h1>Audit log</h1>
  </div>
  <form class="card row" @submit.prevent="load()">
    <div class="field">
      <label for="audit-env">Environment</label>
      <select id="audit-env" v-model="environment">
        <option value="">All</option>
        <option v-for="e in projects.environments" :key="e.key" :value="e.key">{{ e.name }}</option>
      </select>
    </div>
    <div class="field">
      <label for="audit-flag">Flag key</label>
      <input id="audit-flag" v-model="flag" type="text" />
    </div>
    <button type="submit">Filter</button>
  </form>
  <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  <ul class="list card" aria-label="Audit entries">
    <li v-for="entry in entries" :key="entry.id" :data-action="entry.action">
      <div class="row">
        <strong class="mono">{{ entry.action }}</strong>
        <span
          >{{ entry.resourceType }} <span class="mono">{{ entry.resourceKey }}</span></span
        >
        <span v-if="entry.environment" class="badge tag">{{ entry.environment }}</span>
      </div>
      <p class="small muted" style="margin: 0.25rem 0">
        {{ entry.actor.label }} · <time :datetime="entry.at">{{ new Date(entry.at).toLocaleString() }}</time>
      </p>
      <details>
        <summary>Changes</summary>
        <DiffView
          :before="entry.before as JsonValue"
          :after="entry.after as JsonValue"
          :caption="`Changes in ${entry.action} ${entry.resourceKey}`"
        />
      </details>
    </li>
    <li v-if="entries.length === 0" class="muted">No entries.</li>
  </ul>
  <button v-if="more" type="button" @click="load(true)">Load older entries</button>
</template>
