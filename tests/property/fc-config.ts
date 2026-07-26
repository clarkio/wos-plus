/**
 * Shared fast-check run configuration for the property suites (issue #150).
 *
 * Two things matter here and both are deliberate:
 *
 * 1. **Explicit seed.** Property tests generate their inputs, so an unseeded
 *    run that fails once may pass on the next CI attempt. Pinning the seed
 *    makes every failure reproducible locally with the exact same inputs. When
 *    a counterexample *is* found it also gets pinned as a plain example-based
 *    regression test next to the property, so the regression stays caught even
 *    if the seed ever changes.
 * 2. **Bounded run count.** These run as part of the ordinary `vitest run`, so
 *    they have to stay fast. A few hundred cases per property is enough to
 *    surface the off-by-one / inverted-condition / boundary mistakes these
 *    tests exist to catch, without turning the unit suite into a soak test.
 *
 * To reproduce a reported failure, fast-check prints the seed and path; run
 * `pnpm run test:property` after temporarily setting `seed` to the reported
 * value.
 */

/** Single seed shared by every property so failures are reproducible. */
export const PROPERTY_SEED = 20260724;

/** Default parameters passed to every `fc.assert` call in tests/property. */
export const propertyRunConfig = {
  seed: PROPERTY_SEED,
  numRuns: 200,
} as const;

/** Same seed, fewer runs — for properties whose inputs are expensive to build. */
export const shortPropertyRunConfig = {
  seed: PROPERTY_SEED,
  numRuns: 100,
} as const;
