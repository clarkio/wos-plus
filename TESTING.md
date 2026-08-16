# Testing Guide for WoS+

This document provides comprehensive guidance for testing the WoS+ application.

## Overview

WoS+ uses [Vitest](https://vitest.dev/) as its testing framework. Vitest is a fast, modern testing framework that works seamlessly with Vite and TypeScript.

There are **two test streams**, and both must be green:

| Stream | Where | What it encodes |
| --- | --- | --- |
| **Unit / property** | `tests/unit/`, `tests/property/` | what the code *does* — module by module |
| **Acceptance** | `tests/acceptance/` | what the code *should* do — the human-approved behavioural contract in [specs/](specs/) |

The distinction matters. An agent can always write unit tests that agree with
whatever it happened to build; it cannot satisfy the acceptance stream that way,
because the acceptance stream is checked against a spec a human approved. See
[The acceptance stream](#the-acceptance-stream) below, and `CLAUDE.md` §7.

## Test Setup

The testing infrastructure includes:

- **Vitest**: Main testing framework
- **Happy-DOM**: Lightweight DOM implementation for testing
- **@vitest/ui**: Visual UI for running and debugging tests
- **@vitest/coverage-v8**: Code coverage reporting

## Project Structure

```
wos-plus/
├── specs/                  # The behavioural contract, in game language (human-owned)
├── tests/
│   ├── unit/               # Unit tests for individual modules
│   ├── acceptance/         # Acceptance tests — one file per behaviour area
│   │   ├── api-harness.ts  #   invokeRoute(): fabricates Astro's APIContext
│   │   └── network-mock.ts #   MSW at the HTTP boundary; no module is mocked
│   ├── property/           # fast-check invariants for the algorithmic core
│   ├── fixtures/           # Recorded WoS event sequences
│   ├── stubs/              # Module stubs aliased in vitest.config.ts
│   ├── setup.ts            # Global test setup
│   ├── test-utils.ts       # Shared test utilities
│   ├── smoke.test.ts       # Basic smoke tests
│   └── README.md           # Test documentation
├── vitest.config.ts        # Vitest configuration
└── tsconfig.json           # TypeScript config (includes test files)
```

There is no `tests/integration/`. It held a single file of `it.todo`
placeholders for the API routes; every one of them is now covered by a real
acceptance test, and the file was deleted rather than left as a decoy.

## Running Tests

### Basic Commands

```bash
# Run tests in watch mode (recommended for development)
pnpm test

# Run tests once (for CI/CD) — every stream
pnpm run test:run

# Just the acceptance stream
pnpm run test:acceptance

# Just the property-based stream
pnpm run test:property

# Run tests with visual UI
pnpm run test:ui

# Run tests with coverage report
pnpm run test:coverage
```

`test:acceptance` and `test:property` are **subsets** of `test:run`, not
separate suites. They exist so each stream is independently visible — in CI a
red "Run acceptance tests" line means the behavioural contract broke, which is a
different kind of failure from a unit test breaking.

The full local gate before declaring work done (`CLAUDE.md` §2.4):

```bash
pnpm run check && pnpm run lint && pnpm run test:coverage && pnpm run build
```

### Watch Mode Tips

In watch mode, Vitest will:
- Automatically re-run tests when files change
- Show test results in real-time
- Allow filtering tests by name or file

Press `h` in watch mode to see all available commands.

## The acceptance stream

`tests/acceptance/` is the second test stream (AGENTIC-TESTING-PLAN.md Phase 3).
Where a unit test says "this function returns that", an acceptance test says
"a streamer who does this sees that" — and it says it in the words of
[specs/](specs/), the human-approved contract.

```bash
pnpm run test:acceptance
```

### Traceability: every test cites its spec

One file per behaviour area, named `*.acceptance.test.ts`. Each `describe`
names the `specs/` section it implements, and each `it` mirrors the spec's
Given/When/Then wording:

```typescript
// @vitest-environment node
describe('specs/boards.md — Browsing the archive', () => {
  describe('Scenario: an empty archive', () => {
    // Given the archive holds no boards at all
    // When the whole archive is requested
    // Then an empty list comes back — this is a normal answer, not a failure
    it('answers with an empty list, as an ordinary answer', async () => { /* … */ });
  });
});
```

That citation is the traceability link. A reader should be able to go from any
spec scenario to the test that enforces it and back. **A behaviour change starts
with a spec diff a human approves** — spec, then tests, then code. If you find
yourself changing an acceptance test to match new code, stop: either the spec
changes first, or the code is wrong.

Scenarios the spec marks ❓ **Unconfirmed** are *not* part of the contract. They
are pinned as current behaviour under protest, or left as an `it.todo` naming
the question. See [specs/README.md § Open questions](specs/README.md) for the
full index. Do not resolve one without a maintainer's answer.

### `// @vitest-environment node` on every file

The repo default is happy-dom. The API-route acceptance tests exercise server
code, so every one of those files starts with that pragma. The one exception is
`game-flow.acceptance.test.ts`, which drives `GameSpectator` and asserts on
rendered DOM — it deliberately omits the pragma and keeps the happy-dom default.

### Invoke the route, don't serve it

`invokeRoute` from
[tests/acceptance/api-harness.ts](tests/acceptance/api-harness.ts) fabricates
Astro's `APIContext` — route `params`, `locals.runtime.env`, and the
module-level `env` from `cloudflare:workers` that the routes actually read
their credentials from. No dev server, no port, no `astro build`:

```typescript
import { GET } from '../../src/pages/api/boards/[id]';
import { invokeRoute, readJson, responseHeaders } from './api-harness';

const response = await invokeRoute(GET, {
  url: '/api/boards/TRILBY',
  params: { id: 'TRILBY' },
});
expect(response.status).toBe(200);
```

### Mock the network at the boundary, never the module

Declare Supabase responses with the helpers in
[tests/acceptance/network-mock.ts](tests/acceptance/network-mock.ts) —
`supabaseSuccess`, `supabaseFailure`, `supabaseNoRows` — so the real
`@supabase/supabase-js` client still does its query building, header handling
and error mapping. Only HTTP is faked.

```typescript
setupNetworkMocking();                 // once per file, at the top level

it('…', async () => {
  server.use(supabaseSuccess('boards', [{ id: 'TRILBY' }]));
  // …
});
```

**`vi.mock('@supabase/supabase-js')` in this tree defeats the point of the
tree.** If you reach for it, stop — you would be testing the mock.

### ⚠️ What actually blocks the network — do not remove it

> **MSW's `onUnhandledRequest: 'error'` does NOT block requests in msw 2.15.0.**
> It logs. The throw from `print.error()` is swallowed inside MSW's async frame
> listener and **the request proceeds to the real network** — verified against a
> local HTTP server that received the unmatched request and whose response body
> came back to the caller. Treat that option as a log line, not a guard.

Two other mechanisms are what actually keep the suite offline, and **neither may
be removed**:

1. **The catch-all handler** (`blockUnmatchedRequests`) — registered as an
   *initial* handler, so it survives `resetHandlers()` while anything added with
   `server.use()` still takes precedence. It answers 501 locally. It is
   deliberately not a simulated network error: a rejected `fetch` sends
   `postgrest-js` into three retries with 1s/2s/4s backoff, blowing Vitest's 5s
   timeout before any assertion can explain what went wrong.
2. **The recorder plus its `afterEach` assertion** — because every route wraps
   Supabase in `try/catch` and turns any failure into a 500. Without the
   recorder, a test asserting "Supabase failed ⇒ 500" would pass while quietly
   depending on a *missing* handler. The assertion fails loudly and names the
   URL.

Deleting either one does not fail any test. It silently turns a hermetic suite
into one that talks to the internet. The reasoning is repeated in the header
comment of `network-mock.ts`; read it before touching that file.

## Writing Tests

### Test File Structure

Test files should follow this naming convention:
- `*.test.ts` or `*.spec.ts` for test files
- Place unit tests in `tests/unit/`
- Place acceptance tests in `tests/acceptance/`, named `*.acceptance.test.ts`
- Place property-based tests in `tests/property/`

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

Coverage is reported for **every** file under `src/**/*.ts`, including files no
test imports yet, so an untested module shows up as `0%` rather than
disappearing from the report. Current numbers are in `CLAUDE.md` §4.

**Thresholds are enforced in `vitest.config.ts`, not aspirational.**
`pnpm run test:coverage` fails the build below:

- **Global floor**: statements 90%, branches 85%, functions 87%, lines 90%
  (set just below the measured baseline so ordinary churn doesn't trip it).
- **Per-file floors** for the crown jewels, checked against every matching
  file individually (not aggregated): `src/scripts/wos-words.ts` (statements
  96%, branches 90%, functions 94%, lines 98%) and `src/lib/**` (statements
  86%, branches 63%, functions 100%, lines 91% — set by `launch-menu.ts`, the
  weakest file in that directory).

**Ratchet-only policy**: thresholds only go up. A PR that adds code must keep
coverage at or above the floor it's landing against; if you land new tests
that raise real coverage, raise the threshold in the same PR. Lowering a
threshold is a deliberate, reviewed act — justify it explicitly in the PR
description, and never do it just to get CI green. The quarterly target
remains 85/80/85/85 global as coverage continues to climb.

Padding coverage with assertion-free tests to clear a threshold defeats the
point — see §2 (Agent contract) in `CLAUDE.md`.

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

[.github/workflows/tests.yml](.github/workflows/tests.yml) runs the local gate,
in order, in a single `build` job:

```yaml
- name: Install dependencies
  run: pnpm install --frozen-lockfile
- name: Type check
  run: pnpm run check
- name: Lint
  run: pnpm run lint
- name: Run acceptance tests      # the behavioural contract, on its own line
  run: pnpm run test:acceptance
- name: Run tests with coverage   # every stream, including the above
  run: pnpm run test:run --coverage
- name: Build
  run: pnpm run build
```

Two things about that workflow are deliberate and easy to break:

- **The acceptance step is a subset of the step after it.** The duplication is
  the point: it buys a separate red line so a broken contract is distinguishable
  from a broken unit test. Keeping it inside the `build` job is also deliberate
  — `docs/BRANCH-PROTECTION.md` lists required check names by job, so a new job
  would silently not be required.
- **`pull_request` carries no `branches:` filter.** With one, a *stacked* PR —
  one targeting another feature branch rather than `main` — gets no test run at
  all and reads as green because only third-party checks report. That happened
  on PR #159. The `push` trigger stays scoped to `main`.

`pnpm test` is **watch mode**. Never use it in CI or in an agent loop.

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
