# Tests

This directory contains tests for the WoS+ application.

## Structure

- `unit/` - Unit tests for individual functions and components
- `integration/` - Integration tests for API routes and services
- `setup.ts` - Global test setup configuration
- `test-utils.ts` - Shared test utilities and mock helpers
- `smoke.test.ts` - Basic smoke tests to verify test configuration

## Running Tests

```bash
# Run tests in watch mode (for development)
npm test

# Run tests once (for CI/CD)
npm run test:run

# Run tests with UI
npm run test:ui

# Run tests with coverage report
npm run test:coverage
```

## Writing Tests

### Unit Tests

Unit tests should be placed in the `unit/` directory and follow the naming convention `*.test.ts` or `*.spec.ts`.

Example:
```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '@scripts/my-module';

describe('myFunction', () => {
  it('should do something', () => {
    expect(myFunction('input')).toBe('expected output');
  });
});
```

### Integration Tests

Integration tests should be placed in the `integration/` directory and test API routes, database interactions, etc.

Example:
```typescript
import { describe, it, expect } from 'vitest';

describe('API /api/health', () => {
  it('should return 200 OK', async () => {
    // Test implementation
  });
});
```

## Test Utilities

The `test-utils.ts` file provides common helpers:

- `mockFetchResponse()` - Create mock fetch responses
- `createMockLocalStorage()` - Mock localStorage for tests
- `wait()` - Utility for async delays
- `createMockWebSocket()` - Mock WebSocket connections
- `createMockWorker()` - Mock Web Workers

## Configuration

Test configuration is in `vitest.config.ts` at the project root.

Key settings:
- **Environment**: happy-dom (lightweight DOM for testing)
- **Globals**: Vitest globals enabled (describe, it, expect)
- **Coverage**: V8 provider with HTML/JSON/text reports

## Best Practices

1. **Keep tests focused** - Each test should verify one specific behavior
2. **Use descriptive names** - Test names should clearly describe what is being tested
3. **Mock external dependencies** - Use the utilities in `test-utils.ts` to mock fetch, localStorage, etc.
4. **Test edge cases** - Don't just test the happy path
5. **Keep tests fast** - Unit tests should run in milliseconds
6. **Isolate tests** - Tests should not depend on each other or shared state
