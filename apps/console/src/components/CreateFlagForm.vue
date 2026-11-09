<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { FLAG_KINDS, KEY_PATTERN, validateVariations } from '@flagken/shared';
import type { FlagKind, Variation } from '@flagken/shared';
import { api, errorMessage } from '../api';
import { useProjects } from '../stores/projects';
import { parseValue, splitList } from './variations';

const emit = defineEmits<{ created: [key: string]; cancel: [] }>();
const projects = useProjects();

const key = ref('');
const name = ref('');
const description = ref('');
const kind = ref<FlagKind>('boolean');
const values = ref<string[]>(['false', 'true']);
const tags = ref('');
const error = ref('');
const busy = ref(false);

watch(kind, (next) => {
  values.value =
    next === 'boolean' ? ['false', 'true'] : next === 'number' ? ['0', '1'] : next === 'json' ? ['{}', '{"enabled": true}'] : ['a', 'b'];
});

const keyValid = computed(() => key.value === '' || KEY_PATTERN.test(key.value));

async function submit() {
  error.value = '';
  let variations: Variation[];
  try {
    variations = values.value.map((text) => ({ value: parseValue(kind.value, text) }));
  } catch (failure) {
    error.value = (failure as Error).message;
    return;
  }
  const problems = validateVariations(kind.value, variations);
  if (problems.length) {
    error.value = problems.join(', ');
    return;
  }
  busy.value = true;
  const { error: failure } = await api.POST('/api/v1/projects/{project}/flags', {
    params: { path: { project: projects.projectKey } },
    body: { key: key.value, name: name.value, description: description.value, kind: kind.value, variations, tags: splitList(tags.value) },
  });
  busy.value = false;
  if (failure) {
    error.value = errorMessage(failure);
    return;
  }
  emit('created', key.value);
}
</script>

<template>
  <form class="card" aria-labelledby="new-flag-title" @submit.prevent="submit">
    <h2 id="new-flag-title">New flag</h2>
    <div class="grid-2">
      <div class="field">
        <label for="new-key">Key</label>
        <input id="new-key" v-model="key" type="text" required pattern="[a-z0-9][a-z0-9._\-]{0,63}" aria-describedby="new-key-help" />
        <p id="new-key-help" class="small" :class="keyValid ? 'muted' : 'notice error'">
          Lower case letters, digits, dot, dash, underscore. Fixed once made.
        </p>
      </div>
      <div class="field">
        <label for="new-name">Name</label>
        <input id="new-name" v-model="name" type="text" required maxlength="100" />
      </div>
    </div>
    <div class="field">
      <label for="new-description">Description</label>
      <input id="new-description" v-model="description" type="text" maxlength="1000" />
    </div>
    <div class="grid-2">
      <div class="field">
        <label for="new-kind">Kind</label>
        <select id="new-kind" v-model="kind">
          <option v-for="k in FLAG_KINDS" :key="k" :value="k">{{ k }}</option>
        </select>
      </div>
      <div class="field">
        <label for="new-tags">Tags (comma separated)</label>
        <input id="new-tags" v-model="tags" type="text" />
      </div>
    </div>
    <fieldset class="field">
      <legend>Variations</legend>
      <div v-for="(_, index) in values" :key="index" class="row field">
        <label class="visually-hidden" :for="`new-variation-${index}`">Variation {{ index + 1 }}</label>
        <input :id="`new-variation-${index}`" v-model="values[index]" type="text" :readonly="kind === 'boolean'" />
        <button v-if="kind !== 'boolean' && values.length > 2" type="button" class="link" @click="values.splice(index, 1)">
          Remove<span class="visually-hidden"> variation {{ index + 1 }}</span>
        </button>
      </div>
      <button v-if="kind !== 'boolean'" type="button" @click="values.push('')">Add variation</button>
    </fieldset>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <div class="row">
      <button class="primary" type="submit" :disabled="busy">Create flag</button>
      <button type="button" @click="emit('cancel')">Cancel</button>
    </div>
  </form>
</template>
