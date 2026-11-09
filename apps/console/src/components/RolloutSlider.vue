<script setup lang="ts">
import { computed } from 'vue';
import { BUCKET_COUNT, percentToWeight, weightToPercent } from '@flagken/shared';
import type { Rollout } from '@flagken/shared';

/**
 * Edits the weights of a % rollout. 2 variations: 1 slider for the share of the second variation.
 * More variations: 1 number per variation, which must add up to 100%.
 */
const props = defineProps<{ modelValue: Rollout; variationNames: string[]; idPrefix: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: Rollout] }>();

const weights = computed(() => props.variationNames.map((_, i) => props.modelValue.variations.find((v) => v.variation === i)?.weight ?? 0));
const total = computed(() => weights.value.reduce((a, b) => a + b, 0));

function set(next: number[]) {
  emit('update:modelValue', { ...props.modelValue, variations: next.map((weight, variation) => ({ variation, weight })) });
}

function setSecond(percent: number) {
  const second = Math.min(BUCKET_COUNT, Math.max(0, percentToWeight(percent)));
  set([BUCKET_COUNT - second, second]);
}

function setOne(index: number, percent: number) {
  const next = [...weights.value];
  next[index] = Math.max(0, percentToWeight(percent));
  set(next);
}

function setBucketBy(value: string) {
  const { bucketBy: _old, ...rest } = props.modelValue;
  emit('update:modelValue', value && value !== 'key' ? { ...rest, bucketBy: value } : rest);
}
</script>

<template>
  <div class="stack">
    <template v-if="variationNames.length === 2">
      <label :for="`${idPrefix}-slider`">
        {{ variationNames[1] }}: {{ weightToPercent(weights[1] ?? 0) }}%, {{ variationNames[0] }}: {{ weightToPercent(weights[0] ?? 0) }}%
      </label>
      <input
        :id="`${idPrefix}-slider`"
        type="range"
        min="0"
        max="100"
        step="0.5"
        :value="weightToPercent(weights[1] ?? 0)"
        :aria-valuetext="`${weightToPercent(weights[1] ?? 0)}% get ${variationNames[1]}`"
        @input="setSecond(Number(($event.target as HTMLInputElement).value))"
      />
      <div class="field">
        <label :for="`${idPrefix}-exact`">Exact % for {{ variationNames[1] }}</label>
        <input
          :id="`${idPrefix}-exact`"
          type="number"
          min="0"
          max="100"
          step="0.01"
          :value="weightToPercent(weights[1] ?? 0)"
          @change="setSecond(Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </template>
    <template v-else>
      <div v-for="(name, index) in variationNames" :key="index" class="field">
        <label :for="`${idPrefix}-w${index}`">% for {{ name }}</label>
        <input
          :id="`${idPrefix}-w${index}`"
          type="number"
          min="0"
          max="100"
          step="0.01"
          :value="weightToPercent(weights[index] ?? 0)"
          @change="setOne(index, Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <p :class="total === BUCKET_COUNT ? 'muted small' : 'notice error'" role="status">Total {{ weightToPercent(total) }}% of 100%.</p>
    </template>
    <div class="field">
      <label :for="`${idPrefix}-bucket`">Bucket by attribute</label>
      <input
        :id="`${idPrefix}-bucket`"
        type="text"
        :value="modelValue.bucketBy ?? 'key'"
        @change="setBucketBy(($event.target as HTMLInputElement).value.trim())"
      />
    </div>
  </div>
</template>
