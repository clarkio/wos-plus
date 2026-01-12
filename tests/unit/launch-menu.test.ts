import { describe, it, expect, beforeEach } from 'vitest';
import initLaunchMenu from '../../src/lib/launch-menu';

// Ensure a DOM exists for environments where the test runner didn't provide one
if (typeof document === 'undefined') {
  // lazy-load happy-dom to create a DOM
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Window } = require('happy-dom');
  const win = new Window();
  // @ts-ignore
  global.window = win;
  // @ts-ignore
  global.document = win.document;
  // @ts-ignore
  global.HTMLElement = win.HTMLElement;
}

describe('launch menu', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="launch-menu-trigger">Launch</button>
      <div class="launch-menu-dropdown"></div>
    `;
  });

  it('toggles menu on trigger click and closes on outside click and Escape', () => {
    const trigger = document.getElementById('launch-menu-trigger')!;
    const dropdown = document.querySelector('.launch-menu-dropdown')!;

    const instance = initLaunchMenu();
    expect(instance).not.toBeNull();

    // Click trigger -> open
    const MouseEvt = (global as any).window?.MouseEvent || MouseEvent;
    trigger.dispatchEvent(new MouseEvt('click', { bubbles: true }));
    expect(trigger.classList.contains('active')).toBe(true);
    expect(dropdown.classList.contains('show')).toBe(true);

    // Click outside -> close
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvt('click', { bubbles: true }));
    expect(trigger.classList.contains('active')).toBe(false);
    expect(dropdown.classList.contains('show')).toBe(false);

    // Re-open
    trigger.dispatchEvent(new MouseEvt('click', { bubbles: true }));
    expect(trigger.classList.contains('active')).toBe(true);

    // Press Escape -> close
    const KeyEvt = (global as any).window?.KeyboardEvent || KeyboardEvent;
    document.dispatchEvent(new KeyEvt('keydown', { key: 'Escape' }));
    expect(trigger.classList.contains('active')).toBe(false);

    // cleanup listener
    instance && instance.destroy && instance.destroy();
  });

  it('re-initializes when DOM is replaced', () => {
    const trigger1 = document.getElementById('launch-menu-trigger')!;
    const dropdown1 = document.querySelector('.launch-menu-dropdown')!;

    const instance1 = initLaunchMenu();
    expect(instance1).not.toBeNull();

    const MouseEvt = (global as any).window?.MouseEvent || MouseEvent;
    trigger1.dispatchEvent(new MouseEvt('click', { bubbles: true }));
    expect(trigger1.classList.contains('active')).toBe(true);
    expect(dropdown1.classList.contains('show')).toBe(true);

    // Simulate Astro swapping the page DOM
    document.body.innerHTML = `
      <button id="launch-menu-trigger">Launch</button>
      <div class="launch-menu-dropdown"></div>
    `;

    const trigger2 = document.getElementById('launch-menu-trigger')!;
    const dropdown2 = document.querySelector('.launch-menu-dropdown')!;

    const instance2 = initLaunchMenu();
    expect(instance2).not.toBeNull();

    trigger2.dispatchEvent(new MouseEvt('click', { bubbles: true }));
    expect(trigger2.classList.contains('active')).toBe(true);
    expect(dropdown2.classList.contains('show')).toBe(true);

    instance2 && instance2.destroy && instance2.destroy();
  });
});
