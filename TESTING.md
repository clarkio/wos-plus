# Testing Guide for WoS+

This document provides comprehensive guidance for testing the WoS+ application.

## Overview

WoS+ uses [Vitest](https://vitest.dev/) as its testing framework. Vitest is a fast, modern testing framework that works seamlessly with Vite and TypeScript.

## Test Setup

The testing infrastructure includes:

- **Vitest**: Main testing framework
- **Happy-DOM**: Lightweight DOM implementation for testing
- **@vitest/ui**: Visual UI for running and debugging tests
- **@vitest/coverage-v8**: Code coverage reporting

## Project Structure

```
wos-plus/
├── tests/
│   ├── unit/               # Unit tests for individual modules
│   ├── integration/        # Integration tests for API routes
│   ├── setup.ts           # Global test setup
│   ├── test-utils.ts      # Shared test utilities
│   ├── smoke.test.ts      # Basic smoke tests
│   └── README.md          # Test documentation
├── vitest.config.ts       # Vitest configuration
└── tsconfig.json          # TypeScript config (includes test files)
```

## Running Tests

### Basic Commands

```bash
# Run tests in watch mode (recommended for development)
npm test

# Run tests once (for CI/CD)
npm run test:run

# Run tests with visual UI
npm run test:ui

# Run tests with coverage report
npm run test:coverage
```

### Watch Mode Tips

In watch mode, Vitest will:
- Automatically re-run tests when files change
- Show test results in real-time
- Allow filtering tests by name or file

Press `h` in watch mode to see all available commands.

## Writing Tests

### Test File Structure

Test files should follow this naming convention:
- `*.test.ts` or `*.spec.ts` for test files
- Place unit tests in `tests/unit/`
- Place integration tests in `tests/integration/`

### Basic Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '@scripts/my-module';

describe('myFunction', () => {
  it('should return expected result', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });
});
```

### Testing Patterns

#### 1. Testing Pure Functions

```typescript
import { describe, it, expect } from 'vitest';
import { findWosWordsByLetters } from '@scripts/wos-words';

describe('findWosWordsByLetters', () => {
  it('should find matching words', () => {
    const letters = ['a', 'b', 'c'];
    const result = findWosWordsByLetters(letters);
    expect(result).toContain('cab');
  });
});
```

#### 2. Testing with Mocks

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('API calls', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  it('should fetch data', async () => {
    // Mock global fetch
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      } as Response)
    );

    // Test implementation
    const response = await fetch('/api/test');
    const data = await response.json();
    
    expect(data).toEqual({ data: 'test' });
  });
});
```

#### 3. Testing with Test Utilities

```typescript
import { describe, it, expect } from 'vitest';
import { mockFetchResponse, createMockLocalStorage } from '../test-utils';

describe('localStorage operations', () => {
  it('should save and retrieve data', () => {
    const storage = createMockLocalStorage();
    storage.setItem('key', 'value');
    expect(storage.getItem('key')).toBe('value');
  });
});
```

#### 4. Testing Async Code

```typescript
import { describe, it, expect } from 'vitest';

describe('async operations', () => {
  it('should handle promises', async () => {
    const promise = Promise.resolve('data');
    await expect(promise).resolves.toBe('data');
  });

  it('should handle rejections', async () => {
    const promise = Promise.reject(new Error('failed'));
    await expect(promise).rejects.toThrow('failed');
  });
});
```

#### 5. Testing DOM Interactions

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('DOM manipulation', () => {
  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div id="test-element">Hello</div>
    `;
  });

  it('should update element text', () => {
    const element = document.getElementById('test-element');
    element!.innerText = 'World';
    expect(element!.innerText).toBe('World');
  });
});
```

## Test Organization

### Use describe blocks to group related tests

```typescript
describe('GameSpectator', () => {
  describe('constructor', () => {
    it('should initialize with defaults', () => {
      // test
    });
  });

  describe('connectWos', () => {
    it('should connect to WebSocket', () => {
      // test
    });
  });
});
```

### Use beforeEach/afterEach for setup/teardown

```typescript
import { describe, it, beforeEach, afterEach } from 'vitest';

describe('test suite', () => {
  let testData: any;

  beforeEach(() => {
    // Setup before each test
    testData = { value: 0 };
  });

  afterEach(() => {
    // Cleanup after each test
    testData = null;
  });

  it('should use testData', () => {
    expect(testData.value).toBe(0);
  });
});
```

## Mocking Strategies

### Mocking Modules

```typescript
import { vi } from 'vitest';

// Mock entire module
vi.mock('@scripts/wos-words', () => ({
  loadWordsFromDb: vi.fn(),
  findWosWordsByLetters: vi.fn(() => ['word1', 'word2']),
}));
```

### Mocking Functions

```typescript
import { vi } from 'vitest';

const mockFn = vi.fn();
mockFn.mockReturnValue('result');
mockFn.mockResolvedValue('async result');
mockFn.mockRejectedValue(new Error('error'));
```

### Mocking Timers

```typescript
import { vi } from 'vitest';

vi.useFakeTimers();
// ... test code with timers ...
vi.advanceTimersByTime(1000);
vi.restoreAllMocks();
```

## Coverage

### Viewing Coverage Reports

After running `npm run test:coverage`, coverage reports are generated in:
- **Terminal**: Summary output
- **coverage/index.html**: Detailed HTML report

### Coverage Goals

Aim for:
- **Statements**: 80%+
- **Branches**: 75%+
- **Functions**: 80%+
- **Lines**: 80%+

### What to Test

Priority areas:
1. **Business logic**: Core game mechanics, word matching algorithms
2. **Data validation**: Input validation, sanitization
3. **Error handling**: Edge cases, error conditions
4. **API routes**: Request/response handling
5. **Utility functions**: Pure functions, helpers

### What Not to Test

- Third-party library internals
- Simple getters/setters
- Configuration files
- Type definitions

## Best Practices

### 1. Test One Thing at a Time

Each test should verify a single behavior:
```typescript
// Good
it('should return empty array for empty input', () => {
  expect(findWords([])).toEqual([]);
});

// Avoid
it('should handle various inputs', () => {
  expect(findWords([])).toEqual([]);
  expect(findWords(['a'])).toHaveLength(1);
  expect(findWords(['a', 'b'])).toHaveLength(2);
});
```

### 2. Use Descriptive Test Names

```typescript
// Good
it('should throw error when boardId exceeds 20 characters', () => {
  // ...
});

// Avoid
it('validates boardId', () => {
  // ...
});
```

### 3. Follow AAA Pattern

- **Arrange**: Set up test data
- **Act**: Execute the code under test
- **Assert**: Verify the results

```typescript
it('should add word to dictionary', () => {
  // Arrange
  const word = 'test';
  const dictionary: string[] = [];
  
  // Act
  dictionary.push(word);
  
  // Assert
  expect(dictionary).toContain('test');
});
```

### 4. Test Edge Cases

```typescript
describe('saveBoard', () => {
  it('should handle empty boardId', () => {
    expect(() => saveBoard('', [])).toThrow();
  });

  it('should handle very long boardId', () => {
    const longId = 'a'.repeat(100);
    expect(() => saveBoard(longId, [])).toThrow();
  });

  it('should handle null slots', () => {
    expect(() => saveBoard('id', null as any)).toThrow();
  });
});
```

### 5. Keep Tests Independent

Tests should not depend on each other:
```typescript
// Good - each test is independent
it('should add word', () => {
  const dict = [];
  dict.push('word');
  expect(dict).toHaveLength(1);
});

it('should remove word', () => {
  const dict = ['word'];
  dict.pop();
  expect(dict).toHaveLength(0);
});
```

### 6. Use Test Utilities

Leverage shared utilities from `test-utils.ts`:
```typescript
import { mockFetchResponse, createMockLocalStorage } from '../test-utils';

it('should use mock utilities', () => {
  const storage = createMockLocalStorage();
  // ... test code
});
```

## Debugging Tests

### Using Vitest UI

The visual UI helps debug failing tests:
```bash
npm run test:ui
```

Navigate to `http://localhost:51204/__vitest__/` to see:
- Test file tree
- Individual test results
- Console output
- Error stack traces

### Using Console Logs

```typescript
it('should debug', () => {
  const value = computeValue();
  console.log('Debug value:', value);
  expect(value).toBe(expected);
});
```

### Using Vitest's inspect

```typescript
import { expect } from 'vitest';

it('should inspect value', () => {
  const value = { nested: { data: 'test' } };
  console.log(expect(value).toBe); // Shows matcher info
});
```

## CI/CD Integration

For GitHub Actions or other CI systems:

```yaml
- name: Run tests
  run: npm run test:run

- name: Run tests with coverage
  run: npm run test:coverage
```

## Troubleshooting

### Tests Fail with Module Import Errors

Check that:
1. `vitest.config.ts` has correct path aliases
2. `tsconfig.json` includes test files
3. Module paths use correct aliases (@scripts, @components, etc.)

### Tests Timeout

Increase timeout for specific tests:
```typescript
it('should handle slow operation', async () => {
  // test code
}, 10000); // 10 second timeout
```

### Mock Not Working

Ensure mocks are cleared between tests:
```typescript
beforeEach(() => {
  vi.clearAllMocks();
});
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Vitest API Reference](https://vitest.dev/api/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Test Utilities](./test-utils.ts)

## Getting Help

If you encounter issues:
1. Check this guide
2. Review existing test examples in `tests/`
3. Check Vitest documentation
4. Ask in project discussions
