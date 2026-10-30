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
  // Commands are registered on activation; do not rely on another test file having activated the extension.
  suiteSetup(async () => {
    await extension().activate();
  });

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

  // The spec's steps: the one button each runs (with its arguments, if any) and how each completes.
  const SELECTED = ['onStepSelected'];
  const EXPECTED: { id: string; buttons: string[]; events: string[] }[] = [
    { id: 'agents', buttons: ['workbench.view.extensions'], events: SELECTED },
    { id: 'arrange', buttons: [], events: SELECTED },
    { id: 'choose', buttons: ['towelwise.layout.choose'], events: ['onCommand:towelwise.layout.choose'] },
    { id: 'restore', buttons: ['towelwise.layout.restore'], events: ['onCommand:towelwise.layout.restore'] },
    { id: 'hyperspace', buttons: ['towelwise.hyperspace.toggle'], events: ['onCommand:towelwise.hyperspace.toggle'] },
    { id: 'settings', buttons: ['workbench.action.openSettings?%5B%22towelwise%22%5D'], events: SELECTED },
  ];

  test('each step has exactly its expected buttons', () => {
    for (const { id, buttons } of EXPECTED) {
      const step = steps().find((s) => s.id === id);
      assert.ok(step, `${id} is missing`);
      assert.deepStrictEqual([...step.description.matchAll(/\(command:([^)\s]+)\)/g)].map((m) => m[1]), buttons, id);
    }
  });

  test('each step completes on exactly its expected events', () => {
    for (const { id, events } of EXPECTED) {
      assert.deepStrictEqual(steps().find((s) => s.id === id)?.completionEvents, events, id);
    }
  });

  test('every command event names a registered command', async () => {
    const commands = new Set(await vscode.commands.getCommands(true));
    for (const { id, events } of EXPECTED) {
      for (const event of events.filter((e) => e.startsWith('onCommand:'))) {
        assert.ok(commands.has(event.slice('onCommand:'.length)), `${id}: ${event}`);
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
