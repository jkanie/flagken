import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RolloutSlider from '../src/components/RolloutSlider.vue';
import ServeEditor from '../src/components/ServeEditor.vue';
import DiffView from '../src/components/DiffView.vue';
import { formatValue, parseValue, splitList } from '../src/components/variations';

describe('RolloutSlider', () => {
  const names = ['Old checkout', 'New checkout'];
  const rollout = {
    variations: [
      { variation: 0, weight: 7500 },
      { variation: 1, weight: 2500 },
    ],
  };

  it('shows the split of 2 variations in % and labels the slider', () => {
    const wrapper = mount(RolloutSlider, { props: { modelValue: rollout, variationNames: names, idPrefix: 't' } });
    expect(wrapper.find('label[for="t-slider"]').text()).toBe('New checkout: 25%, Old checkout: 75%');
    expect(wrapper.find('#t-slider').attributes('aria-valuetext')).toBe('25% get New checkout');
  });

  it('emits weights that add up to 10,000 buckets when the slider moves', async () => {
    const wrapper = mount(RolloutSlider, { props: { modelValue: rollout, variationNames: names, idPrefix: 't' } });
    await wrapper.find('#t-slider').setValue('40.5');
    const [emitted] = wrapper.emitted('update:modelValue')!.at(-1) as [typeof rollout];
    expect(emitted.variations).toEqual([
      { variation: 0, weight: 5950 },
      { variation: 1, weight: 4050 },
    ]);
  });

  it('takes an exact value with 0.01% precision', async () => {
    const wrapper = mount(RolloutSlider, { props: { modelValue: rollout, variationNames: names, idPrefix: 't' } });
    await wrapper.find('#t-exact').setValue('12.34');
    await wrapper.find('#t-exact').trigger('change');
    const [emitted] = wrapper.emitted('update:modelValue')!.at(-1) as [typeof rollout];
    expect(emitted.variations[1]!.weight).toBe(1234);
  });

  it('warns when 3 or more weights do not add up to 100%', () => {
    const wrapper = mount(RolloutSlider, {
      props: {
        modelValue: {
          variations: [
            { variation: 0, weight: 5000 },
            { variation: 1, weight: 1000 },
            { variation: 2, weight: 1000 },
          ],
        },
        variationNames: ['a', 'b', 'c'],
        idPrefix: 'm',
      },
    });
    expect(wrapper.find('[role="status"]').text()).toBe('Total 70% of 100%.');
    expect(wrapper.find('[role="status"]').classes()).toContain('error');
  });

  it('drops bucketBy when it is set back to key', async () => {
    const wrapper = mount(RolloutSlider, { props: { modelValue: { ...rollout, bucketBy: 'org' }, variationNames: names, idPrefix: 't' } });
    await wrapper.find('#t-bucket').setValue('key');
    await wrapper.find('#t-bucket').trigger('change');
    const [emitted] = wrapper.emitted('update:modelValue')!.at(-1) as [Record<string, unknown>];
    expect(emitted).not.toHaveProperty('bucketBy');
  });
});

describe('ServeEditor', () => {
  it('switches from a variation to an even rollout over all variations', async () => {
    const wrapper = mount(ServeEditor, {
      props: { modelValue: { variation: 0 }, variationNames: ['a', 'b', 'c'], idPrefix: 's', legend: 'Serve' },
    });
    await wrapper.find('input[value="rollout"]').setValue(true);
    const [emitted] = wrapper.emitted('update:modelValue')!.at(-1) as [{ rollout: { variations: Array<{ weight: number }> } }];
    expect(emitted.rollout.variations.map((v) => v.weight)).toEqual([3334, 3333, 3333]);
  });
});

describe('DiffView', () => {
  it('lists changed fields with before and after', () => {
    const wrapper = mount(DiffView, {
      props: { before: { on: false, rules: [] }, after: { on: true, rules: [{ id: 'r1' }] }, caption: 'c' },
    });
    const rows = wrapper.findAll('tbody tr').map((row) => row.findAll('td').map((cell) => cell.text()));
    expect(rows).toEqual([
      ['/on', 'removed false', 'added true'],
      ['/rules/0', '', 'added {"id":"r1"}'],
    ]);
  });

  it('says so when nothing changed', () => {
    const wrapper = mount(DiffView, { props: { before: { a: 1 }, after: { a: 1 }, caption: 'c' } });
    expect(wrapper.find('tbody').text()).toBe('No field changed.');
  });
});

describe('variation helpers', () => {
  it('parses values by kind', () => {
    expect(parseValue('number', '2.5')).toBe(2.5);
    expect(parseValue('json', '{"a":1}')).toEqual({ a: 1 });
    expect(parseValue('boolean', 'true')).toBe(true);
    expect(() => parseValue('number', 'x')).toThrow('x is not a number');
    expect(() => parseValue('json', '{')).toThrow('not valid JSON');
  });
  it('formats and splits', () => {
    expect(formatValue('text')).toBe('text');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(splitList(' a, b,,c ')).toEqual(['a', 'b', 'c']);
  });
});
