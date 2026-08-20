import { Given, Then, When, defineSteps } from '@termwright/gherkin';

export default defineSteps(
  Given('a starting value of {int}', ({ world }, value) => {
    world.value = value;
  }),
  When('I add {int}', ({ world }, amount) => {
    world.value = Number(world.value) + Number(amount);
  }),
  Then('the result is {int}', ({ expect, scenario, world }, total) => {
    expect(world.value).toBe(total);
    expect(scenario.line).toBe(6);
  }),
);
