import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ProjectDto } from '@flagken/api-client';
import { api, prefs } from '../api';

export const useProjects = defineStore('projects', () => {
  const projects = ref<ProjectDto[]>([]);
  const projectKey = ref(prefs.get('project') ?? '');
  const environmentKey = ref(prefs.get('environment') ?? 'development');

  const project = computed(() => projects.value.find((p) => p.key === projectKey.value));
  const environments = computed(() => project.value?.environments ?? []);

  async function load(): Promise<void> {
    const { data } = await api.GET('/api/v1/projects');
    projects.value = data ?? [];
    if (!project.value && projects.value[0]) projectKey.value = projects.value[0].key;
    if (!environments.value.some((e) => e.key === environmentKey.value) && environments.value[0]) {
      environmentKey.value = environments.value[0].key;
    }
  }

  function selectProject(key: string): void {
    projectKey.value = key;
    prefs.set('project', key);
  }

  function selectEnvironment(key: string): void {
    environmentKey.value = key;
    prefs.set('environment', key);
  }

  return { projects, projectKey, environmentKey, project, environments, load, selectProject, selectEnvironment };
});
