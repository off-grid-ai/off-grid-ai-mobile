/**
 * Version math shared by scripts/uat.sh (cut) and scripts/promote.sh (promote).
 * The whole point of the module is that the cut and the promote agree on what a
 * version/tag means, so every derivation + every rejection path is asserted here.
 */
import {
  parseVersion,
  nextPatch,
  parseBetaTag,
  targetVersionFromBetaTag,
  betaTag,
} from '../../../scripts/lib/version';

describe('parseVersion', () => {
  it('parses a semver into parts', () => {
    expect(parseVersion('0.0.103')).toEqual({ major: 0, minor: 0, patch: 103 });
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });
  it('trims surrounding whitespace', () => {
    expect(parseVersion('  0.0.103\n')).toEqual({
      major: 0,
      minor: 0,
      patch: 103,
    });
  });
  it.each(['0.0', 'v0.0.103', '0.0.103-beta.1', 'x.y.z', '', '1.2.3.4'])(
    'rejects malformed version %p',
    bad => {
      expect(() => parseVersion(bad as string)).toThrow(/Invalid version/);
    },
  );
});

describe('nextPatch', () => {
  it('increments only the patch', () => {
    expect(nextPatch('0.0.102')).toBe('0.0.103');
    expect(nextPatch('1.4.9')).toBe('1.4.10');
  });
  it('propagates a malformed input as an error', () => {
    expect(() => nextPatch('nope')).toThrow(/Invalid version/);
  });
});

describe('parseBetaTag', () => {
  it('splits a beta tag into version + beta number', () => {
    expect(parseBetaTag('v0.0.103-beta.1')).toEqual({
      version: '0.0.103',
      beta: 1,
    });
    expect(parseBetaTag('v2.5.0-beta.12')).toEqual({
      version: '2.5.0',
      beta: 12,
    });
  });
  it.each([
    'v0.0.103', // no beta suffix
    '0.0.103-beta.1', // missing leading v
    'v0.0.103-beta', // missing number
    'v0.0.103-rc.1', // wrong prerelease kind
    'v0.0.103-beta.0.1', // malformed number
    '',
  ])('rejects non-beta tag %p', bad => {
    expect(() => parseBetaTag(bad as string)).toThrow(/Invalid beta tag/);
  });
});

describe('targetVersionFromBetaTag', () => {
  it('strips the leading v and the -beta.N suffix (the promote derivation)', () => {
    expect(targetVersionFromBetaTag('v0.0.103-beta.1')).toBe('0.0.103');
    expect(targetVersionFromBetaTag('v0.0.103-beta.7')).toBe('0.0.103'); // beta number is irrelevant to the target
  });
  it('rejects a non-beta tag rather than guessing', () => {
    expect(() => targetVersionFromBetaTag('v0.0.103')).toThrow(
      /Invalid beta tag/,
    );
  });
});

describe('betaTag', () => {
  it('builds a beta tag from a version + number', () => {
    expect(betaTag('0.0.103', 1)).toBe('v0.0.103-beta.1');
    expect(betaTag('0.0.103', '2')).toBe('v0.0.103-beta.2'); // string n (from shell) accepted
  });
  it('round-trips with targetVersionFromBetaTag', () => {
    expect(targetVersionFromBetaTag(betaTag('0.0.103', 3))).toBe('0.0.103');
  });
  it.each([0, -1, 1.5, 'x'])('rejects invalid beta number %p', n => {
    expect(() => betaTag('0.0.103', n as number)).toThrow(
      /Invalid beta number/,
    );
  });
  it('rejects a malformed target version', () => {
    expect(() => betaTag('0.0', 1)).toThrow(/Invalid version/);
  });
});
