import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_CATEGORIES,
  categoriseTool,
  isActivityCategory,
  maskedPhrase,
  representativeTool,
} from '../src/activityMask.js';

/**
 * The masking vocabulary. Its whole job is to say "someone is busy" without
 * saying what they are busy with, so the tests care about two things: that a
 * category never leaks the tool it came from, and that the label a viewer sees
 * holds still while they look at it.
 */
describe('categoriseTool', () => {
  it('sorts the everyday tools into the right kind of work', () => {
    expect(categoriseTool('Read')).toBe('reading');
    expect(categoriseTool('Edit')).toBe('writing');
    expect(categoriseTool('Write')).toBe('writing');
    expect(categoriseTool('Grep')).toBe('searching');
    expect(categoriseTool('Glob')).toBe('searching');
    expect(categoriseTool('Bash')).toBe('running');
  });

  it('sends an unknown tool to the vaguest category rather than guessing', () => {
    // Guessing from the name would defeat the point: the name is the thing
    // being withheld. An MCP tool called mcp__gmail__send_message must not
    // become "sending email".
    expect(categoriseTool('mcp__gmail__send_message')).toBe('running');
    expect(categoriseTool('SomeFutureTool')).toBe('running');
    expect(categoriseTool('')).toBe('running');
  });
});

describe('representativeTool', () => {
  it('gives every category a stand-in the office can animate', () => {
    for (const category of ACTIVITY_CATEGORIES) {
      expect(representativeTool(category).length).toBeGreaterThan(0);
    }
  });

  it('collapses every tool of one kind onto the same stand-in', () => {
    // Two different reading tools must be indistinguishable downstream --
    // otherwise the stand-in still identifies the original.
    expect(representativeTool(categoriseTool('Read'))).toBe(
      representativeTool(categoriseTool('NotebookRead')),
    );
    expect(representativeTool(categoriseTool('Write'))).toBe(
      representativeTool(categoriseTool('MultiEdit')),
    );
  });
});

describe('maskedPhrase', () => {
  it('returns the same phrase for the same activity every time', () => {
    // A label that reshuffled itself on every render reads as a glitch.
    const first = maskedPhrase('writing', 'sess-1:Edit');
    expect(maskedPhrase('writing', 'sess-1:Edit')).toBe(first);
    expect(maskedPhrase('writing', 'sess-1:Edit')).toBe(first);
  });

  it('gives different activities different words', () => {
    const phrases = new Set(
      ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].map((tool) =>
        maskedPhrase('writing', `sess-1:${tool}`),
      ),
    );
    expect(phrases.size).toBeGreaterThan(1);
  });

  it('always says something, for every category', () => {
    for (const category of ACTIVITY_CATEGORIES) {
      expect(maskedPhrase(category, 'seed').length).toBeGreaterThan(0);
    }
  });

  it('never puts the seed into the phrase it returns', () => {
    // The seed contains the real tool name. If it ever reached the label, the
    // masking would be undone by the very thing meant to replace it.
    const phrase = maskedPhrase('running', 'sess-1:mcp__gmail__send_message');
    expect(phrase).not.toContain('gmail');
    expect(phrase).not.toContain('sess-1');
  });
});

describe('isActivityCategory', () => {
  it('accepts the vocabulary and rejects everything else', () => {
    expect(isActivityCategory('reading')).toBe(true);
    expect(isActivityCategory('Read')).toBe(false);
    expect(isActivityCategory(undefined)).toBe(false);
    expect(isActivityCategory(42)).toBe(false);
  });
});
