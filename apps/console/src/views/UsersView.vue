<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { UserDto } from '@flagken/api-client';
import { api, errorMessage } from '../api';
import { useSession } from '../stores/session';

const session = useSession();
const users = ref<UserDto[]>([]);
const email = ref('');
const password = ref('');
const role = ref<UserDto['role']>('viewer');
const error = ref('');

async function load() {
  if (!session.can('owner')) return;
  const { data, error: failure } = await api.GET('/api/v1/users');
  error.value = failure ? errorMessage(failure) : '';
  users.value = data ?? [];
}
onMounted(load);

async function create() {
  const { error: failure } = await api.POST('/api/v1/users', { body: { email: email.value, password: password.value, role: role.value } });
  if (failure) {
    error.value = errorMessage(failure);
    return;
  }
  email.value = '';
  password.value = '';
  await load();
}

async function update(user: UserDto, change: { role?: UserDto['role']; disabled?: boolean }) {
  const { error: failure } = await api.PATCH('/api/v1/users/{id}', { params: { path: { id: user.id } }, body: change });
  error.value = failure ? errorMessage(failure) : '';
  await load();
}
</script>

<template>
  <div class="page-head">
    <h1>Users</h1>
  </div>
  <template v-if="session.can('owner')">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <section class="card" aria-labelledby="users-title">
      <h2 id="users-title">Console users</h2>
      <div class="table-wrap">
        <table>
          <caption class="visually-hidden">
            Console users
          </caption>
          <thead>
            <tr>
              <th scope="col">E-mail</th>
              <th scope="col">Role</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td>{{ u.email }}</td>
              <td>
                <label class="visually-hidden" :for="`role-${u.id}`">Role of {{ u.email }}</label>
                <select
                  :id="`role-${u.id}`"
                  :value="u.role"
                  :disabled="u.id === session.user?.id"
                  @change="update(u, { role: ($event.target as HTMLSelectElement).value as UserDto['role'] })"
                >
                  <option value="owner">owner</option>
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                </select>
              </td>
              <td>
                <span class="badge" :class="u.disabled ? 'killed' : 'on'">{{ u.disabled ? 'Disabled' : 'Active' }}</span>
                <button v-if="u.id !== session.user?.id" type="button" class="link" @click="update(u, { disabled: !u.disabled })">
                  {{ u.disabled ? 'Enable' : 'Disable' }}<span class="visually-hidden"> {{ u.email }}</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <form class="card" aria-labelledby="new-user-title" @submit.prevent="create">
      <h2 id="new-user-title">Add a user</h2>
      <div class="grid-2">
        <div class="field">
          <label for="user-email">E-mail</label>
          <input id="user-email" v-model="email" type="email" required autocomplete="off" />
        </div>
        <div class="field">
          <label for="user-password">First password (12 characters or more)</label>
          <input id="user-password" v-model="password" type="password" required minlength="12" autocomplete="new-password" />
        </div>
      </div>
      <div class="field">
        <label for="user-role">Role</label>
        <select id="user-role" v-model="role">
          <option value="viewer">viewer: reads everything</option>
          <option value="editor">editor: changes flags</option>
          <option value="owner">owner: also users, keys, webhooks</option>
        </select>
      </div>
      <button class="primary" type="submit">Add user</button>
    </form>
  </template>
  <p v-else class="muted">Only owners manage users.</p>
</template>
