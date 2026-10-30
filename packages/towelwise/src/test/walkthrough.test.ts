import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

interface Step {
  id: string;
  title: string;
  description: string;
  completionEvents?: string[];
  media?: { markdown?: string };
}

const extension = () => {
  const ext = vscode.extensions.getExtension('towelwise.towelwise');
  assert.ok(ext, 'extension not found');
  return ext;
};
const walkthroughs = () => extension().packageJSON.contributes.walkthroughs as { steps: Step[] }[];
const steps = () => walkthroughs()[0].steps;

suite('walkthrough', () => {
  test('there is one walkthrough with the six steps in order', () => {
    assert.strictEqual(walkthroughs().length, 1);
    assert.deepStrictEqual(
      steps().map((s) => s.id),
      ['agents', 'arrange', 'choose', 'restore', 'hyperspace', 'settings'],
    );
  });

  test('every command a step button runs is registered', async () => {
    const commands = new Set(await vscode.commands.getCommands(true));
    for (const step of steps()) {
      for (const [, id] of step.description.matchAll(/command:([\w.]+)/g)) {
        assert.ok(commands.has(id), `${step.id}: ${id} is not a registered command`);
      }
    }
  });

  test('steps 3 to 5 complete when their command runs; any other event is a step selection', async () => {
    const commands = new Set(await vscode.commands.getCommands(true));
    const byId = new Map(steps().map((s) => [s.id, s]));
    assert.deepStrictEqual(byId.get('choose')?.completionEvents, ['onCommand:towelwise.layout.choose']);
    assert.deepStrictEqual(byId.get('restore')?.completionEvents, ['onCommand:towelwise.layout.restore']);
    assert.deepStrictEqual(byId.get('hyperspace')?.completionEvents, ['onCommand:towelwise.hyperspace.toggle']);

    for (const step of steps()) {
      for (const event of step.completionEvents ?? []) {
        if (event === 'onStepSelected') continue;
        assert.ok(event.startsWith('onCommand:') && commands.has(event.slice('onCommand:'.length)), `${step.id}: ${event}`);
      }
    }
  });

  test('every step has media that exists in the package', () => {
    for (const step of steps()) {
      assert.ok(step.media?.markdown, `${step.id} has no media`);
      assert.ok(fs.existsSync(path.join(extension().extensionPath, step.media.markdown)), `${step.id}: ${step.media.markdown}`);
    }
  });

  test('the walkthrough names no specific agent', () => {
    const text = steps()
      .map((s) => `${s.title} ${s.description}`)
      .join(' ');
    assert.ok(!/claude|codex|copilot|antigravity|gemini|chatgpt|openai|anthropic/i.test(text));
  });
});
