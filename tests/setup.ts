/**
 * Global test setup file
 * This file runs before all tests
 */

// Mock environment variables for tests
process.env.WOS_MSG_PROCESS_DELAY = '100';

// Mock Worker constructor globally for all tests
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  
  postMessage(data: any) {
    // Mock implementation - do nothing
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

// Add any global test utilities or mocks here
export {};
