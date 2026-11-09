<script setup lang="ts">
import { computed } from 'vue';
import { diffJson } from '@flagken/shared';
import type { JsonValue } from '@flagken/shared';

const props = defineProps<{ before: JsonValue; after: JsonValue; caption: string }>();
const entries = computed(() => diffJson(props.before ?? undefined, props.after ?? undefined));
const show = (value: JsonValue | undefined) => (value === undefined ? '' : JSON.stringify(value));
</script>

<template>
  <div class="table-wrap">
    <table class="diff">
      <caption class="visually-hidden">
        {{
          caption
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Before</th>
          <th scope="col">After</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in entries" :key="entry.path">
          <td class="mono">{{ entry.path }}</td>
          <td class="mono" :class="{ removed: entry.kind !== 'added' }">
            <span v-if="entry.kind !== 'added'"><span class="visually-hidden">removed </span>{{ show(entry.before) }}</span>
          </td>
          <td class="mono" :class="{ added: entry.kind !== 'removed' }">
            <span v-if="entry.kind !== 'removed'"><span class="visually-hidden">added </span>{{ show(entry.after) }}</span>
          </td>
        </tr>
        <tr v-if="entries.length === 0">
          <td colspan="3" class="muted">No field changed.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
