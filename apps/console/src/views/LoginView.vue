<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../stores/session';

const session = useSession();
const router = useRouter();
const route = useRoute();
const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = (await session.login(email.value, password.value)) ?? '';
  busy.value = false;
  if (!error.value) {
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/flags';
    await router.push(next);
  }
}
</script>

<template>
  <div class="login card">
    <h1>Sign in to flagken</h1>
    <p class="muted small">Accounts are made by an owner. There is no public sign-up.</p>
    <form @submit.prevent="submit">
      <div class="field">
        <label for="email">E-mail</label>
        <input id="email" v-model="email" type="email" autocomplete="username" required />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password" required />
      </div>
      <p v-if="error" class="notice error" role="alert">{{ error }}</p>
      <button class="primary" type="submit" :disabled="busy">Sign in</button>
    </form>
  </div>
</template>
