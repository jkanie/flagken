<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useLive } from './stores/live';
import { useProjects } from './stores/projects';
import { useSession } from './stores/session';

const session = useSession();
const projects = useProjects();
const live = useLive();
const route = useRoute();
const router = useRouter();

const signedIn = computed(() => session.user !== null && route.name !== 'login');

watch(
  () => session.user,
  async (user) => {
    if (user) {
      await projects.load();
      if (projects.projectKey) live.watch(projects.projectKey);
    } else {
      live.stop();
    }
  },
  { immediate: true },
);

watch(
  () => projects.projectKey,
  (key) => {
    if (key && session.user) live.watch(key);
  },
);

async function signOut() {
  await session.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <a class="skip-link" href="#main">Skip to content</a>
  <header v-if="signedIn" class="topbar">
    <div class="topbar-inner">
      <RouterLink class="brand" to="/flags" aria-label="flagken home">
        <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="#0f5e56" />
          <path
            d="M10 7v18M10 8h11l-3 4 3 4H10"
            fill="none"
            stroke="#fff"
            stroke-width="2.5"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
        flagken
      </RouterLink>
      <div class="topbar-controls">
        <label class="visually-hidden" for="project-select">Project</label>
        <select
          id="project-select"
          :value="projects.projectKey"
          @change="projects.selectProject(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="p in projects.projects" :key="p.key" :value="p.key">{{ p.name }}</option>
        </select>
        <label class="visually-hidden" for="environment-select">Environment</label>
        <select
          id="environment-select"
          :value="projects.environmentKey"
          @change="projects.selectEnvironment(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="e in projects.environments" :key="e.key" :value="e.key">{{ e.name }}</option>
        </select>
        <span class="live-dot" :class="{ live: live.connected }" role="status">{{ live.connected ? 'Live' : 'Offline' }}</span>
        <span class="muted small">{{ session.user?.email }} ({{ session.user?.role }})</span>
        <button type="button" @click="signOut">Sign out</button>
      </div>
    </div>
  </header>
  <div class="shell">
    <nav v-if="signedIn" class="nav" aria-label="Main">
      <RouterLink to="/flags">Flags</RouterLink>
      <RouterLink to="/environments">Environments and keys</RouterLink>
      <RouterLink to="/webhooks">Webhooks</RouterLink>
      <RouterLink to="/audit">Audit log</RouterLink>
      <RouterLink v-if="session.can('owner')" to="/users">Users</RouterLink>
    </nav>
    <main id="main" tabindex="-1">
      <RouterView />
    </main>
  </div>
</template>
