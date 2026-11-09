<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { FlagListItemDto } from '@flagken/api-client';
import { api, errorMessage } from '../api';
import { useLive } from '../stores/live';
import { useProjects } from '../stores/projects';
import { useSession } from '../stores/session';
import CreateFlagForm from '../components/CreateFlagForm.vue';

const projects = useProjects();
const session = useSession();
const live = useLive();
const flags = ref<FlagListItemDto[]>([]);
const query = ref('');
const error = ref('');
const loading = ref(false);
const showCreate = ref(false);

async function load() {
  if (!projects.projectKey) return;
  loading.value = true;
  const { data, error: failure } = await api.GET('/api/v1/projects/{project}/flags', {
    params: {
      path: { project: projects.projectKey },
      query: { environment: projects.environmentKey, ...(query.value ? { q: query.value } : {}) },
    },
  });
  loading.value = false;
  error.value = failure ? errorMessage(failure) : '';
  flags.value = data ?? [];
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(query, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 200);
});
watch(() => [projects.projectKey, projects.environmentKey], load);

const off = live.on((event, data) => {
  const change = data as { projectKey?: string };
  if (event === 'flag.changed' && change.projectKey === projects.projectKey) void load();
});
onMounted(load);
onBeforeUnmount(off);

function stateLabel(flag: FlagListItemDto): { text: string; css: string } {
  if (flag.state.killed) return { text: 'Killed', css: 'killed' };
  return flag.state.on ? { text: 'On', css: 'on' } : { text: 'Off', css: 'off' };
}

async function created(key: string) {
  showCreate.value = false;
  await load();
  document.getElementById(`flag-${key}`)?.focus();
}
</script>

<template>
  <div class="page-head">
    <h1>Flags</h1>
    <button v-if="session.can('editor')" class="primary" type="button" :aria-expanded="showCreate" @click="showCreate = !showCreate">
      New flag
    </button>
  </div>
  <CreateFlagForm v-if="showCreate" @created="created" @cancel="showCreate = false" />
  <div class="card">
    <div class="field">
      <label for="flag-search">Search flags in {{ projects.environmentKey }}</label>
      <input id="flag-search" v-model="query" type="search" placeholder="Key, name or description" />
    </div>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p class="visually-hidden" role="status">{{ loading ? 'Loading flags' : `${flags.length} flags` }}</p>
    <ul class="list" aria-label="Flags">
      <li v-for="flag in flags" :key="flag.key" class="flag-row" :data-flag="flag.key">
        <div>
          <RouterLink :id="`flag-${flag.key}`" :to="`/flags/${flag.key}`">{{ flag.name }}</RouterLink>
          <div class="mono muted small">
            {{ flag.key }} · {{ flag.kind }} · {{ flag.state.rules }} {{ flag.state.rules === 1 ? 'rule' : 'rules' }}
          </div>
          <div v-if="flag.description" class="small">{{ flag.description }}</div>
        </div>
        <div class="row">
          <span v-for="tag in flag.tags" :key="tag" class="badge tag">{{ tag }}</span>
          <span class="badge" :class="stateLabel(flag).css" :data-state="stateLabel(flag).css">{{ stateLabel(flag).text }}</span>
        </div>
      </li>
    </ul>
    <p v-if="!loading && flags.length === 0" class="muted">No flags match.</p>
  </div>
</template>
