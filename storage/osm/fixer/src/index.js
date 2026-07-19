import fs from 'fs/promises';
import path from 'path';
import { loadOsmDocument, transformOsmDocument, writeOsmDocument } from './osm-transform.js';

const PRESETS = {
  soft: {
    orthToleranceDegrees: 6,
    parallelAngleThresholdDegrees: 4,
    parallelNearbyDistanceMeters: 8,
    parallelStrength: 0.2,
    proximityDistanceMeters: 0.8,
    connectedDistanceMeters: 0.6,
    straightenAngleDegrees: 5,
    straightenOffsetMeters: 1.0,
    straightenStrength: 0.6,
    simplifyOffsetMeters: 0.12,
    simplifyAngleDegrees: 2,
    iterations: 3,
  },
  balanced: {
    orthToleranceDegrees: 8,
    parallelAngleThresholdDegrees: 6,
    parallelNearbyDistanceMeters: 12,
    parallelStrength: 0.35,
    proximityDistanceMeters: 1.2,
    connectedDistanceMeters: 0.9,
    straightenAngleDegrees: 7,
    straightenOffsetMeters: 1.5,
    straightenStrength: 1,
    simplifyOffsetMeters: 0.2,
    simplifyAngleDegrees: 3,
    iterations: 4,
  },
  strong: {
    orthToleranceDegrees: 10,
    parallelAngleThresholdDegrees: 8,
    parallelNearbyDistanceMeters: 16,
    parallelStrength: 0.55,
    proximityDistanceMeters: 1.8,
    connectedDistanceMeters: 1.2,
    straightenAngleDegrees: 10,
    straightenOffsetMeters: 2.0,
    straightenStrength: 1,
    simplifyOffsetMeters: 0.35,
    simplifyAngleDegrees: 5,
    iterations: 6,
  },
};

function parseFlagValue(args, name, defaultValue) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return defaultValue;
  }

  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : defaultValue;
}

function parseFlagText(args, name, defaultValue) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return defaultValue;
  }

  return String(args[index + 1]);
}

function hasFlag(args, name) {
  return args.includes(name);
}

function printHelp() {
  console.log(`Usage:\n  node src/index.js <input.osm> <output.osm> [options]\n\nSimple options (recommended):\n  --angle <degrees>             Rotation angle before fixing. Default: 0\n  --preset <soft|balanced|strong>  Processing intensity preset. Default: balanced\n  --grid-size <meters>          Snap to virtual grid in rotated space. 0 disables. Default: 0\n  --clockwise                   Treat angle as clockwise\n  --help                        Show this message\n\nAdvanced override options (optional):\n  --ortho-threshold <degrees>\n  --parallel-angle <degrees>\n  --parallel-distance <meters>\n  --parallel-strength <0..1>\n  --proximity <meters>\n  --connected <meters>\n  --straighten-angle <degrees>\n  --straighten-offset <meters>\n  --straighten-strength <0..1>\n  --simplify-offset <meters>\n  --simplify-angle <degrees>\n  --iterations <count>\n`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || hasFlag(args, '--help')) {
    printHelp();
    process.exit(args.length < 2 ? 1 : 0);
    return;
  }

  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1]);
  const presetName = parseFlagText(args, '--preset', 'balanced').toLowerCase();
  const preset = PRESETS[presetName] ?? PRESETS.balanced;

  const options = {
    angleDegrees: parseFlagValue(args, '--angle', 0),
    clockwise: hasFlag(args, '--clockwise'),
    orthToleranceDegrees: parseFlagValue(args, '--ortho-threshold', preset.orthToleranceDegrees),
    parallelAngleThresholdDegrees: parseFlagValue(args, '--parallel-angle', preset.parallelAngleThresholdDegrees),
    parallelNearbyDistanceMeters: parseFlagValue(args, '--parallel-distance', preset.parallelNearbyDistanceMeters),
    parallelStrength: Math.max(0, Math.min(1, parseFlagValue(args, '--parallel-strength', preset.parallelStrength))),
    proximityDistanceMeters: parseFlagValue(args, '--proximity', preset.proximityDistanceMeters),
    connectedDistanceMeters: parseFlagValue(args, '--connected', preset.connectedDistanceMeters),
    straightenAngleDegrees: parseFlagValue(args, '--straighten-angle', preset.straightenAngleDegrees),
    straightenOffsetMeters: parseFlagValue(args, '--straighten-offset', preset.straightenOffsetMeters),
    straightenStrength: Math.max(0, Math.min(1, parseFlagValue(args, '--straighten-strength', preset.straightenStrength))),
    simplifyOffsetMeters: parseFlagValue(args, '--simplify-offset', preset.simplifyOffsetMeters),
    simplifyAngleDegrees: parseFlagValue(args, '--simplify-angle', preset.simplifyAngleDegrees),
    gridSizeMeters: parseFlagValue(args, '--grid-size', 0),
    iterations: Math.max(1, Math.floor(parseFlagValue(args, '--iterations', preset.iterations))),
  };

  const xml = await fs.readFile(inputPath, 'utf8');
  const document = loadOsmDocument(xml);
  transformOsmDocument(document, options);
  const outputXml = writeOsmDocument(document);
  await fs.writeFile(outputPath, outputXml, 'utf8');

  console.log(`Done. Output written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
