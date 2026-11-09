<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ApiKeyDto, CreatedApiKeyDto } from '@flagken/api-client';
import { api, errorMessage } from '../api';
import { useProjects } from '../stores/projects';
import { useSession } from '../stores/session';

const projects = useProjects();
const session = useSession();
const keys = ref<ApiKeyDto[]>([]);
const created = ref<CreatedApiKeyDto | null>(null);
const name = ref('');
const kind = ref<'server' | 'client'>('server');
const envKey = ref('');
const envName = ref('');
const error = ref('');

async function load() {
  if (!session.can('owner') || !projects.projectKey) return;
  const { data, error: failure } = await api.GET('/api/v1/projects/{project}/environments/{environment}/api-keys', {
    params: { path: { project: projects.projectKey, environment: projects.environmentKey } },
  });
  error.value = failure ? errorMessage(failure) : '';
  keys.value = data ?? [];
}
watch(() => [projects.projectKey, projects.environmentKey], load, { immediate: true });

async function createKey() {
  const { data, error: failure } = await api.POST('/api/v1/projects/{project}/environments/{environment}/api-keys', {
    params: { path: { project: projects.projectKey, environment: projects.environmentKey } },
    body: { name: name.value, kind: kind.value },
  });
  if (failure || !data) {
    error.value = errorMessage(failure);
    return;
  }
  created.value = data;
  name.value = '';
  await load();
}

async function revoke(id: string) {
  await api.DELETE('/api/v1/projects/{project}/environments/{environment}/api-keys/{id}', {
    params: { path: { project: projects.projectKey, environment: projects.environmentKey, id } },
  });
  await load();
}

async function createEnvironment() {
  const { error: failure } = await api.POST('/api/v1/projects/{project}/environments', {
    params: { path: { project: projects.projectKey } },
    body: { key: envKey.value, name: envName.value },
  });
  if (failure) {
    error.value = errorMessage(failure);
    return;
  }
  envKey.value = '';
  envName.value = '';
  await projects.load();
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard blocked: the key stays on screen to copy by hand.
  }
}
</script>

<template>
  <div class="page-head">
    <h1>Environments and API keys</h1>
  </div>
  <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  <div class="grid-2">
    <section class="card" aria-labelledby="env-title">
      <h2 id="env-title">Environments of {{ projects.project?.name }}</h2>
      <ul class="list">
        <li v-for="e in projects.environments" :key="e.key" class="row">
          <strong>{{ e.name }}</strong>
          <span class="mono muted">{{ e.key }}</span>
          <span v-if="e.key === projects.environmentKey" class="badge on">Selected</span>
          <button v-else type="button" class="link" @click="projects.selectEnvironment(e.key)">
            Select<span class="visually-hidden"> {{ e.name }}</span>
          </button>
        </li>
      </ul>
      <form v-if="session.can('owner')" @submit.prevent="createEnvironment">
        <h3>Add environment</h3>
        <div class="grid-2">
          <div class="field">
            <label for="env-key">Key</label>
            <input id="env-key" v-model="envKey" type="text" required pattern="[a-z0-9][a-z0-9._\-]{0,63}" />
          </div>
          <div class="field">
            <label for="env-name">Name</label>
            <input id="env-name" v-model="envName" type="text" required />
          </div>
        </div>
        <button type="submit">Add environment</button>
      </form>
    </section>

    <section class="card" aria-labelledby="keys-title">
      <h2 id="keys-title">API keys for {{ projects.environmentKey }}</h2>
      <template v-if="session.can('owner')">
        <p class="muted small">
          Server keys read flag rules (back-end services). Client keys read evaluated values only (browsers and apps).
        </p>
        <div v-if="created" class="notice ok" role="status">
          <p style="margin-top: 0">New {{ created.kind }} key "{{ created.name }}". It is shown once: copy it now.</p>
          <p class="secret-box mono" data-testid="new-key">{{ created.key }}</p>
          <button type="button" @click="copy(created.key)">Copy key</button>
        </div>
        <div class="table-wrap">
          <table>
            <caption class="visually-hidden">
              API keys
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Kind</th>
                <th scope="col">Starts with</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="k in keys" :key="k.id">
                <td>{{ k.name }}</td>
                <td>{{ k.kind }}</td>
                <td class="mono">{{ k.prefix }}</td>
                <td>
                  <span v-if="k.revokedAt" class="badge killed">Revoked</span>
                  <button v-else type="button" class="link" @click="revoke(k.id)">
                    Revoke<span class="visually-hidden"> {{ k.name }}</span>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <form style="margin-top: 1rem" @submit.prevent="createKey">
          <h3>New API key</h3>
          <div class="grid-2">
            <div class="field">
              <label for="key-name">Name</label>
              <input id="key-name" v-model="name" type="text" required maxlength="100" />
            </div>
            <div class="field">
              <label for="key-kind">Kind</label>
              <select id="key-kind" v-model="kind">
                <option value="server">server</option>
                <option value="client">client</option>
              </select>
            </div>
          </div>
          <button class="primary" type="submit">Create key</button>
        </form>
      </template>
      <p v-else class="muted">Only owners manage API keys.</p>
    </section>
  </div>
</template>
