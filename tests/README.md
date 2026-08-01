# Tests

This directory contains tests for the WoS+ application.

## Structure

- `unit/` - Unit tests for individual functions and components
- `acceptance/` - The behavioural contract in [`specs/`](../specs/), executable.
  Also holds `api-harness.ts` (`invokeRoute`) and `network-mock.ts` (MSW).
- `property/` - `fast-check` invariants for the dictionary and normalizers
- `fixtures/` - Recorded WoS event sequences
- `stubs/` - Module stubs aliased in `vitest.config.ts`
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

### Acceptance Tests

Acceptance tests go in `acceptance/`, named `*.acceptance.test.ts`, one file per
behaviour area. Each `describe` cites the [`specs/`](../specs/) section it
implements. API routes are invoked directly — no dev server — and Supabase is
faked at the HTTP boundary, never with `vi.mock`.

Example:
```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { GET } from '../../src/pages/api/health';
import { invokeRoute, readJson } from './api-harness';
import { setupNetworkMocking } from './network-mock';

setupNetworkMocking();

describe('specs/game-flow.md — Is WoS+ itself up?', () => {
  describe('Scenario: checking that WoS+ is running', () => {
    it('answers that it is running', async () => {
      const response = await invokeRoute(GET, { url: '/api/health' });
      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({ status: 'ok' });
    });
  });
});
```

The full conventions — including **why `onUnhandledRequest: 'error'` is not
what keeps this suite off the network** — are in
[TESTING.md § The acceptance stream](../TESTING.md#the-acceptance-stream).
Read it before adding a file here.

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
