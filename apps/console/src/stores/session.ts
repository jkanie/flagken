import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { MeDto } from '@flagken/api-client';
import { api, errorMessage } from '../api';

const RANK = { viewer: 1, editor: 2, owner: 3 } as const;

export const useSession = defineStore('session', () => {
  const user = ref<MeDto | null>(null);
  const checked = ref(false);

  async function load(): Promise<void> {
    const { data } = await api.GET('/api/v1/auth/me');
    user.value = data ?? null;
    checked.value = true;
  }

  async function login(email: string, password: string): Promise<string | null> {
    const { data, error } = await api.POST('/api/v1/auth/login', { body: { email, password } });
    if (error || !data) return errorMessage(error, 'sign-in failed');
    user.value = data;
    checked.value = true;
    return null;
  }

  async function logout(): Promise<void> {
    await api.POST('/api/v1/auth/logout');
    user.value = null;
  }

  function can(role: MeDto['role']): boolean {
    return user.value !== null && RANK[user.value.role] >= RANK[role];
  }

  return { user, checked, load, login, logout, can };
});
