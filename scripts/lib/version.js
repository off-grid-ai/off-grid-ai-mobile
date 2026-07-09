'use strict';
// Version-string math shared by scripts/uat.sh (cut a beta) and scripts/promote.sh
// (bless a beta cut to production). Plain CommonJS so bash can run it directly
//   node scripts/lib/version.js <command> <arg...>
// and typed via version.d.ts so the jest test + `tsc --noEmit` gate resolve it.
// One source of truth for what "0.0.103" means, so the cut and the promote can
// never disagree on the version they are shipping.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const BETA_TAG = /^v(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/;

/** Parse "MAJOR.MINOR.PATCH" → {major,minor,patch}. Throws on anything else. */
function parseVersion(version) {
  const m = SEMVER.exec(String(version).trim());
  if (!m) {
    throw new Error(
      `Invalid version "${version}" (expected MAJOR.MINOR.PATCH, e.g. 0.0.103)`,
    );
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** The next patch version: "0.0.102" → "0.0.103". */
function nextPatch(version) {
  const { major, minor, patch } = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

/** Parse a beta tag "v0.0.103-beta.1" → { version: "0.0.103", beta: 1 }. Throws otherwise. */
function parseBetaTag(tag) {
  const m = BETA_TAG.exec(String(tag).trim());
  if (!m) {
    throw new Error(
      `Invalid beta tag "${tag}" (expected vMAJOR.MINOR.PATCH-beta.N, e.g. v0.0.103-beta.1)`,
    );
  }
  return {
    version: `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`,
    beta: Number(m[4]),
  };
}

/** The production version a beta tag promotes to: "v0.0.103-beta.1" → "0.0.103". */
function targetVersionFromBetaTag(tag) {
  return parseBetaTag(tag).version;
}

/** Build a beta tag from a target version + number: ("0.0.103", 1) → "v0.0.103-beta.1". */
function betaTag(targetVersion, n) {
  const { major, minor, patch } = parseVersion(targetVersion);
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1) {
    throw new Error(`Invalid beta number "${n}" (expected a positive integer)`);
  }
  return `v${major}.${minor}.${patch}-beta.${num}`;
}

module.exports = {
  parseVersion,
  nextPatch,
  parseBetaTag,
  targetVersionFromBetaTag,
  betaTag,
};

// CLI: `node scripts/lib/version.js <command> <arg...>` — used by the shell scripts.
if (require.main === module) {
  const [cmd, arg, arg2] = process.argv.slice(2);
  try {
    let out;
    switch (cmd) {
      case 'next-patch':
        out = nextPatch(arg);
        break;
      case 'target-from-beta':
        out = targetVersionFromBetaTag(arg);
        break;
      case 'beta-tag':
        out = betaTag(arg, arg2);
        break;
      default:
        throw new Error(
          `Unknown command "${cmd}". Use: next-patch <version> | target-from-beta <tag> | beta-tag <version> <n>`,
        );
    }
    process.stdout.write(`${out}\n`);
  } catch (e) {
    process.stderr.write(`${e && e.message ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
