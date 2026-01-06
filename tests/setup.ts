/**
 * Global test setup file
 * This file runs before all tests
 */

import { beforeEach } from 'vitest';

// Mock environment variables for tests
process.env.WOS_MSG_PROCESS_DELAY = '100';

// Mock Worker constructor globally for all tests
class MockWorker {
  static instances: MockWorker[] = [];

  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;

  constructor(url?: any, _options?: any) {
    this.url = url ? String(url) : '';
    MockWorker.instances.push(this);
  }

  postMessage(data: any) {
    // Mock implementation - do nothing
  }

  /**
   * Test helper: simulate a message received from the worker.
   * Returns whatever the onmessage handler returns (often a Promise).
   */
  emitMessage(data: any) {
    if (!this.onmessage) return undefined;
    return this.onmessage({ data } as MessageEvent);
  }

  terminate() {
    // Mock implementation - do nothing
  }

  addEventListener(type: string, listener: EventListener) {
    // Mock implementation - do nothing
  }

  removeEventListener(type: string, listener: EventListener) {
    // Mock implementation - do nothing
  }

  dispatchEvent(event: Event): boolean {
    return true;
  }
}

// Set Worker in global scope
(global as any).Worker = MockWorker;

// Also expose the mock for tests that need access to created worker instances
(global as any).MockWorker = MockWorker;

// Prevent cross-test contamination when modules instantiate Workers at import time.
beforeEach(() => {
  MockWorker.instances.length = 0;
});

// Add any global test utilities or mocks here
export { };
