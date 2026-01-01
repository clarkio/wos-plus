/**
 * Test utilities and helper functions
 */

/**
 * Creates a mock fetch response
 */
export function mockFetchResponse(data: any, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response);
}

/**
 * Creates a mock localStorage for testing
 */
export function createMockLocalStorage() {
  const store: Record<string, string> = {};
  
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach(key => delete store[key]);
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => {
      const keys = Object.keys(store);
      return keys[index] || null;
    },
  };
}

/**
 * Wait for a specified amount of time
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a mock WebSocket for testing
 */
export function createMockWebSocket() {
  const listeners: Record<string, Function[]> = {};
  
  return {
    on: (event: string, handler: Function) => {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(handler);
    },
    emit: (event: string, ...args: any[]) => {
      if (listeners[event]) {
        listeners[event].forEach(handler => handler(...args));
      }
    },
    close: () => {},
    disconnect: () => {},
  };
}

/**
 * Creates a mock Worker for testing
 */
export function createMockWorker() {
  const listeners: Function[] = [];
  
  return {
    postMessage: (message: any) => {
      // Simulate async message handling
      setTimeout(() => {
        listeners.forEach(listener => listener({ data: message }));
      }, 0);
    },
    addEventListener: (event: string, handler: Function) => {
      if (event === 'message') {
        listeners.push(handler);
      }
    },
    removeEventListener: () => {},
    terminate: () => {},
  };
}
