<script setup lang="ts">
import { computed } from 'vue';
import { BUCKET_COUNT } from '@flagken/shared';
import type { Serve } from '@flagken/shared';
import RolloutSlider from './RolloutSlider.vue';

const props = defineProps<{ modelValue: Serve; variationNames: string[]; idPrefix: string; legend: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: Serve] }>();

const mode = computed(() => ('rollout' in props.modelValue ? 'rollout' : 'variation'));

function setMode(next: string) {
  if (next === mode.value) return;
  if (next === 'variation') {
    emit('update:modelValue', { variation: 0 });
  } else {
    const count = props.variationNames.length;
    const share = Math.floor(BUCKET_COUNT / count);
    const variations = props.variationNames.map((_, variation) => ({ variation, weight: share }));
    variations[0]!.weight += BUCKET_COUNT - share * count;
    emit('update:modelValue', { rollout: { variations } });
  }
}
</script>

<template>
  <fieldset class="field">
    <legend>{{ legend }}</legend>
    <div class="row field">
      <label class="inline-check">
        <input type="radio" :name="`${idPrefix}-mode`" value="variation" :checked="mode === 'variation'" @change="setMode('variation')" />
        A variation
      </label>
      <label class="inline-check">
        <input type="radio" :name="`${idPrefix}-mode`" value="rollout" :checked="mode === 'rollout'" @change="setMode('rollout')" />
        % rollout
      </label>
    </div>
    <div v-if="'variation' in modelValue" class="field">
      <label :for="`${idPrefix}-variation`">Serve</label>
      <select
        :id="`${idPrefix}-variation`"
        :value="modelValue.variation"
        @change="emit('update:modelValue', { variation: Number(($event.target as HTMLSelectElement).value) })"
      >
        <option v-for="(name, index) in variationNames" :key="index" :value="index">{{ name }}</option>
      </select>
    </div>
    <RolloutSlider
      v-else
      :model-value="modelValue.rollout"
      :variation-names="variationNames"
      :id-prefix="idPrefix"
      @update:model-value="emit('update:modelValue', { rollout: $event })"
    />
  </fieldset>
</template>
