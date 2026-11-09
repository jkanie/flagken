<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { CreatedWebhookDto, Schemas, WebhookDeliveryDto, WebhookDto } from '@flagken/api-client';

type WebhookEvent = Schemas['CreateWebhookDto']['events'][number];
import { api, errorMessage } from '../api';
import { useLive } from '../stores/live';
import { useProjects } from '../stores/projects';
import { useSession } from '../stores/session';

const EVENTS = [
  '*',
  'flag.created',
  'flag.updated',
  'flag.archived',
  'flag.state.updated',
  'flag.killed',
  'flag.unkilled',
  'flag.schedule.executed',
] as const;

const projects = useProjects();
const session = useSession();
const live = useLive();
const hooks = ref<WebhookDto[]>([]);
const deliveries = ref<Record<string, WebhookDeliveryDto[]>>({});
const open = ref<string | null>(null);
const created = ref<CreatedWebhookDto | null>(null);
const name = ref('');
const url = ref('');
const events = ref<WebhookEvent[]>(['flag.state.updated', 'flag.killed']);
const error = ref('');
const message = ref('');

async function load() {
  if (!session.can('owner') || !projects.projectKey) return;
  const { data, error: failure } = await api.GET('/api/v1/projects/{project}/webhooks', {
    params: { path: { project: projects.projectKey } },
  });
  error.value = failure ? errorMessage(failure) : '';
  hooks.value = data ?? [];
  if (open.value) await loadDeliveries(open.value);
}
watch(() => projects.projectKey, load, { immediate: true });

async function loadDeliveries(id: string) {
  const { data } = await api.GET('/api/v1/projects/{project}/webhooks/{id}/deliveries', {
    params: { path: { project: projects.projectKey, id } },
  });
  deliveries.value = { ...deliveries.value, [id]: data ?? [] };
}

async function toggle(id: string) {
  open.value = open.value === id ? null : id;
  if (open.value) await loadDeliveries(id);
}

const off = live.on((event, data) => {
  const delivery = data as { webhookId?: string };
  if (event === 'webhook.delivery' && delivery.webhookId && delivery.webhookId === open.value) void loadDeliveries(delivery.webhookId);
});
onBeforeUnmount(off);

async function create() {
  error.value = '';
  const { data, error: failure } = await api.POST('/api/v1/projects/{project}/webhooks', {
    params: { path: { project: projects.projectKey } },
    body: { name: name.value, url: url.value, events: events.value },
  });
  if (failure || !data) {
    error.value = errorMessage(failure);
    return;
  }
  created.value = data;
  name.value = '';
  url.value = '';
  await load();
}

async function setActive(hook: WebhookDto, active: boolean) {
  const { error: failure } = await api.PUT('/api/v1/projects/{project}/webhooks/{id}', {
    params: { path: { project: projects.projectKey, id: hook.id } },
    body: { name: hook.name, url: hook.url, events: hook.events as WebhookEvent[], active },
  });
  if (failure) error.value = errorMessage(failure);
  await load();
}

async function remove(id: string) {
  await api.DELETE('/api/v1/projects/{project}/webhooks/{id}', { params: { path: { project: projects.projectKey, id } } });
  await load();
}

async function test(id: string) {
  const { error: failure } = await api.POST('/api/v1/projects/{project}/webhooks/{id}/test', {
    params: { path: { project: projects.projectKey, id } },
  });
  message.value = failure ? '' : 'Test event queued. The delivery log updates when it is sent.';
  if (failure) error.value = errorMessage(failure);
  open.value = id;
  await loadDeliveries(id);
}
</script>

<template>
  <div class="page-head">
    <h1>Webhooks</h1>
  </div>
  <template v-if="session.can('owner')">
    <div role="status" aria-live="polite">
      <p v-if="message" class="notice ok">{{ message }}</p>
    </div>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <div v-if="created" class="notice ok" role="status">
      <p style="margin-top: 0">
        Signing secret for "{{ created.name }}". It is shown once. Receivers check the Flagken-Signature header with it.
      </p>
      <p class="secret-box mono" data-testid="webhook-secret">{{ created.secret }}</p>
    </div>
    <section class="card" aria-labelledby="hooks-title">
      <h2 id="hooks-title">Endpoints</h2>
      <ul class="list">
        <li v-for="hook in hooks" :key="hook.id" :data-webhook="hook.name">
          <div class="row">
            <strong>{{ hook.name }}</strong>
            <span class="badge" :class="hook.active ? 'on' : 'off'">{{ hook.active ? 'Active' : 'Paused' }}</span>
            <span class="mono small muted">{{ hook.url }}</span>
          </div>
          <div class="small muted">Events: {{ hook.events.join(', ') }}</div>
          <div class="row">
            <button type="button" class="link" :aria-expanded="open === hook.id" @click="toggle(hook.id)">
              Delivery log<span class="visually-hidden"> of {{ hook.name }}</span>
            </button>
            <button type="button" class="link" @click="test(hook.id)">
              Send test<span class="visually-hidden"> to {{ hook.name }}</span>
            </button>
            <button type="button" class="link" @click="setActive(hook, !hook.active)">
              {{ hook.active ? 'Pause' : 'Resume' }}<span class="visually-hidden"> {{ hook.name }}</span>
            </button>
            <button type="button" class="link" @click="remove(hook.id)">
              Delete<span class="visually-hidden"> {{ hook.name }}</span>
            </button>
          </div>
          <div v-if="open === hook.id" class="table-wrap">
            <table>
              <caption class="visually-hidden">
                Deliveries of
                {{
                  hook.name
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Event</th>
                  <th scope="col">Attempt</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in deliveries[hook.id] ?? []" :key="d.id" :data-delivery="d.ok ? 'ok' : 'failed'">
                  <td>{{ new Date(d.createdAt).toLocaleString() }}</td>
                  <td class="mono">{{ d.eventType }}</td>
                  <td>{{ d.attempt }}</td>
                  <td>
                    <span class="badge" :class="d.ok ? 'on' : 'killed'">{{ d.ok ? 'Delivered' : 'Failed' }}</span>
                    {{ d.statusCode ?? '' }} {{ d.error ?? '' }} ({{ d.durationMs }} ms)
                  </td>
                </tr>
                <tr v-if="(deliveries[hook.id] ?? []).length === 0">
                  <td colspan="4" class="muted">No deliveries yet.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </li>
      </ul>
      <p v-if="hooks.length === 0" class="muted">No webhooks yet.</p>
    </section>
    <form class="card" aria-labelledby="new-hook-title" @submit.prevent="create">
      <h2 id="new-hook-title">New webhook</h2>
      <div class="grid-2">
        <div class="field">
          <label for="hook-name">Name</label>
          <input id="hook-name" v-model="name" type="text" required maxlength="100" />
        </div>
        <div class="field">
          <label for="hook-url">URL</label>
          <input id="hook-url" v-model="url" type="url" required placeholder="https://hooks.example.com/flagken" />
        </div>
      </div>
      <fieldset class="field">
        <legend>Events</legend>
        <div class="row">
          <label v-for="e in EVENTS" :key="e" class="inline-check">
            <input v-model="events" type="checkbox" :value="e" />
            <span class="mono">{{ e === '*' ? 'every event' : e }}</span>
          </label>
        </div>
      </fieldset>
      <p class="muted small">Private, loopback and link-local addresses are refused unless the server runs with ALLOW_PRIVATE_TARGETS.</p>
      <button class="primary" type="submit">Add webhook</button>
    </form>
  </template>
  <p v-else class="muted">Only owners manage webhooks.</p>
</template>
